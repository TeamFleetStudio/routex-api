import type { BusTypeTag, NormalizedBusListing } from '../../types/bus.types.js';

export interface SimilarityBreakdown {
  total: number;
  operator: number;
  bus_type: number;
  departure: number;
  arrival: number;
  duration: number;
}

export class MatchingScoreService {
  /** Weighted similarity 0–100. Missing components contribute 0. */
  score(a: NormalizedBusListing, b: NormalizedBusListing): number {
    return this.scoreDetailed(a, b).total;
  }

  scoreDetailed(a: NormalizedBusListing, b: NormalizedBusListing): SimilarityBreakdown {
    const operator = this.operatorScore(a, b);
    const busType = this.busTypeScore(a, b);
    const departure = this.departureScore(a, b);
    const arrival = this.arrivalScore(a, b);
    const duration = this.durationScore(a, b);

    const total =
      operator * 0.35 +
      busType * 0.25 +
      departure * 0.2 +
      arrival * 0.1 +
      duration * 0.1;

    return {
      total: Number(total.toFixed(2)),
      operator,
      bus_type: busType,
      departure,
      arrival,
      duration,
    };
  }

  operatorScore(a: NormalizedBusListing, b: NormalizedBusListing): number {
    const opA = a.operator_name_normalized ?? '';
    const opB = b.operator_name_normalized ?? '';
    if (!opA || !opB) return 0;
    if (opA === opB) return 100;
    return this.fuzzyStringSimilarity(opA, opB);
  }

  busTypeScore(a: NormalizedBusListing, b: NormalizedBusListing): number {
    const tagsA = new Set(a.bus_type_normalized ?? []);
    const tagsB = new Set(b.bus_type_normalized ?? []);
    if (tagsA.size === 0 || tagsB.size === 0) return 0;
    return this.jaccard(tagsA, tagsB) * 100;
  }

  departureScore(a: NormalizedBusListing, b: NormalizedBusListing): number {
    const da = a.departure_minutes;
    const db = b.departure_minutes;
    if (da == null || db == null) return 0;
    const diff = Math.abs(da - db);
    if (diff <= 15) return 100;
    if (diff <= 30) return 90;
    if (diff <= 45) return 75;
    if (diff <= 60) return 60;
    if (diff <= 90) return 30;
    return 0;
  }

  arrivalScore(a: NormalizedBusListing, b: NormalizedBusListing): number {
    const aa = a.arrival_minutes;
    const ab = b.arrival_minutes;
    if (aa == null || ab == null) return 0;
    // Handle overnight wrap for simple abs diff near midnight is imperfect;
    // use circular min distance on 24h clock for arrival.
    const diff = Math.min(Math.abs(aa - ab), 1440 - Math.abs(aa - ab));
    if (diff <= 30) return 100;
    if (diff <= 60) return 70;
    if (diff <= 90) return 40;
    return 0;
  }

  durationScore(a: NormalizedBusListing, b: NormalizedBusListing): number {
    const da = a.duration_minutes;
    const db = b.duration_minutes;
    if (da == null || db == null) return 0;
    const diff = Math.abs(da - db);
    if (diff <= 30) return 100;
    if (diff <= 60) return 70;
    if (diff <= 90) return 40;
    return 0;
  }

  jaccard(a: Set<BusTypeTag>, b: Set<BusTypeTag>): number {
    let common = 0;
    for (const t of a) {
      if (b.has(t)) common += 1;
    }
    const unique = new Set([...a, ...b]).size;
    if (unique === 0) return 0;
    return common / unique;
  }

  /** Dice coefficient on character bigrams, scaled 0–100. */
  fuzzyStringSimilarity(a: string, b: string): number {
    if (a === b) return 100;
    if (a.includes(b) || b.includes(a)) {
      const ratio = Math.min(a.length, b.length) / Math.max(a.length, b.length);
      return Math.round(70 + ratio * 30);
    }

    const bigrams = (s: string): Map<string, number> => {
      const map = new Map<string, number>();
      const cleaned = s.replace(/\s+/g, '');
      for (let i = 0; i < cleaned.length - 1; i++) {
        const bg = cleaned.slice(i, i + 2);
        map.set(bg, (map.get(bg) ?? 0) + 1);
      }
      return map;
    };

    const A = bigrams(a);
    const B = bigrams(b);
    if (A.size === 0 || B.size === 0) return 0;

    let overlap = 0;
    for (const [bg, count] of A) {
      const other = B.get(bg) ?? 0;
      overlap += Math.min(count, other);
    }

    let sizeA = 0;
    let sizeB = 0;
    for (const c of A.values()) sizeA += c;
    for (const c of B.values()) sizeB += c;

    const dice = (2 * overlap) / (sizeA + sizeB);
    return Math.round(dice * 100);
  }
}
