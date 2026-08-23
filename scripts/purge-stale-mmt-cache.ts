import { createRedisClient, connectRedis } from '../src/config/redis.js';
import { loadEnv } from '../src/config/env.js';

async function main(): Promise<void> {
  const env = loadEnv();
  const redis = createRedisClient(env);
  await connectRedis(redis);

  const providerKeys = await redis.keys('routex:provider:makemytrip:*');
  let deletedProviders = 0;

  for (const key of providerKeys) {
    const raw = await redis.get(key);
    if (!raw) continue;
    const entry = JSON.parse(raw) as {
      status?: string;
      failure_kind?: string;
      message?: string;
      listings?: unknown[];
    };
    const isStale422 =
      entry.status === 'failed' &&
      (entry.failure_kind === 'RESPONSE_STRUCTURE_CHANGED' ||
        entry.message?.includes('422') ||
        entry.message?.toLowerCase().includes('output_schema_incompatible'));
    if (isStale422) {
      await redis.del(key);
      deletedProviders += 1;
      console.log('deleted provider', key);
    }
  }

  const sessionKeys = await redis.keys('routex:search-session:*');
  let clearedSessions = 0;

  for (const key of sessionKeys) {
    const raw = await redis.get(key);
    if (!raw) continue;
    const session = JSON.parse(raw) as {
      sources?: Array<{ source: string; status: string; message?: string }>;
    };
    const hasSkippedMmt = session.sources?.some(
      (s) =>
        s.source === 'makemytrip' &&
        (s.status === 'SKIPPED' ||
          (s.status === 'FAILED' && s.message?.includes('422'))),
    );
    if (hasSkippedMmt) {
      await redis.del(key);
      clearedSessions += 1;
      console.log('deleted session', key);
    }
  }

  const routeKeys = await redis.keys('routex:route-session:*');
  for (const key of routeKeys) {
    const searchId = await redis.get(key);
    if (!searchId) continue;
    const exists = await redis.exists(`routex:search-session:${searchId}`);
    if (!exists) {
      await redis.del(key);
      console.log('deleted orphan route index', key);
    }
  }

  console.log(`\nDone: ${deletedProviders} provider keys, ${clearedSessions} sessions`);
  await redis.quit();
}

main();
