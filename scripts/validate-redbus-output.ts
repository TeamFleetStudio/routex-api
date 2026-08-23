/**
 * Validate normalization + full-schema collector test.
 * Usage: npx tsx scripts/validate-redbus-output.ts
 */
import { readFileSync, existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { loadEnv } from '../src/config/env.js';
import { BrightDataClient } from '../src/sources/implementations/brightdata/bright-data.client.js';
import { buildBrightDataInputs } from '../src/sources/implementations/brightdata/bright-data-input.builder.js';
import { UnifiedScraperAdapter } from '../src/sources/implementations/scraper/unified-scraper.adapter.js';

const search = {
  from_city: 'Bangalore',
  to_city: 'Hyderabad',
  travel_date: '2026-08-23',
};

async function main(): Promise<void> {
  const urlOnlyPath = 'tmp/redbus-url-only-raw.json';
  if (existsSync(urlOnlyPath)) {
    const raw = JSON.parse(readFileSync(urlOnlyPath, 'utf8')) as unknown;
    const listings = UnifiedScraperAdapter.forSite('redbus').adapt(raw, search);
    console.log('URL-only normalization:', listings.length, 'listings');
    const sample = listings[0];
    console.log({
      operator: sample?.operator_name,
      price_inr: sample?.price_inr,
      base_price_inr: sample?.base_price_inr,
      seats_available: sample?.seats_available,
      source_listing_id: sample?.source_listing_id,
    });
  }

  const env = loadEnv();
  const inputs = buildBrightDataInputs('redbus', search, env.SCRAPER_DEFAULT_LIMIT);
  console.log('\nFull schema inputs:', JSON.stringify(inputs, null, 2));

  const client = new BrightDataClient({
    apiToken: env.BRIGHT_DATA_API_TOKEN,
    baseUrl: env.BRIGHT_DATA_BASE_URL,
    pollIntervalMs: env.BRIGHT_DATA_POLL_INTERVAL_MS,
    maxPollAttempts: env.BRIGHT_DATA_MAX_POLL_ATTEMPTS,
    sourceName: 'redbus',
  });

  console.log('\nTriggering full-schema collect...');
  const records = await client.collect(env.REDBUS_COLLECTOR_ID, inputs);
  await mkdir('tmp', { recursive: true });
  await writeFile('tmp/redbus-full-schema-raw.json', JSON.stringify(records, null, 2));
  console.log('Full schema:', records.length, 'records saved');

  const normalized = UnifiedScraperAdapter.forSite('redbus').adapt(records, search);
  console.log('Full schema normalization:', normalized.length, 'listings');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
