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
  it('maps redbus provider fields without inventing data', () => {
    const adapter = new RedBusAdapter();
    const [listing] = adapter.adapt(
      {
        listings: [
          {
            travels: 'VRL',
            deptTime: '9:30 PM',
            fare: '₹1,224',
          },
        ],
      },
      search,
    );

    expect(listing.operator_name).toBe('VRL');
    expect(listing.departure_time).toBe('21:30');
    expect(listing.pricing.price_inr).toBe(1224);
    expect(listing.bus_name).toBeNull();
    expect(listing.amenities).toEqual([]);
  });

  it('rewrites listing_url onto the correct search route + busId', () => {
    const adapter = new RedBusAdapter();
    const [listing] = adapter.adapt(
      {
        search_url:
          'https://www.redbus.in/bus-tickets/madurai-to-chennai?onward=22-Aug-2026&doj=22-Aug-2026',
        listings: [
          {
            listing_url: '46383458',
            product_page_url:
              'https://www.redbus.in/bus-tickets/chennai-to-bangalore?fromCityId=126&fromCityName=Madurai&toCityId=123&toCityName=Chennai&onward=22-Aug-2026&doj=22-Aug-2026&busId=19659509',
            travels: 'zingbus plus',
            fare: 395,
          },
        ],
      },
      {
        from_city: 'Madurai',
        to_city: 'Chennai',
        travel_date: '2026-08-22',
      },
    );

    expect(listing.source_listing_id).toBe('19659509');
    expect(listing.listing_url).toContain('/bus-tickets/madurai-to-chennai?');
    expect(listing.listing_url).toContain('busId=19659509');
    expect(listing.listing_url).toContain('fromCityName=Madurai');
    expect(listing.listing_url).not.toContain('chennai-to-bangalore');
  });

  it('uses registered adapters via NormalizationService', () => {
    const service = new NormalizationService();
    service.register(new AbhiBusAdapter());
    const listings = service.normalize(
      'abhibus',
      { listings: [{ operator: 'SRS', price: 999 }] },
      search,
    );
    expect(listings).toHaveLength(1);
    expect(listings[0].operator_name).toBe('SRS');
    expect(listings[0].pricing.price_inr).toBe(999);
  });
});

describe('matching architecture', () => {
  it('groups similar listings into canonical buses', () => {
    const matching = new BusMatchingService(
      new DefaultMatchingStrategy(new MatchingScoreService()),
    );

    const a = {
      ...emptyNormalizedListing('redbus', search),
      operator_name: 'VRL Travels',
      departure_time: '23:00',
      arrival_time: '05:50',
      bus_type: 'AC Sleeper',
      pricing: { price_inr: 1224, base_price_inr: null, discount_inr: null, offer_text: null },
    };
    const b = {
      ...emptyNormalizedListing('abhibus', search),
      operator_name: 'VRL Travels',
      departure_time: '23:00',
      arrival_time: '05:50',
      bus_type: 'AC Sleeper',
      pricing: { price_inr: 1100, base_price_inr: null, discount_inr: null, offer_text: null },
    };
    const c = {
      ...emptyNormalizedListing('makemytrip', search),
      operator_name: 'Orange Tours',
      departure_time: '21:00',
      arrival_time: '04:00',
      bus_type: 'Non-AC Seater',
      pricing: { price_inr: 800, base_price_inr: null, discount_inr: null, offer_text: null },
    };

    const results = matching.match([a, b, c]);
    expect(results).toHaveLength(2);
    const vrl = results.find((r) => r.operator_name === 'VRL Travels');
    expect(vrl?.offers).toHaveLength(2);
    expect(vrl?.match_confidence).toBeGreaterThan(0.5);
  });
});
