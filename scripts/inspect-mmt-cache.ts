import { createRedisClient, connectRedis } from '../src/config/redis.js';
import { loadEnv } from '../src/config/env.js';

async function main(): Promise<void> {
  const env = loadEnv();
  const redis = createRedisClient(env);
  await connectRedis(redis);

  const patterns = ['routex:provider:makemytrip:*', 'routex:session:*'];
  for (const pattern of patterns) {
    const keys = await redis.keys(pattern);
    console.log(`\n${pattern}: ${keys.length} keys`);
    for (const k of keys.slice(0, 10)) {
      const v = await redis.get(k);
      if (!v) continue;
      try {
        const parsed = JSON.parse(v) as {
          status?: string;
          failure_kind?: string;
          message?: string;
          retry_after?: string;
          sources?: Array<{ source: string; status: string }>;
        };
        if (parsed.sources) {
          const mmt = parsed.sources.find((s) => s.source === 'makemytrip');
          if (mmt) console.log(k, 'session mmt:', mmt.status, mmt.message?.slice(0, 60));
        } else {
          console.log(k, parsed.status, parsed.failure_kind, parsed.message?.slice(0, 80));
        }
      } catch {
        console.log(k, v.slice(0, 120));
      }
    }
  }

  await redis.quit();
}

main();
