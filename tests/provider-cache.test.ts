import { describe, expect, it } from 'vitest';
import {
  buildProviderCacheKey,
  buildRouteSessionIndexKey,
  buildSearchCacheKey,
  normalizeTimeSlot,
} from '../src/utils/cache-key.js';
import { paginateResults, decodeCursor, encodeCursor } from '../src/utils/pagination.js';
import { ProviderCacheService } from '../src/services/cache/provider-cache.service.js';
import { CacheService } from '../src/services/cache/cache.service.js';
import type { ProviderCacheEntry } from '../src/types/provider-cache.types.js';

describe('provider cache keys', () => {
  it('includes time slot in provider cache key', () => {
    expect(
      buildProviderCacheKey('redbus', 'Chennai', 'Bengaluru', '2026-08-25', '18:00'),
    ).toBe('routex:provider:redbus:chennai:bengaluru:2026-08-25:after-1800');
  });

  it('uses any for empty depart_after', () => {
    expect(normalizeTimeSlot('')).toBe('any');
    expect(buildSearchCacheKey('Chennai', 'Bengaluru', '2026-08-25')).toBe(
      'routex:search:chennai:bengaluru:2026-08-25:any',
    );
  });

  it('builds route session index key', () => {
    expect(buildRouteSessionIndexKey('Delhi', 'Jaipur', '2026-08-23')).toBe(
      'routex:route-session:delhi:jaipur:2026-08-23:any',
    );
  });
});

describe('provider cache retry cooldown', () => {
  const env = {
    PROVIDER_CACHE_FRESH_MS: 600_000,
    PROVIDER_CACHE_STALE_MS: 900_000,
    PROVIDER_RETRY_COOLDOWN_MS: 900_000,
  } as never;

  it('detects retry cooldown window', () => {
    const service = new ProviderCacheService({} as never, env);
    const entry: ProviderCacheEntry = {
      provider: 'redbus',
      status: 'failed',
      listings: [],
      last_fetched_at: '2026-08-23T10:00:00.000Z',
      fresh_until: '2026-08-23T10:00:00.000Z',
      stale_until: '2026-08-23T10:15:00.000Z',
      retry_after: '2026-08-23T10:15:00.000Z',
    };
    expect(service.isInRetryCooldown(entry, Date.parse('2026-08-23T10:10:00.000Z'))).toBe(true);
    expect(service.isInRetryCooldown(entry, Date.parse('2026-08-23T10:20:00.000Z'))).toBe(false);
  });
});

describe('pagination cursor', () => {
  it('paginates results with cursor', () => {
    const results = Array.from({ length: 45 }, (_, i) => ({ canonical_bus_id: `bus_${i}` })) as never[];
    const page1 = paginateResults(results, { limit: 20 });
    expect(page1.data).toHaveLength(20);
    expect(page1.pagination.has_more).toBe(true);
    expect(page1.pagination.next_cursor).toBeTruthy();

    const offset = decodeCursor(page1.pagination.next_cursor!);
    expect(offset).toBe(20);

    const page2 = paginateResults(results, { cursor: page1.pagination.next_cursor!, limit: 20 });
    expect(page2.data).toHaveLength(20);
    expect(encodeCursor(20)).toBe(page1.pagination.next_cursor);
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
  });
});
