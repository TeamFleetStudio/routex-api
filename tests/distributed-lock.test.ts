import { describe, expect, it, vi } from 'vitest';
import { DistributedLockService } from '../src/services/cache/distributed-lock.service.js';

describe('distributed locking', () => {
  it('acquires lock when Redis SET NX succeeds', async () => {
    const redis = {
      set: vi.fn().mockResolvedValue('OK'),
      eval: vi.fn().mockResolvedValue(1),
    };
    const locks = new DistributedLockService(redis as never, 15_000, 100, 10);
    const token = await locks.acquire('routex:lock:search:a:b:2026-08-25');
    expect(token).toBeTruthy();
    await locks.release('routex:lock:search:a:b:2026-08-25', token!);
    expect(redis.eval).toHaveBeenCalled();
  });

  it('returns null when lock already held', async () => {
    const redis = {
      set: vi.fn().mockResolvedValue(null),
    };
    const locks = new DistributedLockService(redis as never, 15_000, 50, 10);
    const token = await locks.acquire('routex:lock:search:a:b:2026-08-25');
    expect(token).toBeNull();
  });

  it('waits briefly for cache value', async () => {
    const locks = new DistributedLockService({} as never, 15_000, 80, 20);
    let calls = 0;
    const value = await locks.waitForCache(async () => {
      calls += 1;
      return calls >= 2 ? { ok: true } : null;
    });
    expect(value).toEqual({ ok: true });
  });
});
