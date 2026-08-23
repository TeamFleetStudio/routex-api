import { randomUUID } from 'node:crypto';
import type { BusSearchRequest, NormalizedBusListing } from '../../types/bus.types.js';
import type { BusSearchResponse, SearchStatus } from '../../types/api.types.js';
import type {
  ProviderProgressEntry,
  SearchSession,
} from '../../types/search-session.types.js';
import type { SourceResultMeta } from '../../types/source.types.js';
import type { SourceRegistryService } from '../sources/source-registry.service.js';
import type { SourceExecutorService, SourceExecutionResult } from '../sources/source-executor.service.js';
import type { BusMatchingService } from '../matching/bus-matching.service.js';
import type { SearchSessionService } from '../cache/search-session.service.js';
import type { SearchEventsService } from './search-events.service.js';
import { isSearchUpdating } from './search-progress.util.js';
import { paginateResults } from '../../utils/pagination.js';
import { sleep } from '../../utils/time.js';
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
    /** Soft wait for first provider on POST (ms). 0 = return immediately. */
    private readonly firstResultWaitMs = 8_000,
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
    const now = new Date().toISOString();

    // Progressive sessions are not "fresh overall cache" until all succeed.
    const timestamps = this.sessionService.buildSessionTimestamps({ fresh: false });

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
    // Persist before any scrape so concurrent POSTs / polls can find search_id.
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
        await this.persistPartialSession(searchId, request, sourceNames, accumulated);

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
          const status = this.deriveStatus(
            accumulated.map((e) => e.meta),
            sourceNames.length,
          );
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
      // Soft deadline: return before reverse-proxy timeouts (EasyPanel ~30–60s).
      // Cache hits often finish within waitMs; live scrapes continue in background.
      const waitMs = this.firstResultWaitMs;
      if (waitMs <= 0) {
        void progressWork;
      } else {
        await Promise.race([firstProviderGate, sleep(waitMs)]);
        void progressWork;
        if (!firstProviderDone) {
          logger.info({
            event: 'SEARCH_POST_SOFT_RETURN',
            search_id: searchId,
            request_id: requestId,
            waited_ms: waitMs,
            reason: 'first_provider_still_running',
          });
        }
      }
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

  /**
   * Keep progressed results; re-run only failed/skipped/missing providers.
   * Successful providers stay as-is (their site/provider cache is used on live miss).
   */
  async resumeIncompleteSession(
    searchId: string,
    request: BusSearchRequest,
    requestId: string,
  ): Promise<BusSearchResponse | null> {
    const { session } = await this.sessionService.getSession(searchId);
    if (!session) return null;
    if (isSearchUpdating(session)) {
      return this.responseFromSession(session, requestId);
    }

    const enabled = await this.registry.getEnabledSources();
    const sourceNames = enabled.map((s) => s.config.name);
    const successSources = new Set(
      session.sources.filter((s) => s.status === 'SUCCESS').map((s) => s.source),
    );

    const toRetry = enabled.filter((s) => !successSources.has(s.config.name));
    if (toRetry.length === 0) {
      return this.responseFromSession(session, requestId);
    }

    logger.info({
      event: 'SESSION_RESUME_STARTED',
      search_id: searchId,
      request_id: requestId,
      retry_providers: toRetry.map((s) => s.config.name),
    });

    // Mark retrying providers as processing so repeat API calls see updating_more_results.
    const progress = {
      ...(session.provider_progress ?? this.buildInitialProgress(sourceNames)),
    };
    for (const s of toRetry) {
      progress[s.config.name] = { status: 'processing' };
    }
    await this.sessionService.saveSession({
      ...session,
      status: 'PARTIAL_SUCCESS',
      provider_progress: progress,
      updated_at: new Date().toISOString(),
      ...this.sessionService.buildSessionTimestamps({ fresh: false }),
    });

    const keptMeta = session.sources.filter((s) => s.status === 'SUCCESS');
    const keptListings = listingsFromSession(session).filter((l) =>
      successSources.has(l.source_site),
    );

    const retried = await this.executor.executeAll(toRetry, request, { forceLive: true });
    const mergedMeta: SourceResultMeta[] = [...keptMeta, ...retried.map((r) => r.meta)];
    const mergedListings: NormalizedBusListing[] = [
      ...keptListings,
      ...retried.flatMap((r) => r.listings),
    ];
    const results = this.matching.match(mergedListings);
    const status = this.deriveStatus(mergedMeta, sourceNames.length);
    const now = new Date().toISOString();

    const next: SearchSession = {
      search_id: searchId,
      request,
      status,
      sources: orderSources(sourceNames, mergedMeta),
      results,
      total_buses: results.length,
      total_providers: sourceNames.length,
      provider_progress: this.buildProviderProgress(
        sourceNames,
        [
          ...keptMeta.map((meta) => ({
            meta,
            listings: keptListings.filter((l) => l.source_site === meta.source),
          })),
          ...retried,
        ],
      ),
      created_at: session.created_at,
      updated_at: now,
      ...this.sessionService.buildSessionTimestamps({ fresh: status === 'SUCCESS' }),
    };

    await this.sessionService.saveSession(next);
    this.logSearchCompletion(status, requestId, searchId);
    this.searchEvents?.emitSearchFinished(searchId, { status });
    this.searchEvents?.emitSessionUpdated(searchId, {
      total_buses: next.total_buses,
      progress_percent: 100,
    });

    return this.responseFromSession(next, requestId);
  }

  private async persistPartialSession(
    searchId: string,
    request: BusSearchRequest,
    sourceNames: string[],
    accumulated: SourceExecutionResult[],
  ): Promise<void> {
    const existing = await this.sessionService.getSession(searchId);
    const sourceMeta = accumulated.map((e) => e.meta);
    const listings = accumulated.flatMap((e) => e.listings);
    const results = this.matching.match(listings);
    const status = this.deriveStatus(sourceMeta, sourceNames.length);
    const now = new Date().toISOString();
    const complete = accumulated.length >= sourceNames.length;

    const session: SearchSession = {
      search_id: searchId,
      request,
      status,
      sources: orderSources(sourceNames, sourceMeta),
      results,
      total_buses: results.length,
      total_providers: sourceNames.length,
      provider_progress: this.buildProviderProgress(sourceNames, accumulated),
      created_at: existing.session?.created_at ?? now,
      updated_at: now,
      ...this.sessionService.buildSessionTimestamps({
        fresh: complete && status === 'SUCCESS',
      }),
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
    const sourceNames = (await this.registry.getEnabledSources()).map((s) => s.config.name);
    const status = this.deriveStatus(sourceMeta, sourceNames.length);
    this.logSearchCompletion(status, requestId, searchId);

    const now = new Date().toISOString();
    const existing = await this.sessionService.getSession(searchId);

    const session: SearchSession = {
      search_id: searchId,
      request,
      status,
      sources: orderSources(sourceNames, sourceMeta),
      results,
      total_buses: results.length,
      total_providers: sourceNames.length,
      provider_progress: this.buildProviderProgress(sourceNames, executed),
      created_at: existing.session?.created_at ?? now,
      updated_at: now,
      ...this.sessionService.buildSessionTimestamps({ fresh: status === 'SUCCESS' }),
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

  private deriveStatus(
    sourceMeta: SourceResultMeta[],
    totalProviders: number,
  ): SearchStatus {
    const successes = sourceMeta.filter((s) => s.status === 'SUCCESS').length;
    // Providers still outstanding — keep progressive status.
    if (sourceMeta.length < totalProviders) return 'PARTIAL_SUCCESS';
    if (totalProviders === 0 || successes === 0) return 'SEARCH_FAILED';
    if (successes < totalProviders) return 'PARTIAL_SUCCESS';
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

function listingsFromSession(session: SearchSession): NormalizedBusListing[] {
  return session.results.flatMap((bus) => bus.listings ?? []);
}

function orderSources(sourceNames: string[], metas: SourceResultMeta[]): SourceResultMeta[] {
  const byName = new Map(metas.map((m) => [m.source, m]));
  const ordered: SourceResultMeta[] = [];
  for (const name of sourceNames) {
    const meta = byName.get(name);
    if (meta) ordered.push(meta);
  }
  for (const meta of metas) {
    if (!sourceNames.includes(meta.source)) ordered.push(meta);
  }
  return ordered;
}
