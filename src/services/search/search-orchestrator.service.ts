import { randomUUID } from 'node:crypto';
import type { BusSearchRequest } from '../../types/bus.types.js';
import type { BusSearchResponse, SearchStatus } from '../../types/api.types.js';
import type { SourceRegistryService } from '../sources/source-registry.service.js';
import type { SourceExecutorService } from '../sources/source-executor.service.js';
import type { BusMatchingService } from '../matching/bus-matching.service.js';
import { logger } from '../../utils/logger.js';
import { filterByPreferredTime } from '../../utils/preferred-time-filter.js';

export class SearchOrchestratorService {
  constructor(
    private readonly registry: SourceRegistryService,
    private readonly executor: SourceExecutorService,
    private readonly matching: BusMatchingService,
  ) {}

  async search(request: BusSearchRequest, requestId: string): Promise<BusSearchResponse> {
    const searchId = randomUUID();
    logger.info({
      event: 'SEARCH_STARTED',
      request_id: requestId,
      search_id: searchId,
      from_city: request.from_city,
      to_city: request.to_city,
      travel_date: request.travel_date,
      preferred_time: request.preferred_time,
    });

    const sources = await this.registry.getEnabledSources();
    const executed = await this.executor.executeAll(sources, request);
    const sourceMeta = executed.map((e) => e.meta);
    const listings = filterByPreferredTime(
      executed.flatMap((e) => e.listings),
      request.preferred_time,
    );
    const matched = this.matching.match(listings);
    // FE contract: nested listing objects (dedupe via match groups → primary listing each)
    const results = matched.map((group) => group.listings[0]);

    const successes = sourceMeta.filter((s) => s.status === 'SUCCESS').length;
    const total = sourceMeta.length;
    let status: SearchStatus;
    if (total === 0 || successes === 0) {
      status = 'SEARCH_FAILED';
      logger.warn({ event: 'SEARCH_FAILED', request_id: requestId, search_id: searchId });
    } else if (successes < total) {
      status = 'PARTIAL_SUCCESS';
      logger.info({ event: 'SEARCH_PARTIAL_SUCCESS', request_id: requestId, search_id: searchId });
    } else {
      status = 'SUCCESS';
      logger.info({ event: 'SEARCH_COMPLETED', request_id: requestId, search_id: searchId });
    }

    return {
      success: status !== 'SEARCH_FAILED',
      status,
      request_id: requestId,
      search_id: searchId,
      sources: sourceMeta,
      results,
      matched,
    };
  }
}
