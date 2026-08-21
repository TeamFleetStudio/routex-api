import type { BusSearchRequest } from '../../types/bus.types.js';
import type { BusSearchResponse } from '../../types/api.types.js';
import type { CacheService } from '../cache/cache.service.js';
import type { CachePolicyService } from '../cache/cache-policy.service.js';
import type { DistributedLockService } from '../cache/distributed-lock.service.js';
import type { SearchOrchestratorService } from './search-orchestrator.service.js';
import { buildSearchCacheKey, buildSearchLockKey } from '../../utils/cache-key.js';
import { logger } from '../../utils/logger.js';

export class SearchService {
  private refreshInFlight = new Set<string>();

  constructor(
    private readonly cache: CacheService,
    private readonly cachePolicy: CachePolicyService,
    private readonly locks: DistributedLockService,
    private readonly orchestrator: SearchOrchestratorService,
  ) {}

  async search(request: BusSearchRequest, requestId: string): Promise<BusSearchResponse> {
    const cacheKey = buildSearchCacheKey(
      request.from_city,
      request.to_city,
      request.travel_date,
    );
    const { entry, freshness } = await this.cache.getSearch(cacheKey);

    if (freshness === 'fresh' && entry) {
      return {
        ...entry.data,
        request_id: requestId,
        cache: { hit: true, stale: false },
      };
    }

    if (freshness === 'stale' && entry) {
      this.triggerBackgroundRefresh(cacheKey, request, requestId);
      return {
        ...entry.data,
        request_id: requestId,
        cache: { hit: true, stale: true },
      };
    }

    return this.fetchWithLock(cacheKey, request, requestId, entry?.data ?? null);
  }

  private async fetchWithLock(
    cacheKey: string,
    request: BusSearchRequest,
    requestId: string,
    staleFallback: BusSearchResponse | null,
  ): Promise<BusSearchResponse> {
    const lockKey = buildSearchLockKey(
      request.from_city,
      request.to_city,
      request.travel_date,
    );
    const token = await this.locks.acquire(lockKey);

    if (!token) {
      const waited = await this.locks.waitForCache(async () => {
        const { entry, freshness } = await this.cache.getSearch(cacheKey);
        if (entry && (freshness === 'fresh' || freshness === 'stale')) {
          return entry.data;
        }
        return null;
      });

      if (waited) {
        return { ...waited, request_id: requestId, cache: { hit: true, stale: false } };
      }

      if (staleFallback) {
        return {
          ...staleFallback,
          request_id: requestId,
          cache: { hit: true, stale: true },
        };
      }
    }

    try {
      const result = token
        ? await this.orchestrator.search(request, requestId)
        : await this.orchestrator.search(request, requestId);

      const ttl = this.cachePolicy.resolveTtl(request.travel_date);
      await this.cache.setSearch(cacheKey, result, ttl.freshTtlMs, ttl.staleTtlMs);

      return {
        ...result,
        cache: { hit: false, stale: false },
      };
    } finally {
      if (token) {
        await this.locks.release(lockKey, token);
      }
    }
  }

  private triggerBackgroundRefresh(
    cacheKey: string,
    request: BusSearchRequest,
    requestId: string,
  ): void {
    if (this.refreshInFlight.has(cacheKey)) return;
    this.refreshInFlight.add(cacheKey);
    logger.info({ event: 'CACHE_REFRESH_STARTED', key: cacheKey });

    void this.fetchWithLock(cacheKey, request, requestId, null)
      .catch((err) => {
        logger.error({
          event: 'CACHE_REFRESH_FAILED',
          key: cacheKey,
          message: err instanceof Error ? err.message : 'unknown',
        });
      })
      .finally(() => {
        this.refreshInFlight.delete(cacheKey);
      });
  }
}
