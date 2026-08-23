import type { RedisClient } from '../../config/redis.js';
import type { Env } from '../../config/env.js';
import { CacheError } from '../../errors/index.js';
import type { NormalizedBusListing } from '../../types/bus.types.js';
import type { ProviderCacheEntry } from '../../types/provider-cache.types.js';
import type { FailureKind } from '../../types/source.types.js';
import type { CacheFreshness } from './cache.service.js';
import { CacheService } from './cache.service.js';
import { logger } from '../../utils/logger.js';

export class ProviderCacheService {
  private readonly cacheService: CacheService;

  constructor(
    private readonly redis: RedisClient,
    private readonly env: Env,
  ) {
    this.cacheService = new CacheService(redis);
  }

  async getProvider(key: string): Promise<{
    entry: ProviderCacheEntry | null;
    freshness: CacheFreshness;
  }> {
    try {
      const raw = await this.redis.get(key);
      if (!raw) {
        logger.info({ event: 'PROVIDER_CACHE_MISS', key });
        return { entry: null, freshness: 'miss' };
      }

      const entry = JSON.parse(raw) as ProviderCacheEntry;
      const freshness = this.cacheService.evaluateFreshness({
        data: entry,
        created_at: entry.last_fetched_at,
        fresh_until: entry.fresh_until,
        stale_until: entry.stale_until,
      });

      logger.info({ event: 'PROVIDER_CACHE_HIT', key, freshness, status: entry.status });
      return { entry, freshness };
    } catch (err) {
      throw new CacheError('Failed to read provider cache', err);
    }
  }

  async setProviderSuccess(
    key: string,
    provider: string,
    listings: NormalizedBusListing[],
  ): Promise<void> {
    const freshTtlMs = this.env.PROVIDER_CACHE_FRESH_MS;
    const staleTtlMs = this.env.PROVIDER_CACHE_STALE_MS;
    const now = Date.now();
    const entry: ProviderCacheEntry = {
      provider,
      status: 'success',
      listings,
      last_fetched_at: new Date(now).toISOString(),
      fresh_until: new Date(now + freshTtlMs).toISOString(),
      stale_until: new Date(now + staleTtlMs).toISOString(),
    };

    try {
      await this.redis.set(key, JSON.stringify(entry), 'PX', staleTtlMs);
      logger.info({ event: 'PROVIDER_CACHE_UPDATED', key, status: 'success', count: listings.length });
    } catch (err) {
      throw new CacheError('Failed to write provider cache', err);
    }
  }

  async setProviderFailure(
    key: string,
    provider: string,
    error: { failure_kind: FailureKind; message: string },
    previousListings: NormalizedBusListing[] = [],
  ): Promise<void> {
    const staleTtlMs = this.env.PROVIDER_CACHE_STALE_MS;
    const retryAfterMs = this.env.PROVIDER_RETRY_COOLDOWN_MS;
    const now = Date.now();
    const entry: ProviderCacheEntry = {
      provider,
      status: 'failed',
      listings: previousListings,
      last_fetched_at: new Date(now).toISOString(),
      fresh_until: new Date(now).toISOString(),
      stale_until: new Date(now + staleTtlMs).toISOString(),
      retry_after: new Date(now + retryAfterMs).toISOString(),
      failure_kind: error.failure_kind,
      message: error.message,
    };

    try {
      await this.redis.set(key, JSON.stringify(entry), 'PX', staleTtlMs);
      logger.info({ event: 'PROVIDER_CACHE_UPDATED', key, status: 'failed', retry_after: entry.retry_after });
    } catch (err) {
      throw new CacheError('Failed to write provider failure cache', err);
    }
  }

  isInRetryCooldown(entry: ProviderCacheEntry, now = Date.now()): boolean {
    if (!entry.retry_after) return false;
    return now < Date.parse(entry.retry_after);
  }
}
