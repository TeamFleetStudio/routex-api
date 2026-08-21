/**
 * One-off probe: trigger Bright Data collectors and save raw JSON to tmp/.
 * Usage: npx tsx scripts/probe-bright-data.ts
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { loadEnv } from '../src/config/env.js';
import { BrightDataClient } from '../src/sources/implementations/brightdata/bright-data.client.js';
import {
  buildAbhiBusSearchUrl,
  buildRedBusSearchUrl,
} from '../src/sources/implementations/brightdata/url-builders.js';

async function probeOne(
  name: string,
  client: BrightDataClient,
  collectorId: string,
  inputs: unknown[],
): Promise<void> {
  console.log(`[${name}] triggering...`);
  const records = await client.collect(collectorId, inputs);
  await mkdir('tmp', { recursive: true });
  const path = `tmp/${name}-raw.json`;
  await writeFile(path, JSON.stringify(records, null, 2), 'utf8');
  console.log(`[${name}] saved ${records.length} record(s) → ${path}`);
  if (records[0] && typeof records[0] === 'object') {
    console.log(`[${name}] top-level keys:`, Object.keys(records[0] as object));
  }
}

async function main(): Promise<void> {
  const env = loadEnv();
  if (!env.BRIGHT_DATA_API_TOKEN) {
    throw new Error('BRIGHT_DATA_API_TOKEN is required');
  }

  const from = 'Chennai';
  const to = 'Bengaluru';
  const date = '2026-08-25';

  const redbusUrl = buildRedBusSearchUrl(from, to, date);
  if (!redbusUrl) throw new Error('Failed to build RedBus URL');
  const abhiUrl = buildAbhiBusSearchUrl(from, to);

  console.log('RedBus URL:', redbusUrl);
  console.log('AbhiBus URL:', abhiUrl);

  const redbusClient = new BrightDataClient({
    apiToken: env.BRIGHT_DATA_API_TOKEN,
    baseUrl: env.BRIGHT_DATA_BASE_URL,
    pollIntervalMs: env.BRIGHT_DATA_POLL_INTERVAL_MS,
    maxPollAttempts: env.BRIGHT_DATA_MAX_POLL_ATTEMPTS,
    sourceName: 'redbus',
  });

  const abhiClient = new BrightDataClient({
    apiToken: env.BRIGHT_DATA_API_TOKEN,
    baseUrl: env.BRIGHT_DATA_BASE_URL,
    pollIntervalMs: env.BRIGHT_DATA_POLL_INTERVAL_MS,
    maxPollAttempts: env.BRIGHT_DATA_MAX_POLL_ATTEMPTS,
    sourceName: 'abhibus',
  });

  // Run sequentially to avoid slamming the API
  await probeOne('redbus', redbusClient, env.REDBUS_COLLECTOR_ID, [{ url: redbusUrl }]);
  await probeOne('abhibus', abhiClient, env.ABHIBUS_COLLECTOR_ID, [
    { url: abhiUrl, limit: env.ABHIBUS_RESULT_LIMIT },
  ]);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
