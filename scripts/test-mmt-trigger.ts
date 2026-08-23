import { loadEnv } from '../src/config/env.js';
import { BrightDataClient } from '../src/sources/implementations/brightdata/bright-data.client.js';
import {
  buildBrightDataInputs,
  resolveCollectorId,
} from '../src/sources/implementations/brightdata/bright-data-input.builder.js';

async function main(): Promise<void> {
  const env = loadEnv();
  console.log('override_incompatible_schema:', env.BRIGHT_DATA_OVERRIDE_INCOMPATIBLE_SCHEMA);

  const client = new BrightDataClient({
    apiToken: env.BRIGHT_DATA_API_TOKEN,
    baseUrl: env.BRIGHT_DATA_BASE_URL,
    pollIntervalMs: 5_000,
    maxPollAttempts: 24,
    sourceName: 'makemytrip',
    overrideIncompatibleSchema: env.BRIGHT_DATA_OVERRIDE_INCOMPATIBLE_SCHEMA,
  });

  const search = {
    from_city: process.argv[2] ?? 'Goa',
    to_city: process.argv[3] ?? 'Mumbai',
    travel_date: process.argv[4] ?? '2026-08-26',
  };

  const inputs = buildBrightDataInputs('makemytrip', search, 10);
  const collectorId = resolveCollectorId('makemytrip', env);
  console.log('collector:', collectorId);
  console.log('inputs:', JSON.stringify(inputs));

  try {
    const collectionId = await client.trigger(collectorId, inputs);
    console.log('trigger OK, collection_id:', collectionId);
    const records = await client.pollUntilReady(collectionId);
    console.log('poll OK, records:', records.length);
  } catch (err) {
    console.error('FAILED:', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  }
}

main();
