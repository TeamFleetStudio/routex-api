import { describe, expect, it, vi, beforeEach } from 'vitest';
import { SelfHealingService } from '../src/services/self-healing/self-healing.service.js';
import type { DistributedLockService } from '../src/services/cache/distributed-lock.service.js';
import type { SourceHealthService } from '../src/services/sources/source-health.service.js';
import { loadEnv, resetEnvCache } from '../src/config/env.js';
import {
  buildHealOutputPath,
  buildHealPrompt,
} from '../src/services/self-healing/bright-data-cli-heal.service.js';

vi.mock('../src/services/self-healing/bright-data-cli-heal.service.js', async (importOriginal) => {
  const actual = await importOriginal<
    typeof import('../src/services/self-healing/bright-data-cli-heal.service.js')
  >();
  return {
    ...actual,
    runBrightDataScraperHeal: vi.fn(),
  };
});

import { runBrightDataScraperHeal } from '../src/services/self-healing/bright-data-cli-heal.service.js';

const search = {
  from_city: 'Chennai',
  to_city: 'Theni',
  travel_date: '2026-08-25',
};

function mockDeps() {
  const locks: Pick<DistributedLockService, 'acquire' | 'release'> = {
    acquire: vi.fn(async () => 'lock-token'),
    release: vi.fn(async () => undefined),
  };
  const health: Pick<SourceHealthService, 'markHealing' | 'recordFailure' | 'recordSuccess'> = {
    markHealing: vi.fn(async () => undefined),
    recordFailure: vi.fn(async () => undefined),
    recordSuccess: vi.fn(async () => undefined),
  };
  return { locks, health };
}

describe('Bright Data CLI heal helpers', () => {
  it('builds heal prompt and output path', () => {
    resetEnvCache();
    const env = loadEnv({ REDIS_URL: 'redis://localhost:6379' });

    const prompt = buildHealPrompt({
      source: 'redbus',
      collectorId: 'c_mt45kbsacfoxm1vlm',
      search,
      failure_kind: 'TIMEOUT',
      message: 'Source request timed out',
    });

    expect(prompt).toContain('Source request timed out');
    expect(prompt).toContain('price_inr');
    expect(buildHealOutputPath(env, 'redbus')).toContain('redbus-heal.json');
  });
});

describe('SelfHealingService', () => {
  beforeEach(() => {
    vi.mocked(runBrightDataScraperHeal).mockReset();
  });

  it('attempts heal for timeout and invalid-response failures', () => {
    resetEnvCache();
    const env = loadEnv({ REDIS_URL: 'redis://localhost:6379' });
    const { locks, health } = mockDeps();
    const service = new SelfHealingService(
      env,
      locks as DistributedLockService,
      health as SourceHealthService,
    );

    expect(service.shouldAttemptHeal('TIMEOUT')).toBe(true);
    expect(service.shouldAttemptHeal('INVALID_RESPONSE')).toBe(true);
    expect(service.shouldAttemptHeal('SERVER_ERROR')).toBe(true);
    expect(service.shouldAttemptHeal('INVALID_REQUEST')).toBe(false);
  });

  it('runs bdata scraper heal for Bright Data sources', async () => {
    resetEnvCache();
    const env = loadEnv({
      REDIS_URL: 'redis://localhost:6379',
      REDBUS_COLLECTOR_ID: 'c_mt45kbsacfoxm1vlm',
    });
    const { locks, health } = mockDeps();
    const service = new SelfHealingService(
      env,
      locks as DistributedLockService,
      health as SourceHealthService,
    );

    vi.mocked(runBrightDataScraperHeal).mockResolvedValue({
      success: true,
      outputPath: 'output/redbus-heal.json',
      command: ['bdata', 'scraper', 'heal'],
      exitCode: 0,
      stdout: '{}',
      stderr: '',
    });

    const healed = await service.tryHeal('redbus', {
      search,
      failure_kind: 'TIMEOUT',
      message: 'Source request timed out',
    });

    expect(healed).toBe(true);
    expect(runBrightDataScraperHeal).toHaveBeenCalledWith(
      env,
      expect.objectContaining({
        source: 'redbus',
        collectorId: 'c_mt45kbsacfoxm1vlm',
        failure_kind: 'TIMEOUT',
      }),
    );
    expect(health.markHealing).toHaveBeenCalledWith('redbus');
  });
});
