import type { Env } from '../../config/env.js';
import type { FailureKind } from '../../types/source.types.js';
import type { BusSearchRequest } from '../../types/bus.types.js';
import type { DistributedLockService } from '../cache/distributed-lock.service.js';
import type { SourceHealthService } from '../sources/source-health.service.js';
import { buildHealingLockKey } from '../../utils/cache-key.js';
import { logger } from '../../utils/logger.js';
import {
  resolveCollectorId,
  type BrightDataSite,
} from '../../sources/implementations/brightdata/bright-data-input.builder.js';
import {
  isBrightDataSource,
  runBrightDataScraperHeal,
} from './bright-data-cli-heal.service.js';

export interface HealingContext {
  search: BusSearchRequest;
  failure_kind: FailureKind;
  message?: string;
}

const NON_HEALABLE: ReadonlySet<FailureKind> = new Set(['INVALID_REQUEST']);

export class SelfHealingService {
  constructor(
    private readonly env: Env,
    private readonly locks: DistributedLockService,
    private readonly health: SourceHealthService,
  ) {}

  shouldAttemptHeal(failureKind: FailureKind): boolean {
    return !NON_HEALABLE.has(failureKind);
  }

  async tryHeal(source: string, context?: HealingContext): Promise<boolean> {
    const lockKey = buildHealingLockKey(source);
    const token = await this.locks.acquire(lockKey, 60_000);
    if (!token) {
      logger.info({ event: 'SELF_HEALING_STARTED', source, skipped: true, reason: 'lock_held' });
      return false;
    }

    try {
      await this.health.markHealing(source);
      logger.info({
        event: 'SELF_HEALING_STARTED',
        source,
        failure_kind: context?.failure_kind,
        message: context?.message,
      });

      if (isBrightDataSource(source) && context?.search) {
        return await this.healViaBrightDataCli(source, context);
      }

      logger.info({
        event: 'SELF_HEALING_FAILED',
        source,
        reason: 'no_heal_backend_configured',
      });
      return false;
    } catch (err) {
      logger.error({
        event: 'SELF_HEALING_FAILED',
        source,
        message: err instanceof Error ? err.message : 'unknown',
      });
      await this.health.recordFailure(source, context?.failure_kind ?? 'UNKNOWN');
      return false;
    } finally {
      await this.locks.release(lockKey, token);
    }
  }

  private async healViaBrightDataCli(
    source: string,
    context: HealingContext,
  ): Promise<boolean> {
    const collectorId = resolveCollectorId(source as BrightDataSite, this.env);
    const result = await runBrightDataScraperHeal(this.env, {
      source,
      collectorId,
      search: context.search,
      failure_kind: context.failure_kind,
      message: context.message,
    });

    if (result.success) {
      logger.info({
        event: 'SELF_HEALING_SUCCESS',
        source,
        mode: 'brightdata_cli',
        output_path: result.outputPath,
      });
      return true;
    }

    await this.health.recordFailure(source, context.failure_kind);
    return false;
  }
}
