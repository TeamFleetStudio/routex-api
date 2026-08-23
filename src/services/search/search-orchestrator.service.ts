import { randomUUID } from 'node:crypto';
import type { BusSearchRequest } from '../../types/bus.types.js';
import type { BusSearchResponse, SearchStatus } from '../../types/api.types.js';
import type { SearchSession } from '../../types/search-session.types.js';
import type { SourceRegistryService } from '../sources/source-registry.service.js';
import type { SourceExecutorService, SourceExecutionResult } from '../sources/source-executor.service.js';
import type { BusMatchingService } from '../matching/bus-matching.service.js';
import type { SearchSessionService } from '../cache/search-session.service.js';
import { paginateResults } from '../../utils/pagination.js';
import { logger } from '../../utils/logger.js';

export class SearchOrchestratorService {
  constructor(
    private readonly registry: SourceRegistryService,
    private readonly executor: SourceExecutorService,
    private readonly matching: BusMatchingService,
    private readonly sessionService: SearchSessionService,
  ) {}

  async search(
    request: BusSearchRequest,
    requestId: string,
    options?: { searchId?: string; includeAll?: boolean },
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
    const executed = await this.executor.executeAll(sources, request, {
      onProviderRefreshed: () => {
        void this.refreshSession(searchId, request, requestId);
      },
    });

    return this.buildAndPersistResponse(searchId, request, requestId, executed, options?.includeAll);
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

    if (status === 'SEARCH_FAILED') {
      logger.warn({ event: 'SEARCH_FAILED', request_id: requestId, search_id: searchId });
    } else if (status === 'PARTIAL_SUCCESS') {
      logger.info({ event: 'SEARCH_PARTIAL_SUCCESS', request_id: requestId, search_id: searchId });
    } else {
      logger.info({ event: 'SEARCH_COMPLETED', request_id: requestId, search_id: searchId });
    }

    const now = new Date().toISOString();
    const timestamps = this.sessionService.buildSessionTimestamps();

    const session: SearchSession = {
      search_id: searchId,
      request,
      status,
      sources: sourceMeta,
      results,
      total_buses: results.length,
      created_at: now,
      updated_at: now,
      ...timestamps,
    };

    await this.sessionService.saveSession(session);

    const paginated = includeAll
      ? {
          data: results,
          pagination: {
            limit: results.length,
            total_items: results.length,
            has_more: false,
            next_cursor: null,
          },
        }
      : paginateResults(results, {});

    return {
      success: status !== 'SEARCH_FAILED',
      status,
      request_id: requestId,
      search_id: searchId,
      sources: sourceMeta,
      results: paginated.data,
      total_buses: results.length,
      pagination: paginated.pagination,
      updating_more_results: this.isUpdating(sourceMeta),
    };
  }

  private deriveStatus(sourceMeta: SourceExecutionResult['meta'][]): SearchStatus {
    const successes = sourceMeta.filter((s) => s.status === 'SUCCESS').length;
    const total = sourceMeta.length;
    if (total === 0 || successes === 0) return 'SEARCH_FAILED';
    if (successes < total) return 'PARTIAL_SUCCESS';
    return 'SUCCESS';
  }

  private isUpdating(sourceMeta: SourceExecutionResult['meta'][]): boolean {
    return sourceMeta.some(
      (s) => s.cache_status === 'stale' || s.cache_status === 'skipped' || s.status === 'SKIPPED',
    );
  }
}
