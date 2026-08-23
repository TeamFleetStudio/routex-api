import type { RedisClient } from '../../config/redis.js';
import { buildProviderAnalyticsKey } from '../../utils/cache-key.js';

export interface ProviderAnalyticsRecord {
  provider: string;
  success_count: number;
  failure_count: number;
  total_duration_ms: number;
  fetch_count: number;
  avg_duration_ms: number;
  success_rate: number;
}

export class ProviderAnalyticsService {
  constructor(private readonly redis: RedisClient) {}

  async recordSuccess(provider: string, durationMs: number): Promise<void> {
    const key = buildProviderAnalyticsKey(provider);
    await this.redis.hincrby(key, 'success_count', 1);
    await this.redis.hincrby(key, 'fetch_count', 1);
    await this.redis.hincrbyfloat(key, 'total_duration_ms', durationMs);
    await this.redis.hset(key, 'provider', provider);
  }

  async recordFailure(provider: string, durationMs: number): Promise<void> {
    const key = buildProviderAnalyticsKey(provider);
    await this.redis.hincrby(key, 'failure_count', 1);
    await this.redis.hincrby(key, 'fetch_count', 1);
    await this.redis.hincrbyfloat(key, 'total_duration_ms', durationMs);
    await this.redis.hset(key, 'provider', provider);
  }

  async getAll(providers: string[]): Promise<ProviderAnalyticsRecord[]> {
    const records = await Promise.all(providers.map((p) => this.getOne(p)));
    return records;
  }

  async getOne(provider: string): Promise<ProviderAnalyticsRecord> {
    const key = buildProviderAnalyticsKey(provider);
    const raw = await this.redis.hgetall(key);
    const success = Number(raw.success_count ?? 0);
    const failure = Number(raw.failure_count ?? 0);
    const fetchCount = Number(raw.fetch_count ?? 0);
    const totalDuration = Number(raw.total_duration_ms ?? 0);
    const total = success + failure;

    return {
      provider,
      success_count: success,
      failure_count: failure,
      total_duration_ms: totalDuration,
      fetch_count: fetchCount,
      avg_duration_ms: fetchCount > 0 ? Math.round(totalDuration / fetchCount) : 0,
      success_rate: total > 0 ? Number(((success / total) * 100).toFixed(1)) : 0,
    };
  }
}
