import { createRedisClient, connectRedis } from '../src/config/redis.js';
import { loadEnv } from '../src/config/env.js';

async function main(): Promise<void> {
  const env = loadEnv();
  const redis = createRedisClient(env);
  await connectRedis(redis);

  const pattern = process.argv[2] ?? 'routex:search-session:*';
  const keys = await redis.keys(pattern);
  console.log(`${pattern}: ${keys.length} keys`);

  for (const k of keys.slice(0, 5)) {
    const v = await redis.get(k);
    if (!v) continue;
    const parsed = JSON.parse(v) as {
      search_id?: string;
      request?: { from_city: string; to_city: string };
      sources?: Array<{ source: string; status: string; message?: string }>;
    };
    const mmt = parsed.sources?.find((s) => s.source === 'makemytrip');
    console.log(
      k,
      parsed.request?.from_city,
      '→',
      parsed.request?.to_city,
      mmt ? `mmt=${mmt.status}` : '',
    );
  }

  const routeKeys = await redis.keys('routex:route-session:*');
  console.log(`\nroutex:route-session:*: ${routeKeys.length}`);

  await redis.quit();
}

main();
