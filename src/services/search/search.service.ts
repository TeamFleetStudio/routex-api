import type { BusSearchRequest } from '../../types/bus.types.js';
import type { BusSearchResponse, SearchStatusResponse } from '../../types/api.types.js';
import type { SearchSession } from '../../types/search-session.types.js';
import type { SourceResultMeta } from '../../types/source.types.js';
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
import { isSearchUpdating } from './search-progress.util.js';
import { buildSearchLockKey } from '../../utils/cache-key.js';
import { paginateResults } from '../../utils/pagination.js';
import { logger } from '../../utils/logger.js';

export interface SearchOptions {
  includeAll?: boolean;
  waitAll?: boolean;
}

export class SearchService {
  private sessionRefreshInFlight = new Set<string>();
  private sessionResumeInFlight = new Set<string>();

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
      if (session) {
        // Still fetching providers — return progressed state, do not restart.
        if (isSearchUpdating(session)) {
          return this.responseFromSession(session, requestId, options?.includeAll, {
            hit: true,
            stale: false,
          });
        }

        // Overall cache only when every provider succeeded.
        if (isFullSuccessSession(session) && freshness === 'fresh') {
          return this.responseFromSession(session, requestId, options?.includeAll, {
            hit: true,
            stale: false,
          });
        }

        if (isFullSuccessSession(session) && freshness === 'stale') {
          this.triggerSessionRefresh(existingSearchId, request, requestId);
          return this.responseFromSession(session, requestId, options?.includeAll, {
            hit: true,
            stale: true,
          });
        }

        // Finished but incomplete — keep session results; retry missing via site cache / live.
        if (hasFailedProviders(session)) {
          this.triggerSessionResume(existingSearchId, request, requestId);
          return this.responseFromSession(session, requestId, options?.includeAll, {
            hit: true,
            stale: true,
          });
        }
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
    const { session, freshness } = await this.sessionService.getSession(searchId);
    if (!session) return null;

    const filtered = this.filterService.apply(session.results, filterOptions);
    const paginated = paginateResults(filtered, { cursor, limit });
    const stale = freshness === 'stale';
    const sources = isSearchUpdating(session)
      ? session.sources
      : relabelSourcesForSessionCache(session.sources, stale);

    return {
      success: session.status !== 'SEARCH_FAILED',
      status: session.status,
      request_id: requestId,
      search_id: session.search_id,
      sources,
      results: paginated.data,
      total_buses: filtered.length,
      pagination: paginated.pagination,
      updating_more_results: isSearchUpdating(session),
      cache: { hit: true, stale },
    };
  }

  async getSearchStatus(searchId: string, requestId: string): Promise<SearchStatusResponse | null> {
    const { session, freshness } = await this.sessionService.getSession(searchId);
    if (!session) return null;

    const stale = freshness === 'stale';
    const rawProgress = session.provider_progress ?? this.deriveProgressFromSources(session);
    const providers = isSearchUpdating(session)
      ? rawProgress
      : relabelProviderProgressForSessionCache(rawProgress, stale);
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
      updating_more_results: isSearchUpdating(session),
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

    const sources =
      cache?.hit === true && !isSearchUpdating(session)
        ? relabelSourcesForSessionCache(session.sources, cache.stale === true)
        : session.sources;

    return {
      success: session.status !== 'SEARCH_FAILED',
      status: session.status,
      request_id: requestId,
      search_id: session.search_id,
      sources,
      results: paginated.data,
      total_buses: session.total_buses,
      pagination: paginated.pagination,
      updating_more_results: isSearchUpdating(session),
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
    // Hold long enough to create the session; progressive scrapes continue after release.
    const token = await this.locks.acquire(lockKey, 120_000);

    if (!token) {
      // Another request is starting this route — wait for their session, do not start
      // a second set of Bright Data collectors.
      const waitedId = await this.locks.waitForCache(
        () => this.sessionService.getRouteSessionId(request),
        30_000,
        250,
      );
      if (waitedId) {
        const { session } = await this.sessionService.getSession(waitedId);
        if (session) {
          return this.responseFromSession(session, requestId, options?.includeAll, {
            hit: true,
            stale: !isFullSuccessSession(session),
          });
        }
      }
      logger.warn({
        event: 'SEARCH_LOCK_CONTENTION',
        request_id: requestId,
        lock_key: lockKey,
      });
    }

    try {
      const existingSearchId = await this.sessionService.getRouteSessionId(request);
      if (existingSearchId) {
        const { session, freshness } = await this.sessionService.getSession(existingSearchId);
        if (session && isSearchUpdating(session)) {
          return this.responseFromSession(session, requestId, options?.includeAll, {
            hit: true,
            stale: false,
          });
        }
        if (session && isFullSuccessSession(session) && freshness === 'fresh') {
          return this.responseFromSession(session, requestId, options?.includeAll, {
            hit: true,
            stale: false,
          });
        }
        if (session && hasFailedProviders(session)) {
          this.triggerSessionResume(existingSearchId, request, requestId);
          return this.responseFromSession(session, requestId, options?.includeAll, {
            hit: true,
            stale: true,
          });
        }
      }

      // Only the lock holder may start a brand-new search (3 Bright Data triggers).
      if (!token) {
        const lateId = await this.sessionService.getRouteSessionId(request);
        if (lateId) {
          const { session } = await this.sessionService.getSession(lateId);
          if (session) {
            return this.responseFromSession(session, requestId, options?.includeAll, {
              hit: true,
              stale: !isFullSuccessSession(session),
            });
          }
        }
        throw new Error('Search lock contention — please retry');
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

  private triggerSessionResume(
    searchId: string,
    request: BusSearchRequest,
    requestId: string,
  ): void {
    if (this.sessionResumeInFlight.has(searchId) || this.sessionRefreshInFlight.has(searchId)) {
      return;
    }
    this.sessionResumeInFlight.add(searchId);
    logger.info({ event: 'SESSION_RESUME_SCHEDULED', search_id: searchId });

    this.refreshScheduler.schedule(`session-resume:${searchId}`, async () => {
      try {
        await this.orchestrator.resumeIncompleteSession(searchId, request, requestId);
      } finally {
        this.sessionResumeInFlight.delete(searchId);
      }
    });
  }
}

/** Overall cache is valid only when every enabled provider succeeded. */
function isFullSuccessSession(session: SearchSession): boolean {
  if (session.status !== 'SUCCESS') return false;
  if (isSearchUpdating(session)) return false;
  const total = session.total_providers ?? session.sources.length;
  if (session.sources.length < total) return false;
  return session.sources.every((s) => s.status === 'SUCCESS');
}

function hasFailedProviders(session: SearchSession): boolean {
  if (isSearchUpdating(session)) return false;
  return session.sources.some(
    (s) => s.status === 'FAILED' || s.status === 'SKIPPED' || s.status === 'TIMEOUT',
  );
}

/**
 * Overall session cache hit: do not echo the original live-fetch miss + long duration.
 * Successful providers were served from Redis for this response.
 */
function relabelSourcesForSessionCache(
  sources: SourceResultMeta[],
  stale: boolean,
): SourceResultMeta[] {
  const cacheStatus = stale ? 'stale' : 'fresh';
  return sources.map((source) => {
    if (source.status !== 'SUCCESS') return source;
    return {
      ...source,
      cache_status: cacheStatus,
      duration_ms: 0,
    };
  });
}

function relabelProviderProgressForSessionCache(
  progress: NonNullable<SearchSession['provider_progress']>,
  stale: boolean,
): NonNullable<SearchSession['provider_progress']> {
  const cacheStatus = stale ? 'stale' : 'fresh';
  const out: NonNullable<SearchSession['provider_progress']> = {};
  for (const [name, entry] of Object.entries(progress)) {
    if (entry.status === 'SUCCESS') {
      out[name] = { ...entry, cache_status: cacheStatus };
    } else {
      out[name] = entry;
    }
  }
  return out;
}
