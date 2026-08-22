import { describe, expect, it } from 'vitest';
import { loadEnv, resetEnvCache } from '../src/config/env.js';
import { busSearchBodySchema } from '../src/schemas/search.schema.js';
import {
  buildBrightDataInputs,
  resolveCollectorId,
} from '../src/sources/implementations/brightdata/bright-data-input.builder.js';
import {
  buildAbhiBusSearchUrl,
  buildRedBusSearchUrl,
  buildSourceSearchUrl,
} from '../src/sources/implementations/brightdata/url-builders.js';
import {
  findCity,
  getAllSiteCollectorIds,
  resolveAbhiBusCityId,
  resolveRedBusCityId,
  resolveCityDisplayName,
} from '../src/sources/implementations/brightdata/city-registry.js';
import type { BusSearchRequest } from '../src/types/bus.types.js';

const FUTURE_DATE = '2099-08-25';

describe('multiple city alias resolutions', () => {
  const cases: Array<{ input: string; display: string; redbusId: number; abhibusId: number }> = [
    { input: 'madras', display: 'Chennai', redbusId: 123, abhibusId: 6 },
    { input: 'bengaluru', display: 'Bangalore', redbusId: 122, abhibusId: 7 },
    { input: 'theni', display: 'Theni', redbusId: 744, abhibusId: 33 },
    { input: 'trichy', display: 'Tiruchirapalli', redbusId: 737, abhibusId: 31 },
    { input: 'vizag', display: 'Visakhapatnam', redbusId: 760, abhibusId: 56 },
    { input: 'trivandrum', display: 'Thiruvananthapuram', redbusId: 739, abhibusId: 37 },
  ];

  it.each(cases)('resolves $input → $display with IDs', ({ input, display, redbusId, abhibusId }) => {
    expect(resolveCityDisplayName(input)).toBe(display);
    expect(resolveRedBusCityId(input)).toBe(redbusId);
    expect(resolveAbhiBusCityId(input)).toBe(abhibusId);
    expect(findCity(input)?.name).toBe(display);
  });
});

describe('multiple route URL builders', () => {
  const routes: Array<{
    name: string;
    from: string;
    to: string;
    redbusContains: string[];
    abhibusContains: string[];
  }> = [
    {
      name: 'Chennai → Bangalore',
      from: 'Chennai',
      to: 'Bengaluru',
      redbusContains: ['fromCityId=123', 'toCityId=122', '25-Aug-2099'],
      abhibusContains: ['/bus_search/Chennai/6/Bangalore/7/25-08-2099/O'],
    },
    {
      name: 'Chennai → Theni',
      from: 'Chennai',
      to: 'Theni',
      redbusContains: ['fromCityId=123', 'toCityId=744'],
      abhibusContains: ['/bus_search/Chennai/6/Theni/33/25-08-2099/O'],
    },
    {
      name: 'Madurai → Coimbatore',
      from: 'Madurai',
      to: 'Coimbatore',
      redbusContains: ['fromCityId=731', 'toCityId=736'],
      abhibusContains: ['/bus_search/Madurai/30/Coimbatore/29/'],
    },
    {
      name: 'Hyderabad → Mumbai',
      from: 'Hyderabad',
      to: 'Mumbai',
      redbusContains: ['fromCityId=124', 'toCityId=462'],
      abhibusContains: ['/bus_search/Hyderabad/12/Mumbai/17/'],
    },
  ];

  it.each(routes)('builds URLs for $name', ({ from, to, redbusContains, abhibusContains }) => {
    const redbusUrl = buildRedBusSearchUrl(from, to, FUTURE_DATE);
    const abhibusUrl = buildAbhiBusSearchUrl(from, to, FUTURE_DATE);

    for (const part of redbusContains) {
      expect(redbusUrl, `redbus missing ${part}`).toContain(part);
    }
    for (const part of abhibusContains) {
      expect(abhibusUrl, `abhibus missing ${part}`).toContain(part);
    }
  });
});

describe('multiple Bright Data studio payloads', () => {
  const payloadCases: Array<{
    name: string;
    site: 'redbus' | 'abhibus';
    search: BusSearchRequest;
    defaultLimit: number;
    expectEnrich: boolean;
    urlHost: string;
  }> = [
    {
      name: 'redbus Chennai → Bengaluru default',
      site: 'redbus',
      search: { from_city: 'Chennai', to_city: 'Bengaluru', travel_date: FUTURE_DATE },
      defaultLimit: 10,
      expectEnrich: true,
      urlHost: 'redbus.in',
    },
    {
      name: 'abhibus Chennai → Theni with depart_after',
      site: 'abhibus',
      search: {
        from_city: 'Chennai',
        to_city: 'Theni',
        travel_date: FUTURE_DATE,
        depart_after: '18:00',
      },
      defaultLimit: 10,
      expectEnrich: false,
      urlHost: 'abhibus.com',
    },
    {
      name: 'redbus alias madras → bengaluru with limit',
      site: 'redbus',
      search: {
        from_city: 'madras',
        to_city: 'bengaluru',
        travel_date: FUTURE_DATE,
        limit: 3,
      },
      defaultLimit: 10,
      expectEnrich: true,
      urlHost: 'redbus.in',
    },
    {
      name: 'abhibus time alias overrides empty depart_after',
      site: 'abhibus',
      search: {
        from_city: 'Chennai',
        to_city: 'Bangalore',
        travel_date: FUTURE_DATE,
        depart_after: '06:30',
        limit: 5,
      },
      defaultLimit: 10,
      expectEnrich: false,
      urlHost: 'abhibus.com',
    },
    {
      name: 'redbus Madurai → Coimbatore',
      site: 'redbus',
      search: { from_city: 'Madurai', to_city: 'Coimbatore', travel_date: FUTURE_DATE },
      defaultLimit: 10,
      expectEnrich: true,
      urlHost: 'redbus.in',
    },
  ];

  it.each(payloadCases)(
    'builds studio payload: $name',
    ({ site, search, defaultLimit, expectEnrich, urlHost }) => {
      const [input] = buildBrightDataInputs(site, search, defaultLimit);

      expect(input.site).toBe(site);
      expect(input.from).toBe(resolveCityDisplayName(search.from_city));
      expect(input.to).toBe(resolveCityDisplayName(search.to_city));
      expect(input.from_city).toBe(input.from);
      expect(input.to_city).toBe(input.to);
      expect(input.date).toBe(FUTURE_DATE);
      expect(input.time).toBe(search.depart_after?.trim() ?? '');
      expect(input.limit).toBe(search.limit ?? defaultLimit);
      expect(input.url).toContain(urlHost);

      if (expectEnrich) {
        expect(input.enrich).toBe('true');
      } else {
        expect(input.enrich).toBeUndefined();
      }
    },
  );
});

describe('collector ID resolution', () => {
  it('uses new default collector IDs for both sites', () => {
    resetEnvCache();
    const env = loadEnv({ REDIS_URL: 'redis://localhost:6379' });

    expect(resolveCollectorId('redbus', env)).toBe('c_mt45kbsacfoxm1vlm');
    expect(resolveCollectorId('abhibus', env)).toBe('c_mt494k6m154fl23cty');

    const ids = getAllSiteCollectorIds({});
    expect(ids.redbus).toBe('c_mt45kbsacfoxm1vlm');
    expect(ids.abhibus).toBe('c_mt494k6m154fl23cty');
  });

  it('respects env overrides for collector IDs', () => {
    resetEnvCache();
    const env = loadEnv({
      REDIS_URL: 'redis://localhost:6379',
      REDBUS_COLLECTOR_ID: 'c_custom_red',
      ABHIBUS_COLLECTOR_ID: 'c_custom_abhi',
    });

    expect(resolveCollectorId('redbus', env)).toBe('c_custom_red');
    expect(resolveCollectorId('abhibus', env)).toBe('c_custom_abhi');
  });
});

describe('search API validation — multiple cases', () => {
  const validCases: Array<{ name: string; body: Record<string, unknown> }> = [
    {
      name: 'minimal required fields',
      body: { from_city: 'Chennai', to_city: 'Theni', travel_date: FUTURE_DATE },
    },
    {
      name: 'depart_after filter',
      body: {
        from_city: 'Chennai',
        to_city: 'Bengaluru',
        travel_date: FUTURE_DATE,
        depart_after: '18:00',
      },
    },
    {
      name: 'time alias',
      body: {
        from_city: 'Chennai',
        to_city: 'Bengaluru',
        travel_date: FUTURE_DATE,
        time: '06:00',
      },
    },
    {
      name: 'limit override',
      body: {
        from_city: 'Madurai',
        to_city: 'Coimbatore',
        travel_date: FUTURE_DATE,
        limit: 5,
      },
    },
    {
      name: 'city aliases in request',
      body: {
        from_city: 'madras',
        to_city: 'bengaluru',
        travel_date: FUTURE_DATE,
        depart_after: '22:00',
        limit: 3,
      },
    },
  ];

  const invalidCases: Array<{ name: string; body: Record<string, unknown> }> = [
    {
      name: 'same origin and destination',
      body: { from_city: 'Chennai', to_city: 'chennai', travel_date: FUTURE_DATE },
    },
    {
      name: 'past date',
      body: { from_city: 'Chennai', to_city: 'Theni', travel_date: '2020-01-01' },
    },
    {
      name: 'invalid date format',
      body: { from_city: 'Chennai', to_city: 'Theni', travel_date: '25-08-2099' },
    },
    {
      name: 'invalid depart_after',
      body: {
        from_city: 'Chennai',
        to_city: 'Theni',
        travel_date: FUTURE_DATE,
        depart_after: '6pm',
      },
    },
    {
      name: 'limit zero',
      body: {
        from_city: 'Chennai',
        to_city: 'Theni',
        travel_date: FUTURE_DATE,
        limit: 0,
      },
    },
    {
      name: 'empty from_city',
      body: { from_city: '', to_city: 'Theni', travel_date: FUTURE_DATE },
    },
  ];

  it.each(validCases)('accepts valid case: $name', ({ body }) => {
    const result = busSearchBodySchema.safeParse(body);
    expect(result.success).toBe(true);
  });

  it.each(invalidCases)('rejects invalid case: $name', ({ body }) => {
    const result = busSearchBodySchema.safeParse(body);
    expect(result.success).toBe(false);
  });
});

describe('buildSourceSearchUrl for both sites', () => {
  const search: BusSearchRequest = {
    from_city: 'Chennai',
    to_city: 'Theni',
    travel_date: FUTURE_DATE,
  };

  it('redbus URL uses city IDs', () => {
    const url = buildSourceSearchUrl('redbus', search);
    expect(url).toContain('redbus.in');
    expect(url).toContain('fromCityId=123');
    expect(url).toContain('toCityId=744');
  });

  it('abhibus URL uses bus_search path', () => {
    const url = buildSourceSearchUrl('abhibus', search);
    expect(url).toContain('abhibus.com');
    expect(url).toContain('/bus_search/Chennai/6/Theni/33/');
  });
});
