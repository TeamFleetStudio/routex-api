import type { FastifyPluginAsync } from 'fastify';
import type { RedisClient } from '../config/redis.js';
import { checkRedisHealth } from '../config/redis.js';

export function createHealthRoutes(redis: RedisClient): FastifyPluginAsync {
  return async (app) => {
    app.get('/health', async () => ({ status: 'UP' as const }));

    app.get('/health/redis', async (_request, reply) => {
      const redisStatus = await checkRedisHealth(redis);
      const status = redisStatus === 'CONNECTED' ? 'UP' : 'DOWN';
      await reply.status(status === 'UP' ? 200 : 503).send({
        status,
        redis: redisStatus,
      });
    });
  };
}
