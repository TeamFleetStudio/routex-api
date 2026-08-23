import { createRedisClient, connectRedis } from '../src/config/redis.js';
import { loadEnv } from '../src/config/env.js';

/** Clear every MakeMyTrip failure + sessions that still show MMT FAILED/SKIPPED. */
async function main(): Promise<void> {
  const env = loadEnv();
  const redis = createRedisClient(env);
  await connectRedis(redis);

  let cleared = 0;
  for (const key of await redis.keys('routex:provider:makemytrip:*')) {
    const raw = await redis.get(key);
    if (!raw) continue;
    const entry = JSON.parse(raw) as { status?: string };
    if (entry.status === 'failed') {
      await redis.del(key);
      cleared += 1;
      console.log('cleared', key);
    }
  }

  let sessions = 0;
  for (const key of await redis.keys('routex:search-session:*')) {
    const raw = await redis.get(key);
    if (!raw) continue;
    const session = JSON.parse(raw) as {
      search_id?: string;
      sources?: Array<{ source: string; status: string }>;
    };
    const bad = session.sources?.some(
      (s) =>
        s.source === 'makemytrip' &&
        (s.status === 'FAILED' || s.status === 'SKIPPED' || s.status === 'TIMEOUT'),
    );
    if (bad) {
      await redis.del(key);
      sessions += 1;
      console.log('cleared session', key);
    }
  }

  for (const key of await redis.keys('routex:route-session:*')) {
    const searchId = await redis.get(key);
    if (!searchId) continue;
    if (!(await redis.exists(`routex:search-session:${searchId}`))) {
      await redis.del(key);
      console.log('cleared orphan route', key);
    }
  }

  // Circuit may be open after many prod 422s
  for (const key of await redis.keys('routex:circuit:makemytrip*')) {
    await redis.del(key);
    console.log('cleared circuit', key);
  }
  for (const key of await redis.keys('routex:source:health:makemytrip*')) {
    await redis.del(key);
    console.log('cleared health', key);
  }

  console.log(`\nDone: ${cleared} provider failures, ${sessions} sessions`);
  await redis.quit();
}

main();
