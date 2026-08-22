/**
 * Smoke-test Bright Data CLI self-healing.
 * Usage: npx tsx scripts/test-healing.ts [source]
 * Example: npx tsx scripts/test-healing.ts redbus
 */
import { loadEnv } from '../src/config/env.js';
import { SelfHealingService } from '../src/services/self-healing/self-healing.service.js';
import { DistributedLockService } from '../src/services/cache/distributed-lock.service.js';
import { SourceHealthService } from '../src/services/sources/source-health.service.js';
import { createRedisClient, connectRedis } from '../src/config/redis.js';
import {
  buildSourceSearchUrl,
  resolveCollectorId,
  type BrightDataSite,
} from '../src/sources/implementations/brightdata/bright-data-input.builder.js';
import {
  buildHealOutputPath,
  buildHealPrompt,
} from '../src/services/self-healing/bright-data-cli-heal.service.js';

const source = (process.argv[2] ?? 'redbus') as BrightDataSite;
const search = {
  from_city: 'Chennai',
  to_city: 'Theni',
  travel_date: '2026-08-25',
};

async function main(): Promise<void> {
  const env = loadEnv();
  const collectorId = resolveCollectorId(source, env);
  const url = buildSourceSearchUrl(source, search);
  const output = buildHealOutputPath(env, source);
  const prompt = buildHealPrompt({
    source,
    collectorId,
    search,
    failure_kind: 'TIMEOUT',
    message: 'Smoke test: verify price_inr and operator_name extraction after page drift.',
  });

  console.log('\n=== Healing smoke test ===');
  console.log('Source:      ', source);
  console.log('Collector:   ', collectorId);
  console.log('URL:         ', url);
  console.log('Output:      ', output);
  console.log('Timeout (s): ', env.SELF_HEALING_CLI_TIMEOUT_SEC);
  console.log('CLI bin:     ', env.BRIGHTDATA_CLI_BIN);
  console.log('\nCommand:');
  console.log(
    `${env.BRIGHTDATA_CLI_BIN} scraper heal ${collectorId} "${prompt.slice(0, 80)}..." \\`,
  );
  console.log(`  --url "${url}" \\`);
  console.log(`  --auto-approve --auto-save --timeout ${env.SELF_HEALING_CLI_TIMEOUT_SEC} \\`);
  console.log(`  --pretty -o ${output}`);
  console.log('\nRunning heal via SelfHealingService...\n');

  const redis = createRedisClient(env);
  await connectRedis(redis);

  const locks = new DistributedLockService(redis, env.LOCK_TTL_MS, env.LOCK_WAIT_MS, env.LOCK_POLL_MS);
  const health = new SourceHealthService(redis);
  const healing = new SelfHealingService(env, locks, health);

  const started = Date.now();
  const ok = await healing.tryHeal(source, {
    search,
    failure_kind: 'TIMEOUT',
    message: 'Smoke test heal — price_inr returns null on Chennai to Theni route.',
  });

  console.log('\n=== Result ===');
  console.log('Healed:      ', ok);
  console.log('Duration (s):', Math.round((Date.now() - started) / 1000));
  console.log('Output file: ', output);

  await redis.quit();
  process.exit(ok ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
