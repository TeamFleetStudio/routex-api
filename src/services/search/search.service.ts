import type { BusSearchRequest } from '../../types/bus.types.js';
import type { BusSearchResponse, SearchStatusResponse } from '../../types/api.types.js';
import type { SearchSession } from '../../types/search-session.types.js';
import type { DistributedLockService } from '../cache/distributed-lock.service.js';
import type { SearchSessionService } from '../cache/search-session.service.js';
import type { ProviderRefreshScheduler } from '../cache/provider-refresh.scheduler.js';
import type { SearchOrchestratorService } from './search-orchestrator.service.js';
import type { SearchFilterService, SearchFilterOptions } from './search-filter.service.js';
import type {
  ProviderCompletedEvent,
  SearchEventsService,
  SearchFinishedEvent,
  SessionUpdatedEvent,
} from './search-events.service.js';
import { buildSearchLockKey } from '../../utils/cache-key.js';
import { paginateResults } from '../../utils/pagination.js';
import { logger } from '../../utils/logger.js';

export interface SearchOptions {
  includeAll?: boolean;
  waitAll?: boolean;
}

export class SearchService {
  private sessionRefreshInFlight = new Set<string>();

  constructor(
    private readonly sessionService: SearchSessionService,
    private readonly locks: DistributedLockService,
    private readonly orchestrator: SearchOrchestratorService,
    private readonly refreshScheduler: ProviderRefreshScheduler,
    private readonly filterService: SearchFilterService,
    private readonly searchEvents: SearchEventsService,
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
    filterOptions?: SearchFilterOptions,
  ): Promise<BusSearchResponse | null> {
    const { session } = await this.sessionService.getSession(searchId);
    if (!session) return null;

    const filtered = this.filterService.apply(session.results, filterOptions);
    const paginated = paginateResults(filtered, { cursor, limit });

    return {
      success: session.status !== 'SEARCH_FAILED',
      status: session.status,
      request_id: requestId,
      search_id: session.search_id,
      sources: session.sources,
      results: paginated.data,
      total_buses: filtered.length,
      pagination: paginated.pagination,
      updating_more_results: this.isUpdating(session),
      cache: { hit: true, stale: false },
    };
  }

  async getSearchStatus(searchId: string, requestId: string): Promise<SearchStatusResponse | null> {
    const { session } = await this.sessionService.getSession(searchId);
    if (!session) return null;

    const providers = session.provider_progress ?? this.deriveProgressFromSources(session);
    const totalProviders = session.total_providers ?? Object.keys(providers).length;
    const entries = Object.values(providers);

    const completed = entries.filter((p) => p.status !== 'processing').length;
    const processing = entries.filter((p) => p.status === 'processing').length;
    const failed = entries.filter((p) => p.status === 'FAILED' || p.status === 'TIMEOUT').length;
    const skipped = entries.filter((p) => p.status === 'SKIPPED').length;
    const progressPercent =
      totalProviders > 0 ? Math.round((completed / totalProviders) * 100) : 100;

    return {
      search_id: searchId,
      status: session.status,
      request_id: requestId,
      total_providers: totalProviders,
      completed,
      processing,
      failed,
      skipped,
      progress_percent: progressPercent,
      providers,
      total_buses: session.total_buses,
      updating_more_results: this.isUpdating(session),
    };
  }

  onProviderCompleted(
    searchId: string,
    listener: (data: ProviderCompletedEvent) => void,
  ): () => void {
    return this.searchEvents.subscribe(searchId, 'provider_completed', listener);
  }

  onSessionUpdated(
    searchId: string,
    listener: (data: SessionUpdatedEvent) => void,
  ): () => void {
    return this.searchEvents.subscribe(searchId, 'session_updated', listener);
  }

  onSearchFinished(
    searchId: string,
    listener: (data: SearchFinishedEvent) => void,
  ): () => void {
    return this.searchEvents.subscribe(searchId, 'search_finished', listener);
  }

  private responseFromSession(
    session: SearchSession,
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
      updating_more_results: this.isUpdating(session),
      cache,
    };
  }

  private deriveProgressFromSources(session: SearchSession) {
    const progress: NonNullable<SearchSession['provider_progress']> = {};
    for (const source of session.sources) {
      progress[source.source] = {
        status: source.status,
        cache_status: source.cache_status,
        bus_count: undefined,
        message: source.message,
      };
    }
    return progress;
  }

  private isUpdating(session: SearchSession): boolean {
    const total = session.total_providers ?? session.sources.length;
    if (session.sources.length < total) return true;
    return session.sources.some(
      (s) => s.cache_status === 'stale' || s.cache_status === 'skipped' || s.status === 'SKIPPED',
    );
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
        waitAll: options?.waitAll,
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
