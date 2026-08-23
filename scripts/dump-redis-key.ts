import { createRedisClient, connectRedis } from '../src/config/redis.js';
import { loadEnv } from '../src/config/env.js';

async function main(): Promise<void> {
  const env = loadEnv();
  const redis = createRedisClient(env);
  await connectRedis(redis);
  const key = process.argv[2] ?? 'routex:provider:makemytrip:chennai:mumbai:2026-08-23:after-1800';
  const v = await redis.get(key);
  console.log(JSON.stringify(JSON.parse(v ?? '{}'), null, 2));
  await redis.quit();
}

main();
