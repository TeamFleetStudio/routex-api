import { randomUUID } from 'node:crypto';
import type { RedisClient } from '../../config/redis.js';
import { sleep } from '../../utils/time.js';
import { logger } from '../../utils/logger.js';

const RELEASE_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
else
  return 0
end
`;

export class DistributedLockService {
  constructor(
    private readonly redis: RedisClient,
    private readonly defaultTtlMs: number,
    private readonly waitMs: number,
    private readonly pollMs: number,
  ) {}

  async acquire(key: string, ttlMs = this.defaultTtlMs): Promise<string | null> {
    const token = randomUUID();
    const result = await this.redis.set(key, token, 'PX', ttlMs, 'NX');
    if (result === 'OK') {
      logger.info({ event: 'LOCK_ACQUIRED', key });
      return token;
    }
    logger.info({ event: 'LOCK_WAITING', key });
    return null;
  }

  async release(key: string, token: string): Promise<void> {
    await this.redis.eval(RELEASE_SCRIPT, 1, key, token);
    logger.info({ event: 'LOCK_RELEASED', key });
  }

  async waitForCache<T>(
    read: () => Promise<T | null>,
    waitMs = this.waitMs,
    pollMs = this.pollMs,
  ): Promise<T | null> {
    const deadline = Date.now() + waitMs;
    while (Date.now() < deadline) {
      const value = await read();
      if (value !== null) return value;
      await sleep(pollMs);
    }
    return null;
  }
}
