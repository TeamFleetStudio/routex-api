import type {
  CanonicalBus,
  CanonicalOffer,
  NormalizedBusListing,
  SimilarAlternative,
} from '../../types/bus.types.js';
import { shortHash } from '../../utils/hash.js';
import type { MatchingStrategy } from './matching-strategy.js';
import type { MatchingScoreService } from './matching-score.service.js';
import { NormalizationEnrichmentService } from './normalization-enrichment.service.js';
import { buildFallbackListingUrl } from '../../sources/implementations/scraper/listing-url-builder.js';

const SAME_THRESHOLD = 80;
const SIMILAR_THRESHOLD = 65;

/**
 * Cross-site comparison strategy:
 * enrich → dedupe → cluster (≥80) → similar links (65–79) → cheapest/savings → deal score → sort
 */
export class DefaultMatchingStrategy implements MatchingStrategy {
  private readonly enrichment = new NormalizationEnrichmentService();

  constructor(private readonly scorer: MatchingScoreService) {}

  match(listings: NormalizedBusListing[]): CanonicalBus[] {
    const enriched = this.enrichment.enrichAll(listings);
    const deduped = this.dedupe(enriched);
    const groups = this.cluster(deduped);

    const shortestDuration = this.shortestDuration(groups);
    const globalCheapest = this.globalCheapest(groups);
    const draft = groups.map((group, index) =>
      this.toCanonical(group, index, shortestDuration, globalCheapest),
    );

    this.attachSimilarAlternatives(draft, groups);
    return this.sortResults(draft);
  }

  private dedupe(listings: NormalizedBusListing[]): NormalizedBusListing[] {
    const seen = new Set<string>();
    const out: NormalizedBusListing[] = [];

    for (const listing of listings) {
      const byId =
        listing.source_listing_id != null && listing.source_listing_id !== ''
          ? `${listing.source_site}|id:${listing.source_listing_id}`
          : null;
      const byFields = [
        listing.source_site,
        listing.operator_name_normalized ?? '',
        listing.departure_time ?? '',
        listing.arrival_time ?? '',
        String(listing.normalized_price ?? listing.price_inr ?? ''),
      ].join('|');

      const key = byId ?? byFields;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(listing);
    }
    return out;
  }

  private cluster(listings: NormalizedBusListing[]): NormalizedBusListing[][] {
    const groups: NormalizedBusListing[][] = [];

    for (const listing of listings) {
      let placed = false;
      for (const group of groups) {
        const representative = group[0];
        if (this.scorer.score(representative, listing) >= SAME_THRESHOLD) {
          group.push(listing);
          placed = true;
          break;
        }
      }
      if (!placed) {
        groups.push([listing]);
      }
    }
    return groups;
  }

  private toCanonical(
    group: NormalizedBusListing[],
    index: number,
    shortestDuration: number | null,
    globalCheapest: number | null,
  ): CanonicalBus {
    const primary = group[0];
    const key = [
      primary.operator_name_normalized ?? primary.operator_name ?? '',
      primary.departure_time ?? '',
      primary.arrival_time ?? '',
      (primary.bus_type_normalized ?? []).join(','),
      String(index),
    ].join('|');

    const confidence =
      group.length === 1
        ? 100
        : group
            .slice(1)
            .reduce((sum, item) => sum + this.scorer.score(primary, item), 0) /
          (group.length - 1);

    const priced = group
      .map((g) => ({
        listing: g,
        price: g.normalized_price ?? g.price_inr,
      }))
      .filter((x): x is { listing: NormalizedBusListing; price: number } => x.price != null);

    const cheapestPrice =
      priced.length > 0 ? Math.min(...priced.map((p) => p.price)) : null;
    const cheapestListing =
      cheapestPrice == null
        ? null
        : priced.find((p) => p.price === cheapestPrice)?.listing ?? null;

    const offers: CanonicalOffer[] = group.map((g) => {
      const price = g.normalized_price ?? g.price_inr;
      let difference: number | null = null;
      let pct: number | null = null;
      if (price != null && cheapestPrice != null) {
        difference = Number((price - cheapestPrice).toFixed(2));
        pct =
          price > 0
            ? Number((((price - cheapestPrice) / price) * 100).toFixed(1))
            : 0;
      }
      return {
        source: g.source_site,
        price_inr: price,
        difference_from_cheapest: difference,
        difference_percentage: pct,
        source_listing_id: g.source_listing_id,
        listing_url:
          g.listing_url ??
          buildFallbackListingUrl(
            g.source_site,
            g.search,
            g.source_listing_id,
            null,
          ),
      };
    });

    // Prefer cheapest offer first in list
    offers.sort((a, b) => {
      if (a.price_inr == null) return 1;
      if (b.price_inr == null) return -1;
      return a.price_inr - b.price_inr;
    });

    const dealScore = this.computeDealScore(
      primary,
      cheapestPrice,
      globalCheapest,
      shortestDuration,
    );

    const platformCount = offers.length;
    const prices = offers
      .map((o) => o.price_inr)
      .filter((p): p is number => p != null);
    const saveUpTo =
      prices.length >= 2 ? Number((Math.max(...prices) - Math.min(...prices)).toFixed(2)) : null;
    const bestDealLabel = this.resolveBestDealLabel(dealScore, cheapestPrice, globalCheapest);

    const draft: CanonicalBus = {
      canonical_bus_id: `bus_${shortHash(key)}`,
      match_tier: group.length > 1 ? 'same' : 'unique',
      match_confidence: Number(confidence.toFixed(1)),
      operator_name: primary.operator_name,
      operator_name_normalized: primary.operator_name_normalized ?? null,
      bus_type_raw: primary.bus_type_raw ?? primary.bus_type,
      bus_type_normalized: primary.bus_type_normalized ?? [],
      departure_time: primary.departure_time,
      arrival_time: primary.arrival_time,
      duration_minutes: primary.duration_minutes,
      cheapest_price_inr: cheapestPrice,
      cheapest_provider: cheapestListing?.source_site ?? null,
      deal_score: Number(dealScore.toFixed(1)),
      platform_count: platformCount,
      save_up_to_inr: saveUpTo,
      best_deal_label: bestDealLabel,
      deal_reasons: [],
      offers,
      similar_alternatives: [],
      listings: group,
    };

    draft.deal_reasons = this.buildDealReasons(draft, shortestDuration);
    return draft;
  }

  private resolveBestDealLabel(
    dealScore: number,
    cheapestInGroup: number | null,
    globalCheapest: number | null,
  ): CanonicalBus['best_deal_label'] {
    if (dealScore >= 85) return 'Best Deal';
    if (
      cheapestInGroup != null &&
      globalCheapest != null &&
      cheapestInGroup <= globalCheapest
    ) {
      return 'Cheapest';
    }
    return null;
  }

  buildDealReasons(
    canonical: CanonicalBus,
    shortestDuration: number | null,
  ): string[] {
    const reasons: string[] = [];

    if (canonical.save_up_to_inr != null && canonical.save_up_to_inr > 0) {
      reasons.push(`₹${Math.round(canonical.save_up_to_inr)} cheaper than other platforms`);
    }

    if (canonical.platform_count >= 2) {
      reasons.push(`Available on ${canonical.platform_count} platforms`);
    }

    const primary = canonical.listings[0];
    if (
      canonical.duration_minutes != null &&
      shortestDuration != null &&
      canonical.duration_minutes === shortestDuration
    ) {
      reasons.push('Fastest route among results');
    }

    if (primary?.rating != null && primary.rating >= 4) {
      reasons.push(`Highly rated (${primary.rating.toFixed(1)}★)`);
    }

    const tags = canonical.bus_type_normalized ?? [];
    if (tags.includes('AC') && tags.includes('SLEEPER')) {
      reasons.push('AC Sleeper comfort');
    }

    if (canonical.cheapest_provider) {
      reasons.push(`Best price on ${canonical.cheapest_provider}`);
    }

    return reasons.slice(0, 4);
  }

  private computeDealScore(
    listing: NormalizedBusListing,
    cheapestInGroup: number | null,
    globalCheapest: number | null,
    shortestDuration: number | null,
  ): number {
    // Prefer group cheapest vs global cheapest so cheaper groups rank higher
    const priceScore =
      cheapestInGroup != null && globalCheapest != null && cheapestInGroup > 0
        ? Math.min(100, (globalCheapest / cheapestInGroup) * 100)
        : 0;

    const duration = listing.duration_minutes;
    const durationScore =
      duration != null && shortestDuration != null && duration > 0
        ? Math.min(100, (shortestDuration / duration) * 100)
        : 0;

    const dep = listing.departure_minutes;
    const departureConvenience =
      dep == null ? 0 : Math.max(0, 100 - Math.min(100, Math.abs(dep - 1260) / 3));

    let busQuality = 0;
    if (listing.rating != null) {
      busQuality += (listing.rating / 5) * 70;
    }
    const tags = listing.bus_type_normalized ?? [];
    if (tags.includes('AC')) busQuality += 10;
    if (tags.includes('VOLVO')) busQuality += 10;
    if (tags.includes('ELECTRIC')) busQuality += 10;
    busQuality = Math.min(100, busQuality);

    return (
      priceScore * 0.5 +
      durationScore * 0.2 +
      departureConvenience * 0.15 +
      busQuality * 0.15
    );
  }

  private globalCheapest(groups: NormalizedBusListing[][]): number | null {
    let min: number | null = null;
    for (const group of groups) {
      for (const listing of group) {
        const price = listing.normalized_price ?? listing.price_inr;
        if (price != null) {
          min = min == null ? price : Math.min(min, price);
        }
      }
    }
    return min;
  }

  private shortestDuration(groups: NormalizedBusListing[][]): number | null {
    let min: number | null = null;
    for (const group of groups) {
      for (const listing of group) {
        if (listing.duration_minutes != null) {
          min = min == null ? listing.duration_minutes : Math.min(min, listing.duration_minutes);
        }
      }
    }
    return min;
  }

  private attachSimilarAlternatives(
    draft: CanonicalBus[],
    groups: NormalizedBusListing[][],
  ): void {
    for (let i = 0; i < draft.length; i++) {
      const similar: SimilarAlternative[] = [];
      const repA = groups[i][0];

      for (let j = 0; j < draft.length; j++) {
        if (i === j) continue;
        const repB = groups[j][0];
        const score = this.scorer.score(repA, repB);
        if (score >= SIMILAR_THRESHOLD && score < SAME_THRESHOLD) {
          similar.push({
            canonical_bus_id: draft[j].canonical_bus_id,
            similarity_score: Number(score.toFixed(1)),
            operator_name: draft[j].operator_name,
            departure_time: draft[j].departure_time,
            cheapest_price_inr: draft[j].cheapest_price_inr,
          });
        }
      }

      similar.sort((a, b) => b.similarity_score - a.similarity_score);
      draft[i].similar_alternatives = similar;
    }
  }

  private sortResults(results: CanonicalBus[]): CanonicalBus[] {
    return [...results].sort((a, b) => {
      if (b.deal_score !== a.deal_score) return b.deal_score - a.deal_score;
      const pa = a.cheapest_price_inr ?? Number.POSITIVE_INFINITY;
      const pb = b.cheapest_price_inr ?? Number.POSITIVE_INFINITY;
      if (pa !== pb) return pa - pb;
      const da = a.duration_minutes ?? Number.POSITIVE_INFINITY;
      const db = b.duration_minutes ?? Number.POSITIVE_INFINITY;
      if (da !== db) return da - db;
      return (a.departure_time ?? '').localeCompare(b.departure_time ?? '');
    });
  }
}
