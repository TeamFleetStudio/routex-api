import { describe, expect, it } from 'vitest';
import { MatchingScoreService } from '../src/services/matching/matching-score.service.js';
import { DefaultMatchingStrategy } from '../src/services/matching/default-matching.strategy.js';
import { NormalizationEnrichmentService } from '../src/services/matching/normalization-enrichment.service.js';
import { BusMatchingService } from '../src/services/matching/bus-matching.service.js';
import { emptyNormalizedListing } from '../src/types/bus.types.js';
import {
  normalizeTimeTo24h,
  parseDurationMinutes,
  parsePriceInr,
  timeToMinutes,
} from '../src/utils/time.js';

const search = {
  from_city: 'Chennai',
  to_city: 'Bengaluru',
  travel_date: '2026-08-25',
};

describe('enrichment parsers', () => {
  const enrichment = new NormalizationEnrichmentService();

  it('parses prices with currency and starting-from text', () => {
    expect(parsePriceInr('₹1,250')).toBe(1250);
    expect(parsePriceInr('850.00')).toBe(850);
    expect(parsePriceInr('Starting from ₹999')).toBe(999);
  });

  it('normalizes times including dotted am/pm', () => {
    expect(normalizeTimeTo24h('10:30 PM')).toBe('22:30');
    expect(normalizeTimeTo24h('10.30 pm')).toBe('22:30');
    expect(normalizeTimeTo24h('22:30')).toBe('22:30');
    expect(timeToMinutes('22:30')).toBe(1350);
  });

  it('parses duration formats', () => {
    expect(parseDurationMinutes('8h 30m')).toBe(510);
    expect(parseDurationMinutes('08:30')).toBe(510);
    expect(parseDurationMinutes('9 hours')).toBe(540);
  });

  it('normalizes operator and bus type tags', () => {
    expect(enrichment.normalizeOperatorName('Orange Tours & Travels')).toBe('ORANGE TOURS');
    expect(enrichment.normalizeOperatorName('ORANGE TOURS')).toBe('ORANGE TOURS');
    expect(enrichment.normalizeBusTypeTags('A/C Sleeper (2+1), Multi Axle')).toEqual([
      'AC',
      'SLEEPER',
      'MULTI_AXLE',
    ]);
    expect(enrichment.normalizeBusTypeTags('Non-AC Seater')).toEqual(['NON_AC', 'SEATER']);
  });
});

describe('similarity scoring', () => {
  const enrichment = new NormalizationEnrichmentService();
  const scorer = new MatchingScoreService();

  function listing(partial: Record<string, unknown>) {
    return enrichment.enrich({
      ...emptyNormalizedListing('redbus', search),
      ...partial,
    } as ReturnType<typeof emptyNormalizedListing>);
  }

  it('scores exact same service near 100', () => {
    const a = listing({
      operator_name: 'Orange Tours',
      bus_type: 'A/C Sleeper',
      departure_time: '22:00',
      arrival_time: '05:50',
      duration_minutes: 470,
      price_inr: 1200,
    });
    const b = listing({
      source_site: 'abhibus',
      operator_name: 'Orange Tours & Travels',
      bus_type: 'AC Sleeper (2+1)',
      departure_time: '22:10',
      arrival_time: '06:00',
      duration_minutes: 470,
      price_inr: 1050,
    });
    expect(scorer.score(a, b)).toBeGreaterThanOrEqual(80);
  });

  it('scores clearly different buses below 65', () => {
    const a = listing({
      operator_name: 'VRL Travels',
      bus_type: 'AC Sleeper',
      departure_time: '22:00',
      arrival_time: '05:00',
      duration_minutes: 420,
    });
    const b = listing({
      operator_name: 'SRS Travels',
      bus_type: 'Non-AC Seater',
      departure_time: '10:00',
      arrival_time: '18:00',
      duration_minutes: 480,
    });
    expect(scorer.score(a, b)).toBeLessThan(65);
  });
});

describe('cross-site grouping and savings', () => {
  it('groups RedBus and AbhiBus offers and computes savings', () => {
    const matching = new BusMatchingService(
      new DefaultMatchingStrategy(new MatchingScoreService()),
    );

    const results = matching.match([
      {
        ...emptyNormalizedListing('redbus', search),
        operator_name: 'Orange Tours',
        bus_type: 'A/C Sleeper (2+1)',
        departure_time: '22:00',
        arrival_time: '05:50',
        duration_minutes: 470,
        price_inr: 1200,
        rating: 4.5,
      },
      {
        ...emptyNormalizedListing('abhibus', search),
        operator_name: 'Orange Tours & Travels',
        bus_type: 'AC Sleeper',
        departure_time: '22:15',
        arrival_time: '06:00',
        duration_minutes: 465,
        price_inr: 1050,
        rating: 4.4,
      },
      {
        ...emptyNormalizedListing('makemytrip', search),
        operator_name: 'Different Operator XYZ',
        bus_type: 'Non-AC Seater',
        departure_time: '09:00',
        arrival_time: '17:00',
        duration_minutes: 480,
        price_inr: 800,
      },
    ]);

    expect(results.length).toBeGreaterThanOrEqual(2);

    const orange = results.find((r) =>
      (r.operator_name_normalized ?? '').includes('ORANGE'),
    );
    expect(orange).toBeTruthy();
    expect(orange!.offers.length).toBe(2);
    expect(orange!.cheapest_price_inr).toBe(1050);
    expect(orange!.cheapest_provider).toBe('abhibus');
    expect(orange!.match_confidence).toBeGreaterThanOrEqual(80);

    const redbusOffer = orange!.offers.find((o) => o.source === 'redbus');
    expect(redbusOffer?.difference_from_cheapest).toBe(150);
    expect(redbusOffer?.difference_percentage).toBeCloseTo(12.5, 1);

    // Sorted by deal score — cheaper groups should rank well
    expect(results[0].deal_score).toBeGreaterThanOrEqual(results[1].deal_score);
  });

  it('keeps unmatched buses separate and may attach similar_alternatives', () => {
    const matching = new BusMatchingService(
      new DefaultMatchingStrategy(new MatchingScoreService()),
    );

    const results = matching.match([
      {
        ...emptyNormalizedListing('redbus', search),
        operator_name: 'VRL Travels',
        bus_type: 'AC Sleeper',
        departure_time: '23:00',
        arrival_time: '05:50',
        duration_minutes: 410,
        price_inr: 1224,
      },
      {
        ...emptyNormalizedListing('abhibus', search),
        operator_name: 'VRL Travels',
        bus_type: 'AC Sleeper',
        departure_time: '23:00',
        arrival_time: '05:50',
        duration_minutes: 410,
        price_inr: 1100,
      },
    ]);

    expect(results).toHaveLength(1);
    expect(results[0].offers).toHaveLength(2);
    expect(results[0].match_tier).toBe('same');
    expect(results[0].bus_type_normalized).toContain('AC');
    expect(results[0].bus_type_normalized).toContain('SLEEPER');
  });
});
