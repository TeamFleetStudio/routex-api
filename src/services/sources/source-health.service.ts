import type { RedisClient } from '../../config/redis.js';
import type { FailureKind, SourceHealthRecord, SourceHealthState } from '../../types/source.types.js';
import { buildSourceHealthKey } from '../../utils/cache-key.js';
import { nowIso } from '../../utils/time.js';

export class SourceHealthService {
  constructor(private readonly redis: RedisClient) {}

  async get(source: string): Promise<SourceHealthRecord> {
    const raw = await this.redis.get(buildSourceHealthKey(source));
    if (!raw) {
      return {
        state: 'HEALTHY',
        success_count: 0,
        failure_count: 0,
        consecutive_failures: 0,
        last_success_at: null,
        last_failure_at: null,
        last_error_code: null,
      };
    }
    return JSON.parse(raw) as SourceHealthRecord;
  }

  async recordSuccess(source: string): Promise<void> {
    const current = await this.get(source);
    await this.save(source, {
      state: 'HEALTHY',
      success_count: current.success_count + 1,
      failure_count: current.failure_count,
      consecutive_failures: 0,
      last_success_at: nowIso(),
      last_failure_at: current.last_failure_at,
      last_error_code: null,
    });
  }

  async recordFailure(source: string, kind: FailureKind): Promise<SourceHealthState> {
    const current = await this.get(source);
    const consecutive = current.consecutive_failures + 1;
    let state: SourceHealthState = 'DEGRADED';
    if (consecutive >= 5) state = 'UNHEALTHY';
    else if (consecutive >= 2) state = 'DEGRADED';

    await this.save(source, {
      state,
      success_count: current.success_count,
      failure_count: current.failure_count + 1,
      consecutive_failures: consecutive,
      last_success_at: current.last_success_at,
      last_failure_at: nowIso(),
      last_error_code: kind,
    });
    return state;
  }

  async markHealing(source: string): Promise<void> {
    const current = await this.get(source);
    await this.save(source, { ...current, state: 'HEALING' });
  }

  async markDisabled(source: string): Promise<void> {
    const current = await this.get(source);
    await this.save(source, { ...current, state: 'DISABLED' });
  }

  private async save(source: string, record: SourceHealthRecord): Promise<void> {
    await this.redis.set(buildSourceHealthKey(source), JSON.stringify(record));
  }
}
