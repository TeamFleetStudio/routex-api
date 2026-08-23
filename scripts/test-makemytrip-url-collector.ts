/**
 * One-off test: trigger MakeMyTrip collector with URL-only payload.
 * Usage: npx tsx scripts/test-makemytrip-url-collector.ts
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { loadEnv } from '../src/config/env.js';
import { BrightDataClient } from '../src/sources/implementations/brightdata/bright-data.client.js';

const MMT_URL =
  'https://www.makemytrip.com/bus-tickets/delhi-jaipur-bus-ticket-booking.html';

async function main(): Promise<void> {
  const env = loadEnv();
  if (!env.BRIGHT_DATA_API_TOKEN) {
    throw new Error('BRIGHT_DATA_API_TOKEN is required');
  }

  const collectorId = env.MAKEMYTRIP_COLLECTOR_ID ?? 'c_mt5m1h3uvef2inukz';
  const inputs = [{ url: MMT_URL }];
  console.log('Collector ID:', collectorId);
  console.log('Inputs:', JSON.stringify(inputs, null, 2));

  const client = new BrightDataClient({
    apiToken: env.BRIGHT_DATA_API_TOKEN,
    baseUrl: env.BRIGHT_DATA_BASE_URL,
    pollIntervalMs: env.BRIGHT_DATA_POLL_INTERVAL_MS,
    maxPollAttempts: env.BRIGHT_DATA_MAX_POLL_ATTEMPTS,
    sourceName: 'makemytrip',
  });

  console.log('Triggering...');
  const collectionId = await client.trigger(collectorId, inputs);
  console.log('collection_id:', collectionId);

  console.log('Polling for results...');
  const records = await client.pollUntilReady(collectionId);

  await mkdir('tmp', { recursive: true });
  const path = 'tmp/makemytrip-url-only-raw.json';
  await writeFile(path, JSON.stringify(records, null, 2), 'utf8');
  console.log(`Saved ${records.length} record(s) → ${path}`);
  if (records[0] && typeof records[0] === 'object') {
    console.log('Top-level keys:', Object.keys(records[0] as object));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
