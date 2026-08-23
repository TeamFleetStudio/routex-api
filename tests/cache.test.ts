import { describe, expect, it } from 'vitest';
import {
  buildSearchCacheKey,
  normalizeCity,
} from '../src/utils/cache-key.js';
import { CachePolicyService } from '../src/services/cache/cache-policy.service.js';
import { CacheService } from '../src/services/cache/cache.service.js';

describe('cache key generation', () => {
  it('normalizes city names', () => {
    expect(normalizeCity('  Chennai ')).toBe('chennai');
    expect(normalizeCity('Bengaluru City')).toBe('bengaluru-city');
  });

  it('builds deterministic search keys', () => {
    expect(buildSearchCacheKey('Chennai', 'Bengaluru', '2026-08-25')).toBe(
      'routex:search:chennai:bengaluru:2026-08-25:any',
    );
  });
});

describe('cache policy', () => {
  const policy = new CachePolicyService(3);

  it('uses 1 minute TTL for today', () => {
    expect(policy.freshTtlForDays(0)).toBe(60_000);
  });

  it('uses 5 minutes for tomorrow', () => {
    expect(policy.freshTtlForDays(1)).toBe(5 * 60_000);
  });

  it('uses 15 minutes for 2-7 days', () => {
    expect(policy.freshTtlForDays(3)).toBe(15 * 60_000);
  });

  it('uses 1 hour for 8-14 days', () => {
    expect(policy.freshTtlForDays(10)).toBe(60 * 60_000);
  });

  it('uses 6 hours for 15-30 days', () => {
    expect(policy.freshTtlForDays(20)).toBe(6 * 60 * 60_000);
  });

  it('uses 24 hours beyond 30 days', () => {
    expect(policy.freshTtlForDays(45)).toBe(24 * 60 * 60_000);
  });

  it('applies stale multiplier', () => {
    const ttl = policy.resolveTtl('2099-01-01', new Date('2098-12-31T00:00:00Z'));
    expect(ttl.staleTtlMs).toBe(ttl.freshTtlMs * 3);
  });
});

describe('cache freshness', () => {
  const cache = new CacheService({} as never);

  it('detects fresh, stale, and expired entries', () => {
    const now = Date.parse('2026-08-21T12:00:00.000Z');
    expect(
      cache.evaluateFreshness(
        {
          data: {},
          created_at: '2026-08-21T11:00:00.000Z',
          fresh_until: '2026-08-21T12:30:00.000Z',
          stale_until: '2026-08-21T13:00:00.000Z',
        },
        now,
      ),
    ).toBe('fresh');

    expect(
      cache.evaluateFreshness(
        {
          data: {},
          created_at: '2026-08-21T11:00:00.000Z',
          fresh_until: '2026-08-21T11:30:00.000Z',
          stale_until: '2026-08-21T13:00:00.000Z',
        },
        now,
      ),
    ).toBe('stale');

    expect(
      cache.evaluateFreshness(
        {
          data: {},
          created_at: '2026-08-21T10:00:00.000Z',
          fresh_until: '2026-08-21T10:30:00.000Z',
          stale_until: '2026-08-21T11:00:00.000Z',
        },
        now,
      ),
    ).toBe('expired');
  });
});
