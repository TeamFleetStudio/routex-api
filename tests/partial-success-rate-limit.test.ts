import { describe, expect, it, vi } from 'vitest';
import { RateLimitExceededError } from '../src/errors/index.js';
import { createRateLimitPlugin } from '../src/middleware/rate-limit.middleware.js';

describe('partial success and total failure', async () => {
  const { SearchOrchestratorService } = await import(
    '../src/services/search/search-orchestrator.service.js'
  );
  const { BusMatchingService } = await import('../src/services/matching/bus-matching.service.js');
  const { DefaultMatchingStrategy } = await import(
    '../src/services/matching/default-matching.strategy.js'
  );
  const { MatchingScoreService } = await import(
    '../src/services/matching/matching-score.service.js'
  );
  const { emptyNormalizedListing } = await import('../src/types/bus.types.js');

  const search = {
    from_city: 'Chennai',
    to_city: 'Bengaluru',
    travel_date: '2099-08-25',
  };

  it('returns PARTIAL_SUCCESS when some sources succeed', async () => {
    const registry = {
      getEnabledSources: vi.fn().mockResolvedValue([
        { config: { name: 'redbus' }, client: {} },
        { config: { name: 'abhibus' }, client: {} },
      ]),
    };
    const executor = {
      executeAll: vi.fn().mockResolvedValue([
        {
          meta: { source: 'redbus', status: 'SUCCESS', duration_ms: 10 },
          listings: [
            {
              ...emptyNormalizedListing('redbus', search),
              operator_name: 'VRL',
              departure_time: '22:00',
              price_inr: 1000,
            },
          ],
        },
        {
          meta: {
            source: 'abhibus',
            status: 'TIMEOUT',
            failure_kind: 'TIMEOUT',
            duration_ms: 10000,
          },
          listings: [],
        },
      ]),
    };

    const sessionService = {
      saveSession: vi.fn().mockResolvedValue(undefined),
      buildSessionTimestamps: vi.fn().mockReturnValue({
        fresh_until: '2099-01-01T00:10:00.000Z',
        stale_until: '2099-01-01T00:15:00.000Z',
      }),
    };

    const orchestrator = new SearchOrchestratorService(
      registry as never,
      executor as never,
      new BusMatchingService(new DefaultMatchingStrategy(new MatchingScoreService())),
      sessionService as never,
    );

    const result = await orchestrator.search(search, 'req_test');
    expect(result.status).toBe('PARTIAL_SUCCESS');
    expect(result.success).toBe(true);
    expect(result.sources).toHaveLength(2);
  });

  it('returns SEARCH_FAILED when all providers fail', async () => {
    const registry = {
      getEnabledSources: vi.fn().mockResolvedValue([
        { config: { name: 'redbus' }, client: {} },
        { config: { name: 'abhibus' }, client: {} },
      ]),
    };
    const executor = {
      executeAll: vi.fn().mockResolvedValue([
        {
          meta: {
            source: 'redbus',
            status: 'FAILED',
            failure_kind: 'NETWORK_ERROR',
            duration_ms: 5,
          },
          listings: [],
        },
        {
          meta: { source: 'abhibus', status: 'TIMEOUT', failure_kind: 'TIMEOUT', duration_ms: 5 },
          listings: [],
        },
      ]),
    };

    const sessionService = {
      saveSession: vi.fn().mockResolvedValue(undefined),
      buildSessionTimestamps: vi.fn().mockReturnValue({
        fresh_until: '2099-01-01T00:10:00.000Z',
        stale_until: '2099-01-01T00:15:00.000Z',
      }),
    };

    const orchestrator = new SearchOrchestratorService(
      registry as never,
      executor as never,
      new BusMatchingService(new DefaultMatchingStrategy(new MatchingScoreService())),
      sessionService as never,
    );

    const result = await orchestrator.search(search, 'req_fail');
    expect(result.status).toBe('SEARCH_FAILED');
    expect(result.success).toBe(false);
  });
});

describe('rate limiting', () => {
  it('throws RATE_LIMIT_EXCEEDED when IP exceeds max', async () => {
    const redis = {
      incr: vi.fn().mockResolvedValue(101),
      pexpire: vi.fn(),
    };

    let hookHandler:
      | ((req: { url: string; ip: string; log: { warn: () => void } }) => Promise<void>)
      | undefined;

    const fakeApp = {
      addHook: (
        _name: string,
        handler: (req: { url: string; ip: string; log: { warn: () => void } }) => Promise<void>,
      ) => {
        hookHandler = handler;
      },
    };

    const plugin = createRateLimitPlugin({
      redis: redis as never,
      env: { RATE_LIMIT_MAX: 100, RATE_LIMIT_WINDOW_MS: 60_000 } as never,
    });
    await plugin(fakeApp as never, {});

    await expect(
      hookHandler!({
        url: '/api/v1/buses/search',
        ip: '1.2.3.4',
        log: { warn: () => undefined },
      }),
    ).rejects.toBeInstanceOf(RateLimitExceededError);
  });
});
