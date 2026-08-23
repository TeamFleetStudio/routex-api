/**
 * One-off test: trigger RedBus collector with URL-only payload (matches Bright Data snippet).
 * Usage: npx tsx scripts/test-redbus-url-collector.ts
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { loadEnv } from '../src/config/env.js';
import { BrightDataClient } from '../src/sources/implementations/brightdata/bright-data.client.js';

const REDBUS_URL =
  'https://www.redbus.in/bus-tickets/bangalore-to-hyderabad?fromCityName=Bangalore&fromCityId=122&toCityName=Hyderabad&toCityId=124&onward=23-Aug-2026&srcCountry=IND&destCountry=IND&opId=0&busType=Any';

async function main(): Promise<void> {
  const env = loadEnv();
  if (!env.BRIGHT_DATA_API_TOKEN) {
    throw new Error('BRIGHT_DATA_API_TOKEN is required');
  }

  const inputs = [{ url: REDBUS_URL }];
  console.log('Collector ID:', env.REDBUS_COLLECTOR_ID);
  console.log('Inputs:', JSON.stringify(inputs, null, 2));

  const client = new BrightDataClient({
    apiToken: env.BRIGHT_DATA_API_TOKEN,
    baseUrl: env.BRIGHT_DATA_BASE_URL,
    pollIntervalMs: env.BRIGHT_DATA_POLL_INTERVAL_MS,
    maxPollAttempts: env.BRIGHT_DATA_MAX_POLL_ATTEMPTS,
    sourceName: 'redbus',
  });

  console.log('Triggering...');
  const collectionId = await client.trigger(env.REDBUS_COLLECTOR_ID, inputs);
  console.log('collection_id:', collectionId);

  console.log('Polling for results...');
  const records = await client.pollUntilReady(collectionId);

  await mkdir('tmp', { recursive: true });
  const path = 'tmp/redbus-url-only-raw.json';
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
