import { request } from 'undici';
import type { Env } from '../../config/env.js';
import { SelfHealingError } from '../../errors/index.js';
import type { DistributedLockService } from '../cache/distributed-lock.service.js';
import type { SourceHealthService } from '../sources/source-health.service.js';
import { buildHealingLockKey } from '../../utils/cache-key.js';
import { logger } from '../../utils/logger.js';

export class SelfHealingService {
  constructor(
    private readonly env: Env,
    private readonly locks: DistributedLockService,
    private readonly health: SourceHealthService,
  ) {}

  async tryHeal(source: string): Promise<boolean> {
    if (!this.env.SELF_HEALING_API_URL) {
      logger.info({
        event: 'SELF_HEALING_FAILED',
        source,
        reason: 'SELF_HEALING_API_URL not configured',
      });
      return false;
    }

    const lockKey = buildHealingLockKey(source);
    const token = await this.locks.acquire(lockKey, 60_000);
    if (!token) {
      logger.info({ event: 'SELF_HEALING_STARTED', source, skipped: true, reason: 'lock_held' });
      return false;
    }

    try {
      await this.health.markHealing(source);
      logger.info({ event: 'SELF_HEALING_STARTED', source });

      const headers: Record<string, string> = {
        accept: 'application/json',
        'content-type': 'application/json',
      };
      if (this.env.SELF_HEALING_API_KEY) {
        headers['x-api-key'] = this.env.SELF_HEALING_API_KEY;
      }

      const res = await request(this.env.SELF_HEALING_API_URL, {
        method: 'POST',
        headers,
        body: JSON.stringify({ source }),
      });

      if (res.statusCode >= 400) {
        throw new SelfHealingError(source, `Healing API returned ${res.statusCode}`);
      }

      await this.health.recordSuccess(source);
      logger.info({ event: 'SELF_HEALING_SUCCESS', source });
      return true;
    } catch (err) {
      logger.error({
        event: 'SELF_HEALING_FAILED',
        source,
        message: err instanceof Error ? err.message : 'unknown',
      });
      await this.health.recordFailure(source, 'UNKNOWN');
      return false;
    } finally {
      await this.locks.release(lockKey, token);
    }
  }
}
