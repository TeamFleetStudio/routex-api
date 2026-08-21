import type { NormalizedBusListing } from '../../types/bus.types.js';

export class MatchingScoreService {
  /**
   * Placeholder scorer — replace with detailed matching logic later.
   * Scores similarity between two normalized listings.
   */
  score(a: NormalizedBusListing, b: NormalizedBusListing): number {
    let score = 0;
    let checks = 0;

    const opA = this.norm(a.operator_name);
    const opB = this.norm(b.operator_name);
    if (opA && opB) {
      checks += 1;
      if (opA === opB) score += 0.45;
      else if (opA.includes(opB) || opB.includes(opA)) score += 0.25;
    }

    if (a.departure_time && b.departure_time) {
      checks += 1;
      const diff = Math.abs(this.minutes(a.departure_time) - this.minutes(b.departure_time));
      if (diff === 0) score += 0.35;
      else if (diff <= 15) score += 0.25;
      else if (diff <= 30) score += 0.1;
    }

    const typeA = this.norm(a.bus_type);
    const typeB = this.norm(b.bus_type);
    if (typeA && typeB) {
      checks += 1;
      if (typeA === typeB) score += 0.2;
    }

    if (checks === 0) return 0;
    return Math.min(1, score);
  }

  private norm(value: string | null): string {
    return (value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  }

  private minutes(hhmm: string): number {
    const [h, m] = hhmm.split(':').map(Number);
    return h * 60 + m;
  }
}
