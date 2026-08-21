import type { CanonicalBus, NormalizedBusListing } from '../../types/bus.types.js';

export interface MatchingStrategy {
  match(listings: NormalizedBusListing[]): CanonicalBus[];
}
