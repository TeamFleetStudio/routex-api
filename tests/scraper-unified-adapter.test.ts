import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { UnifiedScraperAdapter } from '../src/sources/implementations/scraper/unified-scraper.adapter.js';
import { buildBrightDataInputs } from '../src/sources/implementations/brightdata/bright-data-input.builder.js';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadEnv, resetEnvCache } from '../src/config/env.js';
import {
  loadBrightDataApiTokenFromCli,
  resolveBrightDataCredentialsPath,
} from '../src/config/bright-data-credentials.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const search = {
  from_city: 'Chennai',
  to_city: 'Bengaluru',
  travel_date: '2026-08-25',
};

describe('Unified scraper adapter', () => {
  it('maps nested pricing and availability fields', () => {
    const raw = [
      {
        source_site: 'redbus',
        source_listing_id: 'redbus-123',
        listing_url: 'https://www.redbus.in/bus-tickets/example',
        operator_name: 'Orange Tours',
        bus_type: 'AC Seater',
        departure_time: '22:30',
        arrival_time: '06:00',
        duration_minutes: 450,
        pricing: {
          price_inr: 799,
          base_price_inr: 999,
          discount_inr: 200,
          offer_text: 'Early bird',
        },
        availability: {
          seats_available: 12,
          availability_text: '12 seats left',
        },
        amenities: ['WiFi', 'Blanket'],
        rating: 4.2,
        rating_count: 180,
      },
    ];

    const [listing] = new UnifiedScraperAdapter('redbus').adapt(raw, search);

    expect(listing.source_site).toBe('redbus');
    expect(listing.source_listing_id).toBe('redbus-123');
    expect(listing.price_inr).toBe(799);
    expect(listing.base_price_inr).toBe(999);
    expect(listing.discount_inr).toBe(200);
    expect(listing.offer_text).toBe('Early bird');
    expect(listing.seats_available).toBe(12);
    expect(listing.availability_text).toBe('12 seats left');
    expect(listing.amenities).toEqual(['WiFi', 'Blanket']);
  });

  it('accepts wrapped records and flat legacy pricing fields', () => {
    const raw = {
      data: [
        {
          operator_name: 'Fresh Bus',
          departure_time: '11:00 PM',
          price_inr: 586,
          seats_available: 8,
        },
      ],
    };

    const [listing] = UnifiedScraperAdapter.forSite('abhibus').adapt(raw, search);
    expect(listing.source_site).toBe('abhibus');
    expect(listing.operator_name).toBe('Fresh Bus');
    expect(listing.departure_time).toBe('23:00');
    expect(listing.price_inr).toBe(586);
    expect(listing.seats_available).toBe(8);
  });

  it('normalizes legacy Bright Data AbhiBus records', () => {
    const fixture = JSON.parse(
      readFileSync(join(__dirname, 'fixtures/abhibus-bright-data.sample.json'), 'utf8'),
    );
    const [listing] = UnifiedScraperAdapter.forSite('abhibus').adapt(fixture, search);

    expect(listing.source_listing_id).toBe('4496365225');
    expect(listing.operator_name).toBe('Fresh Bus Electric');
    expect(listing.duration_minutes).toBe(405);
    expect(listing.price_inr).toBe(586);
    expect(listing.availability_text).toBe('Select Seats');
  });

  it('normalizes legacy Bright Data RedBus records', () => {
    const fixture = JSON.parse(
      readFileSync(join(__dirname, 'fixtures/redbus-bright-data.sample.json'), 'utf8'),
    );
    const [listing] = UnifiedScraperAdapter.forSite('redbus').adapt(fixture, search);

    expect(listing.source_listing_id).toBe('28692711');
    expect(listing.price_inr).toBe(990);
    expect(listing.base_price_inr).toBe(1100);
    expect(listing.discount_inr).toBe(110);
    expect(listing.duration_minutes).toBe(410);
  });

  it('maps legacy flat pricing field aliases', () => {
    const raw = {
      listings: [
        {
          listingId: 'abhi-42',
          url: 'https://www.abhibus.com/bus/42',
          travelName: 'Orange Tours',
          vehicleType: 'AC Sleeper',
          startTime: '10:30 PM',
          endTime: '06:15 AM',
          travelDurationMinutes: 465,
          fareAmount: '899',
          originalFare: '1099',
          seatsLeft: 8,
        },
      ],
    };

    const [listing] = UnifiedScraperAdapter.forSite('abhibus').adapt(raw, search);
    expect(listing.source_listing_id).toBe('abhi-42');
    expect(listing.operator_name).toBe('Orange Tours');
    expect(listing.departure_time).toBe('22:30');
    expect(listing.arrival_time).toBe('06:15');
    expect(listing.duration_minutes).toBe(465);
    expect(listing.price_inr).toBe(899);
    expect(listing.base_price_inr).toBe(1099);
    expect(listing.seats_available).toBe(8);
  });
});

describe('Bright Data input builder', () => {
  it('builds unified studio payload for RedBus', () => {
    const inputs = buildBrightDataInputs('redbus', search, 10);
    expect(inputs).toEqual([
      {
        site: 'redbus',
        url: expect.stringContaining('redbus.in'),
        from: 'Chennai',
        from_city: 'Chennai',
        to: 'Bangalore',
        to_city: 'Bangalore',
        date: '2026-08-25',
        time: '',
        limit: 10,
        enrich: 'true',
      },
    ]);
  });

  it('builds unified studio payload for AbhiBus with depart_after', () => {
    const inputs = buildBrightDataInputs(
      'abhibus',
      { ...search, depart_after: '18:00', limit: 5 },
      10,
    );
    expect(inputs).toEqual([
      {
        site: 'abhibus',
        url: expect.stringContaining('abhibus.com'),
        from: 'Chennai',
        from_city: 'Chennai',
        to: 'Bangalore',
        to_city: 'Bangalore',
        date: '2026-08-25',
        time: '18:00',
        limit: 5,
      },
    ]);
  });

  it('includes enrich flag for RedBus collector inputs', () => {
    const inputs = buildBrightDataInputs('redbus', search, 10);
    expect(inputs[0]).toEqual(
      expect.objectContaining({
        enrich: 'true',
        limit: 10,
        url: expect.stringContaining('redbus.in'),
      }),
    );
  });

  it('loads Bright Data token from CLI credentials file', () => {
    const dir = join(tmpdir(), `routex-brightdata-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    const credentialsPath = join(dir, 'credentials.json');
    writeFileSync(credentialsPath, JSON.stringify({ api_key: 'cli-token-123' }), 'utf8');

    const previous = process.env.BRIGHTDATA_CLI_CREDENTIALS_PATH;
    process.env.BRIGHTDATA_CLI_CREDENTIALS_PATH = credentialsPath;
    try {
      expect(resolveBrightDataCredentialsPath()).toBe(credentialsPath);
      expect(loadBrightDataApiTokenFromCli()).toBe('cli-token-123');

      resetEnvCache();
      const env = loadEnv({
        REDIS_URL: 'redis://localhost:6379',
        BRIGHT_DATA_API_TOKEN: '',
        BRIGHTDATA_API_KEY: '',
      });
      expect(env.BRIGHT_DATA_API_TOKEN).toBe('cli-token-123');
    } finally {
      if (previous === undefined) {
        delete process.env.BRIGHTDATA_CLI_CREDENTIALS_PATH;
      } else {
        process.env.BRIGHTDATA_CLI_CREDENTIALS_PATH = previous;
      }
      resetEnvCache();
    }
  });
});
