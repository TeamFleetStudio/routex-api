import type { CanonicalBus, NormalizedBusListing } from '../../types/bus.types.js';
import { logger } from '../../utils/logger.js';
import type { MatchingStrategy } from './matching-strategy.js';

export class BusMatchingService {
  constructor(private strategy: MatchingStrategy) {}

  setStrategy(strategy: MatchingStrategy): void {
    this.strategy = strategy;
  }

  match(listings: NormalizedBusListing[]): CanonicalBus[] {
    logger.info({ event: 'MATCHING_STARTED', count: listings.length });
    const results = this.strategy.match(listings);
    logger.info({ event: 'MATCHING_COMPLETED', canonical_count: results.length });
    return results;
  }
}
