import { describe, expect, it } from 'vitest';
import { RedBusAdapter } from '../src/sources/implementations/redbus/redbus.adapter.js';
import { AbhiBusAdapter } from '../src/sources/implementations/abhibus/abhibus.adapter.js';
import { NormalizationService } from '../src/services/normalization/normalization.service.js';
import { MatchingScoreService } from '../src/services/matching/matching-score.service.js';
import { DefaultMatchingStrategy } from '../src/services/matching/default-matching.strategy.js';
import { BusMatchingService } from '../src/services/matching/bus-matching.service.js';
import { emptyNormalizedListing } from '../src/types/bus.types.js';

const search = {
  from_city: 'Chennai',
  to_city: 'Bengaluru',
  travel_date: '2026-08-25',
};

describe('normalization', () => {
  it('maps redbus Bright Data fields without inventing data', () => {
    const adapter = new RedBusAdapter();
    const [listing] = adapter.adapt(
      {
        records: [
          {
            operator_name: 'VRL',
            departure_time: '21:30',
            price: { value: 1224, currency: 'INR' },
          },
        ],
      },
      search,
    );

    expect(listing.operator_name).toBe('VRL');
    expect(listing.departure_time).toBe('21:30');
    expect(listing.price_inr).toBe(1224);
    expect(listing.bus_name).toBeNull();
    expect(listing.amenities).toEqual([]);
  });

  it('uses registered adapters via NormalizationService', () => {
    const service = new NormalizationService();
    service.register(new AbhiBusAdapter());
    const listings = service.normalize(
      'abhibus',
      {
        records: [
          {
            operator_name: 'SRS',
            pricing: { value: 999, currency: 'INR' },
          },
        ],
      },
      search,
    );
    expect(listings).toHaveLength(1);
    expect(listings[0].operator_name).toBe('SRS');
    expect(listings[0].price_inr).toBe(999);
  });
});

describe('matching architecture', () => {
  it('groups similar listings into canonical buses with savings', () => {
    const matching = new BusMatchingService(
      new DefaultMatchingStrategy(new MatchingScoreService()),
    );

    const a = {
      ...emptyNormalizedListing('redbus', search),
      operator_name: 'VRL Travels',
      departure_time: '23:00',
      arrival_time: '05:50',
      bus_type: 'AC Sleeper',
      duration_minutes: 410,
      price_inr: 1224,
    };
    const b = {
      ...emptyNormalizedListing('abhibus', search),
      operator_name: 'VRL Travels',
      departure_time: '23:00',
      arrival_time: '05:50',
      bus_type: 'AC Sleeper',
      duration_minutes: 410,
      price_inr: 1100,
    };
    const c = {
      ...emptyNormalizedListing('makemytrip', search),
      operator_name: 'Orange Tours',
      departure_time: '21:00',
      arrival_time: '04:00',
      bus_type: 'Non-AC Seater',
      duration_minutes: 420,
      price_inr: 800,
    };

    const results = matching.match([a, b, c]);
    expect(results).toHaveLength(2);
    const vrl = results.find((r) => (r.operator_name_normalized ?? '').includes('VRL'));
    expect(vrl?.offers).toHaveLength(2);
    expect(vrl?.cheapest_price_inr).toBe(1100);
    expect(vrl?.match_confidence).toBeGreaterThanOrEqual(80);
  });
});
