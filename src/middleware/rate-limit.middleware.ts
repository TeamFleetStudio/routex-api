import type { FastifyPluginAsync } from 'fastify';
import type { RedisClient } from '../config/redis.js';
import type { Env } from '../config/env.js';
import { RateLimitExceededError } from '../errors/index.js';
import { buildRateLimitKey } from '../utils/cache-key.js';

export interface RateLimitDeps {
  redis: RedisClient;
  env: Env;
}

export function createRateLimitPlugin(deps: RateLimitDeps): FastifyPluginAsync {
  return async (app) => {
    app.addHook('onRequest', async (request) => {
      if (request.url.startsWith('/health')) {
        return;
      }

      const ip = request.ip || 'unknown';
      const key = buildRateLimitKey(ip);
      const windowMs = deps.env.RATE_LIMIT_WINDOW_MS;
      const max = deps.env.RATE_LIMIT_MAX;

      const count = await deps.redis.incr(key);
      if (count === 1) {
        await deps.redis.pexpire(key, windowMs);
      }

      if (count > max) {
        request.log.warn({ event: 'RATE_LIMIT_EXCEEDED', ip, count, max });
        throw new RateLimitExceededError();
      }
    });
  };
}
