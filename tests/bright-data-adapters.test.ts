import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { RedBusAdapter } from '../src/sources/implementations/redbus/redbus.adapter.js';
import { AbhiBusAdapter } from '../src/sources/implementations/abhibus/abhibus.adapter.js';
import {
  buildAbhiBusSearchUrl,
  buildRedBusSearchUrl,
  formatRedBusDate,
} from '../src/sources/implementations/brightdata/url-builders.js';
import { parseDurationMinutes, parseSeatsAvailable } from '../src/utils/time.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const search = {
  from_city: 'Chennai',
  to_city: 'Bengaluru',
  travel_date: '2026-08-25',
};

describe('Bright Data URL builders', () => {
  it('builds RedBus URL with city ids and date', () => {
    const url = buildRedBusSearchUrl('Chennai', 'Bengaluru', '2026-08-25');
    expect(url).toContain('fromCityId=123');
    expect(url).toContain('toCityId=122');
    expect(url).toContain('onward=25-Aug-2026');
    expect(formatRedBusDate('2026-08-25')).toBe('25-Aug-2026');
  });

  it('returns null for unknown RedBus cities', () => {
    expect(buildRedBusSearchUrl('Atlantis', 'Chennai', '2026-08-25')).toBeNull();
  });

  it('builds AbhiBus URL with display names', () => {
    expect(buildAbhiBusSearchUrl('Chennai', 'Bengaluru')).toBe(
      'https://www.abhibus.com/buses/2/Chennai-Bangalore',
    );
  });
});

describe('Bright Data adapters', () => {
  it('normalizes RedBus Bright Data records', () => {
    const fixture = JSON.parse(
      readFileSync(join(__dirname, 'fixtures/redbus-bright-data.sample.json'), 'utf8'),
    );
    const [listing] = new RedBusAdapter().adapt({ records: fixture }, search);

    expect(listing.source_site).toBe('redbus');
    expect(listing.source_listing_id).toBe('28692711');
    expect(listing.operator_name).toBe('Jai Sai Baba Travels');
    expect(listing.departure_time).toBe('23:00');
    expect(listing.arrival_time).toBe('05:50');
    expect(listing.duration_minutes).toBe(410);
    expect(listing.price_inr).toBe(990);
    expect(listing.base_price_inr).toBe(1100);
    expect(listing.discount_inr).toBe(110);
    expect(listing.seats_available).toBe(23);
    expect(listing.rating).toBe(4.9);
  });

  it('normalizes AbhiBus Bright Data records', () => {
    const fixture = JSON.parse(
      readFileSync(join(__dirname, 'fixtures/abhibus-bright-data.sample.json'), 'utf8'),
    );
    const [listing] = new AbhiBusAdapter().adapt({ records: fixture }, search);

    expect(listing.source_site).toBe('abhibus');
    expect(listing.source_listing_id).toBe('4496365225');
    expect(listing.operator_name).toBe('Fresh Bus Electric');
    expect(listing.duration_minutes).toBe(405);
    expect(listing.price_inr).toBe(586);
    expect(listing.amenities).toEqual(['10+']);
    expect(listing.availability_text).toBe('Select Seats');
  });
});

describe('duration and seats helpers', () => {
  it('parses mixed duration formats', () => {
    expect(parseDurationMinutes('6h 50m')).toBe(410);
    expect(parseDurationMinutes('06h.45m')).toBe(405);
  });

  it('parses seats text', () => {
    expect(parseSeatsAvailable('23 Seats')).toBe(23);
    expect(parseSeatsAvailable('Select Seats')).toBeNull();
  });
});
