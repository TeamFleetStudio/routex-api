import { Redis } from 'ioredis';
import type { Env } from './env.js';
import { logger } from '../utils/logger.js';

export type RedisClient = Redis;

export function createRedisClient(env: Env): RedisClient {
  const client = new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
    lazyConnect: true,
  });

  client.on('error', (err: Error) => {
    logger.error({ event: 'REDIS_ERROR', err: { message: err.message } }, 'Redis client error');
  });

  return client;
}

export async function connectRedis(client: RedisClient): Promise<void> {
  if (client.status === 'wait' || client.status === 'end') {
    await client.connect();
  }
  await client.ping();
}

export async function checkRedisHealth(
  client: RedisClient,
): Promise<'CONNECTED' | 'DISCONNECTED'> {
  try {
    const pong = await client.ping();
    return pong === 'PONG' ? 'CONNECTED' : 'DISCONNECTED';
  } catch {
    return 'DISCONNECTED';
  }
}
