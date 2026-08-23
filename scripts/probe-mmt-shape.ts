import { mkdirSync, writeFileSync } from 'node:fs';
import { loadEnv } from '../src/config/env.js';
import { BrightDataClient } from '../src/sources/implementations/brightdata/bright-data.client.js';
import {
  buildBrightDataInputs,
  resolveCollectorId,
} from '../src/sources/implementations/brightdata/bright-data-input.builder.js';
import { UnifiedScraperAdapter } from '../src/sources/implementations/scraper/unified-scraper.adapter.js';

async function main(): Promise<void> {
  const env = loadEnv();
  const withOverride = process.argv.includes('--no-override') ? false : true;
  const client = new BrightDataClient({
    apiToken: env.BRIGHT_DATA_API_TOKEN,
    baseUrl: env.BRIGHT_DATA_BASE_URL,
    pollIntervalMs: 5_000,
    maxPollAttempts: 24,
    sourceName: 'makemytrip',
    overrideIncompatibleSchema: withOverride,
  });

  const search = {
    from_city: process.argv[2] ?? 'Delhi',
    to_city: process.argv[3] ?? 'Jaipur',
    travel_date: process.argv[4] ?? '2026-08-26',
  };

  const inputs = buildBrightDataInputs('makemytrip', search, 10);
  const collectorId = resolveCollectorId('makemytrip', env);
  console.log('override:', withOverride, 'collector:', collectorId, 'inputs:', JSON.stringify(inputs));

  try {
    const records = await client.collect(collectorId, inputs);
    mkdirSync('tmp', { recursive: true });
    writeFileSync('tmp/mmt-latest.json', JSON.stringify(records, null, 2));
    console.log('records:', records.length);
    console.log('top keys:', Object.keys((records[0] as object) ?? {}));
    const listings = UnifiedScraperAdapter.forSite('makemytrip').adapt(records, search);
    console.log('normalized:', listings.length);
    if (listings[0]) console.log(JSON.stringify(listings[0], null, 2).slice(0, 800));
  } catch (err) {
    console.error('FAILED:', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  }
}

main();
