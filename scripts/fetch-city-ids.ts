/**
 * Fetch RedBus city IDs via autocomplete API for seeding city registry.
 * Usage: npx tsx scripts/fetch-city-ids.ts
 */
import { writeFileSync } from 'node:fs';
import { request } from 'undici';

const CITIES = [
  'Chennai',
  'Bengaluru',
  'Bangalore',
  'Theni',
  'Madurai',
  'Coimbatore',
  'Trichy',
  'Tiruchirapalli',
  'Salem',
  'Hosur',
  'Pondicherry',
  'Puducherry',
  'Hyderabad',
  'Mumbai',
  'Pune',
  'Delhi',
  'Kochi',
  'Trivandrum',
  'Thiruvananthapuram',
  'Erode',
  'Dindigul',
  'Tirunelveli',
  'Nagercoil',
  'Vellore',
  'Thanjavur',
  'Kumbakonam',
  'Karur',
  'Namakkal',
  'Sivakasi',
  'Virudhunagar',
  'Bangalore',
];

async function fetchRedBus(query: string): Promise<unknown> {
  const url = `https://www.redbus.in/api/get_city_suggestions?query=${encodeURIComponent(query)}`;
  const res = await request(url, { headers: { accept: 'application/json' } });
  const body = await res.body.text();
  return JSON.parse(body);
}

async function main(): Promise<void> {
  const results: Record<string, unknown> = {};
  for (const city of [...new Set(CITIES)]) {
    try {
      results[city] = await fetchRedBus(city);
      console.log('OK', city);
    } catch (err) {
      console.error('FAIL', city, err instanceof Error ? err.message : err);
    }
  }
  writeFileSync('tmp/redbus-city-suggestions.json', JSON.stringify(results, null, 2));
  console.log('Saved tmp/redbus-city-suggestions.json');
}

main().catch(console.error);
