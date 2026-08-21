import type { CanonicalBus, NormalizedBusListing } from '../../types/bus.types.js';
import { shortHash } from '../../utils/hash.js';
import type { MatchingStrategy } from './matching-strategy.js';
import type { MatchingScoreService } from './matching-score.service.js';

const MATCH_THRESHOLD = 0.7;

/**
 * Default strategy: greedy clustering by operator + departure similarity.
 * Designed to be replaced when detailed matching rules arrive.
 */
export class DefaultMatchingStrategy implements MatchingStrategy {
  constructor(private readonly scorer: MatchingScoreService) {}

  match(listings: NormalizedBusListing[]): CanonicalBus[] {
    const groups: NormalizedBusListing[][] = [];

    for (const listing of listings) {
      let placed = false;
      for (const group of groups) {
        const representative = group[0];
        if (this.scorer.score(representative, listing) >= MATCH_THRESHOLD) {
          group.push(listing);
          placed = true;
          break;
        }
      }
      if (!placed) {
        groups.push([listing]);
      }
    }

    return groups.map((group) => this.toCanonical(group));
  }

  private toCanonical(group: NormalizedBusListing[]): CanonicalBus {
    const primary = group[0];
    const key = [
      primary.operator_name ?? '',
      primary.departure_time ?? '',
      primary.arrival_time ?? '',
      primary.bus_type ?? '',
    ].join('|');

    const confidence =
      group.length === 1
        ? 1
        : group.slice(1).reduce((sum, item) => sum + this.scorer.score(primary, item), 0) /
          (group.length - 1);

    return {
      canonical_bus_id: `bus_${shortHash(key)}`,
      operator_name: primary.operator_name,
      departure_time: primary.departure_time,
      arrival_time: primary.arrival_time,
      bus_type: primary.bus_type,
      match_confidence: Number(confidence.toFixed(2)),
      offers: group.map((g) => ({
        source: g.source_site,
        price_inr: g.price_inr,
        source_listing_id: g.source_listing_id,
        listing_url: g.listing_url,
      })),
      listings: group,
    };
  }
}
