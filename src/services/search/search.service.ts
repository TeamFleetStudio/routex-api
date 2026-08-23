import type { BusSearchRequest } from '../../types/bus.types.js';
import type { BusSearchResponse } from '../../types/api.types.js';
import type { DistributedLockService } from '../cache/distributed-lock.service.js';
import type { SearchSessionService } from '../cache/search-session.service.js';
import type { ProviderRefreshScheduler } from '../cache/provider-refresh.scheduler.js';
import type { SearchOrchestratorService } from './search-orchestrator.service.js';
import { buildSearchLockKey } from '../../utils/cache-key.js';
import { paginateResults } from '../../utils/pagination.js';
import { logger } from '../../utils/logger.js';

export interface SearchOptions {
  includeAll?: boolean;
}

export class SearchService {
  private sessionRefreshInFlight = new Set<string>();

  constructor(
    private readonly sessionService: SearchSessionService,
    private readonly locks: DistributedLockService,
    private readonly orchestrator: SearchOrchestratorService,
    private readonly refreshScheduler: ProviderRefreshScheduler,
  ) {}

  async search(
    request: BusSearchRequest,
    requestId: string,
    options?: SearchOptions,
  ): Promise<BusSearchResponse> {
    const existingSearchId = await this.sessionService.getRouteSessionId(request);
    if (existingSearchId) {
      const { session, freshness } = await this.sessionService.getSession(existingSearchId);
      if (session && freshness === 'fresh') {
        return this.responseFromSession(session, requestId, options?.includeAll, {
          hit: true,
          stale: false,
        });
      }
      if (session && freshness === 'stale') {
        this.triggerSessionRefresh(existingSearchId, request, requestId);
        return this.responseFromSession(session, requestId, options?.includeAll, {
          hit: true,
          stale: true,
        });
      }
    }

    return this.fetchWithLock(request, requestId, options);
  }

  async getSessionPage(
    searchId: string,
    requestId: string,
    cursor?: string,
    limit?: number,
  ): Promise<BusSearchResponse | null> {
    const { session } = await this.sessionService.getSession(searchId);
    if (!session) return null;

    const paginated = paginateResults(session.results, { cursor, limit });
    return {
      success: session.status !== 'SEARCH_FAILED',
      status: session.status,
      request_id: requestId,
      search_id: session.search_id,
      sources: session.sources,
      results: paginated.data,
      total_buses: session.total_buses,
      pagination: paginated.pagination,
      updating_more_results: session.sources.some(
        (s) => s.cache_status === 'stale' || s.cache_status === 'skipped' || s.status === 'SKIPPED',
      ),
      cache: { hit: true, stale: false },
    };
  }

  private responseFromSession(
    session: Awaited<ReturnType<SearchSessionService['getSession']>>['session'] & object,
    requestId: string,
    includeAll?: boolean,
    cache?: { hit: boolean; stale: boolean },
  ): BusSearchResponse {
    const paginated = includeAll
      ? {
          data: session.results,
          pagination: {
            limit: session.results.length,
            total_items: session.total_buses,
            has_more: false,
            next_cursor: null,
          },
        }
      : paginateResults(session.results, {});

    return {
      success: session.status !== 'SEARCH_FAILED',
      status: session.status,
      request_id: requestId,
      search_id: session.search_id,
      sources: session.sources,
      results: paginated.data,
      total_buses: session.total_buses,
      pagination: paginated.pagination,
      updating_more_results: session.sources.some(
        (s) => s.cache_status === 'stale' || s.cache_status === 'skipped' || s.status === 'SKIPPED',
      ),
      cache,
    };
  }

  private async fetchWithLock(
    request: BusSearchRequest,
    requestId: string,
    options?: SearchOptions,
  ): Promise<BusSearchResponse> {
    const lockKey = buildSearchLockKey(
      request.from_city,
      request.to_city,
      request.travel_date,
      request.depart_after,
    );
    const token = await this.locks.acquire(lockKey);

    if (!token) {
      const existingSearchId = await this.sessionService.getRouteSessionId(request);
      if (existingSearchId) {
        const { session, freshness } = await this.sessionService.getSession(existingSearchId);
        if (session && (freshness === 'fresh' || freshness === 'stale')) {
          return this.responseFromSession(session, requestId, options?.includeAll, {
            hit: true,
            stale: freshness === 'stale',
          });
        }
      }
    }

    try {
      if (token) {
        const existingSearchId = await this.sessionService.getRouteSessionId(request);
        if (existingSearchId) {
          const { session, freshness } = await this.sessionService.getSession(existingSearchId);
          if (session && freshness === 'fresh') {
            return this.responseFromSession(session, requestId, options?.includeAll, {
              hit: true,
              stale: false,
            });
          }
        }
      }

      const result = await this.orchestrator.search(request, requestId, {
        includeAll: options?.includeAll,
      });

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

  private triggerSessionRefresh(
    searchId: string,
    request: BusSearchRequest,
    requestId: string,
  ): void {
    if (this.sessionRefreshInFlight.has(searchId)) return;
    this.sessionRefreshInFlight.add(searchId);
    logger.info({ event: 'SESSION_REFRESH_SCHEDULED', search_id: searchId });

    this.refreshScheduler.schedule(`session:${searchId}`, async () => {
      try {
        await this.orchestrator.refreshSession(searchId, request, requestId);
      } finally {
        this.sessionRefreshInFlight.delete(searchId);
      }
    });
  }
}
