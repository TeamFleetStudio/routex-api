import { randomUUID } from 'node:crypto';
import type { BusSearchRequest } from '../../types/bus.types.js';
import type { BusSearchResponse, SearchStatus } from '../../types/api.types.js';
import type {
  ProviderProgressEntry,
  SearchSession,
} from '../../types/search-session.types.js';
import type { SourceRegistryService } from '../sources/source-registry.service.js';
import type { SourceExecutorService, SourceExecutionResult } from '../sources/source-executor.service.js';
import type { BusMatchingService } from '../matching/bus-matching.service.js';
import type { SearchSessionService } from '../cache/search-session.service.js';
import type { SearchEventsService } from './search-events.service.js';
import { isSearchUpdating } from './search-progress.util.js';
import { paginateResults } from '../../utils/pagination.js';
import { logger } from '../../utils/logger.js';

export interface OrchestratorSearchOptions {
  searchId?: string;
  includeAll?: boolean;
  waitAll?: boolean;
}

export class SearchOrchestratorService {
  constructor(
    private readonly registry: SourceRegistryService,
    private readonly executor: SourceExecutorService,
    private readonly matching: BusMatchingService,
    private readonly sessionService: SearchSessionService,
    private readonly searchEvents?: SearchEventsService,
  ) {}

  async search(
    request: BusSearchRequest,
    requestId: string,
    options?: OrchestratorSearchOptions,
  ): Promise<BusSearchResponse> {
    const searchId = options?.searchId ?? randomUUID();
    logger.info({
      event: 'SEARCH_STARTED',
      request_id: requestId,
      search_id: searchId,
      from_city: request.from_city,
      to_city: request.to_city,
      travel_date: request.travel_date,
    });

    const sources = await this.registry.getEnabledSources();
    const sourceNames = sources.map((s) => s.config.name);
    const timestamps = this.sessionService.buildSessionTimestamps();
    const now = new Date().toISOString();

    const initialSession: SearchSession = {
      search_id: searchId,
      request,
      status: 'PARTIAL_SUCCESS',
      sources: [],
      results: [],
      total_buses: 0,
      total_providers: sourceNames.length,
      provider_progress: this.buildInitialProgress(sourceNames),
      created_at: now,
      updated_at: now,
      ...timestamps,
    };
    await this.sessionService.saveSession(initialSession);

    const accumulated: SourceExecutionResult[] = [];
    let firstProviderDone = false;
    let resolveFirst: () => void = () => {};
    const firstProviderGate = new Promise<void>((resolve) => {
      resolveFirst = resolve;
    });

    const progressWork = this.executor.executeAllWithProgress(
      sources,
      request,
      async (result) => {
        accumulated.push(result);
        await this.persistPartialSession(
          searchId,
          request,
          sourceNames,
          accumulated,
          timestamps,
        );

        const session = await this.sessionService.getSession(searchId);
        const totalBuses = session.session?.total_buses ?? 0;
        const completed = accumulated.length;
        const progressPercent =
          sourceNames.length > 0
            ? Math.round((completed / sourceNames.length) * 100)
            : 100;

        this.searchEvents?.emitProviderCompleted(searchId, {
          provider: result.meta.source,
          bus_count: result.listings.length,
          total_buses: totalBuses,
        });
        this.searchEvents?.emitSessionUpdated(searchId, {
          total_buses: totalBuses,
          progress_percent: progressPercent,
        });

        if (!firstProviderDone) {
          firstProviderDone = true;
          resolveFirst();
        }

        if (completed >= sourceNames.length) {
          const status = this.deriveStatus(accumulated.map((e) => e.meta));
          this.logSearchCompletion(status, requestId, searchId);
          this.searchEvents?.emitSearchFinished(searchId, { status });
        }
      },
      {
        onProviderRefreshed: () => {
          void this.refreshSession(searchId, request, requestId);
        },
      },
    );

    if (options?.waitAll) {
      await progressWork;
    } else {
      await firstProviderGate;
      void progressWork;
    }

    const { session } = await this.sessionService.getSession(searchId);
    if (!session) {
      throw new Error(`Search session ${searchId} missing after orchestration`);
    }

    return this.responseFromSession(session, requestId, options?.includeAll);
  }

  async refreshSession(
    searchId: string,
    request: BusSearchRequest,
    requestId: string,
  ): Promise<BusSearchResponse | null> {
    logger.info({ event: 'SESSION_REFRESH_STARTED', search_id: searchId, request_id: requestId });

    const sources = await this.registry.getEnabledSources();
    const executed = await this.executor.executeAll(sources, request);
    return this.buildAndPersistResponse(searchId, request, requestId, executed, false);
  }

  private async persistPartialSession(
    searchId: string,
    request: BusSearchRequest,
    sourceNames: string[],
    accumulated: SourceExecutionResult[],
    timestamps: Pick<SearchSession, 'fresh_until' | 'stale_until'>,
  ): Promise<void> {
    const existing = await this.sessionService.getSession(searchId);
    const sourceMeta = accumulated.map((e) => e.meta);
    const listings = accumulated.flatMap((e) => e.listings);
    const results = this.matching.match(listings);
    const status = this.deriveStatus(sourceMeta);
    const now = new Date().toISOString();

    const session: SearchSession = {
      search_id: searchId,
      request,
      status,
      sources: sourceMeta,
      results,
      total_buses: results.length,
      total_providers: sourceNames.length,
      provider_progress: this.buildProviderProgress(sourceNames, accumulated),
      created_at: existing.session?.created_at ?? now,
      updated_at: now,
      ...timestamps,
    };

    await this.sessionService.saveSession(session);
  }

  private async buildAndPersistResponse(
    searchId: string,
    request: BusSearchRequest,
    requestId: string,
    executed: SourceExecutionResult[],
    includeAll?: boolean,
  ): Promise<BusSearchResponse> {
    const sourceMeta = executed.map((e) => e.meta);
    const listings = executed.flatMap((e) => e.listings);
    const results = this.matching.match(listings);
    const status = this.deriveStatus(sourceMeta);
    this.logSearchCompletion(status, requestId, searchId);

    const now = new Date().toISOString();
    const timestamps = this.sessionService.buildSessionTimestamps();
    const sourceNames = sourceMeta.map((s) => s.source);

    const session: SearchSession = {
      search_id: searchId,
      request,
      status,
      sources: sourceMeta,
      results,
      total_buses: results.length,
      total_providers: sourceNames.length,
      provider_progress: this.buildProviderProgress(sourceNames, executed),
      created_at: now,
      updated_at: now,
      ...timestamps,
    };

    await this.sessionService.saveSession(session);
    return this.responseFromSession(session, requestId, includeAll);
  }

  private responseFromSession(
    session: SearchSession,
    requestId: string,
    includeAll?: boolean,
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
      updating_more_results: isSearchUpdating(session),
    };
  }

  private buildInitialProgress(sourceNames: string[]): Record<string, ProviderProgressEntry> {
    return Object.fromEntries(
      sourceNames.map((name) => [name, { status: 'processing' as const }]),
    );
  }

  private buildProviderProgress(
    allSources: string[],
    completed: SourceExecutionResult[],
  ): Record<string, ProviderProgressEntry> {
    const progress = this.buildInitialProgress(allSources);
    for (const result of completed) {
      const { meta, listings } = result;
      progress[meta.source] = {
        status: meta.status,
        cache_status: meta.cache_status,
        bus_count: listings.length,
        message: meta.message,
      };
    }
    return progress;
  }

  private deriveStatus(sourceMeta: SourceExecutionResult['meta'][]): SearchStatus {
    const successes = sourceMeta.filter((s) => s.status === 'SUCCESS').length;
    const total = sourceMeta.length;
    if (total === 0 || successes === 0) return 'SEARCH_FAILED';
    if (successes < total) return 'PARTIAL_SUCCESS';
    return 'SUCCESS';
  }

  private logSearchCompletion(status: SearchStatus, requestId: string, searchId: string): void {
    if (status === 'SEARCH_FAILED') {
      logger.warn({ event: 'SEARCH_FAILED', request_id: requestId, search_id: searchId });
    } else if (status === 'PARTIAL_SUCCESS') {
      logger.info({ event: 'SEARCH_PARTIAL_SUCCESS', request_id: requestId, search_id: searchId });
    } else {
      logger.info({ event: 'SEARCH_COMPLETED', request_id: requestId, search_id: searchId });
    }
  }
}
