import { daysUntil } from '../../utils/time.js';

export interface CacheTtlPolicy {
  freshTtlMs: number;
  staleTtlMs: number;
}

export class CachePolicyService {
  constructor(private readonly staleMultiplier = 3) {}

  resolveTtl(travelDate: string, now = new Date()): CacheTtlPolicy {
    const days = daysUntil(travelDate, now);
    const freshTtlMs = this.freshTtlForDays(days);
    return {
      freshTtlMs,
      staleTtlMs: freshTtlMs * this.staleMultiplier,
    };
  }

  freshTtlForDays(daysAway: number): number {
    if (daysAway <= 0) return 60_000; // today (or past edge): 1 min
    if (daysAway === 1) return 5 * 60_000;
    if (daysAway <= 7) return 15 * 60_000;
    if (daysAway <= 14) return 60 * 60_000;
    if (daysAway <= 30) return 6 * 60 * 60_000;
    return 24 * 60 * 60_000;
  }
}
