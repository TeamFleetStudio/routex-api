import type { RedisClient } from '../../config/redis.js';
import type { Env } from '../../config/env.js';
import { CacheError } from '../../errors/index.js';
import type { SearchSession } from '../../types/search-session.types.js';
import type { BusSearchRequest } from '../../types/bus.types.js';
import type { CacheFreshness } from './cache.service.js';
import { CacheService } from './cache.service.js';
import {
  buildRouteSessionIndexKey,
  buildSearchSessionKey,
} from '../../utils/cache-key.js';
import { logger } from '../../utils/logger.js';

export class SearchSessionService {
  private readonly cacheService: CacheService;

  constructor(
    private readonly redis: RedisClient,
    private readonly env: Env,
  ) {
    this.cacheService = new CacheService(redis);
  }

  async getSession(searchId: string): Promise<{
    session: SearchSession | null;
    freshness: CacheFreshness;
  }> {
    try {
      const raw = await this.redis.get(buildSearchSessionKey(searchId));
      if (!raw) {
        return { session: null, freshness: 'miss' };
      }

      const session = JSON.parse(raw) as SearchSession;
      const freshness = this.cacheService.evaluateFreshness({
        data: session,
        created_at: session.created_at,
        fresh_until: session.fresh_until,
        stale_until: session.stale_until,
      });

      return { session, freshness };
    } catch (err) {
      throw new CacheError('Failed to read search session', err);
    }
  }

  async getRouteSessionId(request: BusSearchRequest): Promise<string | null> {
    const key = buildRouteSessionIndexKey(
      request.from_city,
      request.to_city,
      request.travel_date,
      request.depart_after,
    );
    return this.redis.get(key);
  }

  async saveSession(session: SearchSession): Promise<void> {
    const staleTtlMs = this.env.PROVIDER_CACHE_STALE_MS;
    const sessionKey = buildSearchSessionKey(session.search_id);
    const routeKey = buildRouteSessionIndexKey(
      session.request.from_city,
      session.request.to_city,
      session.request.travel_date,
      session.request.depart_after,
    );

    try {
      await this.redis.set(sessionKey, JSON.stringify(session), 'PX', staleTtlMs);
      await this.redis.set(routeKey, session.search_id, 'PX', staleTtlMs);
      logger.info({
        event: 'SEARCH_SESSION_SAVED',
        search_id: session.search_id,
        total_buses: session.total_buses,
      });
    } catch (err) {
      throw new CacheError('Failed to save search session', err);
    }
  }

  buildSessionTimestamps(now = Date.now()): Pick<SearchSession, 'fresh_until' | 'stale_until'> {
    return {
      fresh_until: new Date(now + this.env.PROVIDER_CACHE_FRESH_MS).toISOString(),
      stale_until: new Date(now + this.env.PROVIDER_CACHE_STALE_MS).toISOString(),
    };
  }
}
