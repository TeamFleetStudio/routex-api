import type { RedisClient } from '../../config/redis.js';
import { CacheError } from '../../errors/index.js';
import type { BusSearchResponse } from '../../types/api.types.js';
import { logger } from '../../utils/logger.js';

export interface CacheEntry<T> {
  data: T;
  fresh_until: string;
  stale_until: string;
  created_at: string;
}

export type CacheFreshness = 'fresh' | 'stale' | 'expired' | 'miss';

export class CacheService {
  constructor(private readonly redis: RedisClient) {}

  async getSearch(key: string): Promise<{
    entry: CacheEntry<BusSearchResponse> | null;
    freshness: CacheFreshness;
  }> {
    try {
      const raw = await this.redis.get(key);
      if (!raw) {
        logger.info({ event: 'CACHE_MISS', key });
        return { entry: null, freshness: 'miss' };
      }

      const entry = JSON.parse(raw) as CacheEntry<BusSearchResponse>;
      const freshness = this.evaluateFreshness(entry);
      if (freshness === 'fresh') {
        logger.info({ event: 'CACHE_HIT', key, freshness });
      } else if (freshness === 'stale') {
        logger.info({ event: 'CACHE_STALE_RETURNED', key });
      } else {
        logger.info({ event: 'CACHE_MISS', key, freshness: 'expired' });
      }
      return { entry, freshness };
    } catch (err) {
      throw new CacheError('Failed to read search cache', err);
    }
  }

  async setSearch(
    key: string,
    data: BusSearchResponse,
    freshTtlMs: number,
    staleTtlMs: number,
  ): Promise<void> {
    try {
      const createdAt = new Date().toISOString();
      const entry: CacheEntry<BusSearchResponse> = {
        data,
        created_at: createdAt,
        fresh_until: new Date(Date.now() + freshTtlMs).toISOString(),
        stale_until: new Date(Date.now() + staleTtlMs).toISOString(),
      };
      await this.redis.set(key, JSON.stringify(entry), 'PX', staleTtlMs);
      logger.info({ event: 'CACHE_UPDATED', key, fresh_ttl_ms: freshTtlMs, stale_ttl_ms: staleTtlMs });
    } catch (err) {
      throw new CacheError('Failed to write search cache', err);
    }
  }

  evaluateFreshness(entry: CacheEntry<unknown>, now = Date.now()): CacheFreshness {
    const freshUntil = Date.parse(entry.fresh_until);
    const staleUntil = Date.parse(entry.stale_until);
    if (Number.isNaN(freshUntil) || Number.isNaN(staleUntil)) {
      return 'expired';
    }
    if (now < freshUntil) return 'fresh';
    if (now < staleUntil) return 'stale';
    return 'expired';
  }
}
