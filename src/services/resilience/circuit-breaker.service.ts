import type { RedisClient } from '../../config/redis.js';
import type { CircuitBreakerRecord, CircuitState } from '../../types/source.types.js';
import { buildCircuitKey } from '../../utils/cache-key.js';
import { nowIso } from '../../utils/time.js';

export class CircuitBreakerService {
  constructor(
    private readonly redis: RedisClient,
    private readonly failureThreshold: number,
    private readonly cooldownMs: number,
  ) {}

  async getState(source: string): Promise<CircuitBreakerRecord> {
    const raw = await this.redis.get(buildCircuitKey(source));
    if (!raw) {
      return {
        state: 'CLOSED',
        failure_count: 0,
        opened_at: null,
        half_open_at: null,
        last_failure_at: null,
      };
    }
    return JSON.parse(raw) as CircuitBreakerRecord;
  }

  async allowRequest(source: string): Promise<boolean> {
    const record = await this.getState(source);
    if (record.state === 'CLOSED') return true;
    if (record.state === 'HALF_OPEN') return true;

    if (record.state === 'OPEN' && record.opened_at) {
      const openedAt = Date.parse(record.opened_at);
      if (Date.now() - openedAt >= this.cooldownMs) {
        await this.setState(source, {
          ...record,
          state: 'HALF_OPEN',
          half_open_at: nowIso(),
        });
        return true;
      }
    }
    return false;
  }

  async recordSuccess(source: string): Promise<void> {
    await this.setState(source, {
      state: 'CLOSED',
      failure_count: 0,
      opened_at: null,
      half_open_at: null,
      last_failure_at: null,
    });
  }

  async recordFailure(source: string): Promise<CircuitState> {
    const current = await this.getState(source);
    if (current.state === 'HALF_OPEN') {
      const next: CircuitBreakerRecord = {
        state: 'OPEN',
        failure_count: current.failure_count + 1,
        opened_at: nowIso(),
        half_open_at: null,
        last_failure_at: nowIso(),
      };
      await this.setState(source, next);
      return 'OPEN';
    }

    const failureCount = current.failure_count + 1;
    const next: CircuitBreakerRecord = {
      state: failureCount >= this.failureThreshold ? 'OPEN' : 'CLOSED',
      failure_count: failureCount,
      opened_at: failureCount >= this.failureThreshold ? nowIso() : null,
      half_open_at: null,
      last_failure_at: nowIso(),
    };
    await this.setState(source, next);
    return next.state;
  }

  private async setState(source: string, record: CircuitBreakerRecord): Promise<void> {
    await this.redis.set(buildCircuitKey(source), JSON.stringify(record));
  }
}
