import { describe, expect, it } from 'vitest';
import {
  BUS_SITES,
  CITY_DEFINITIONS,
  findCity,
  getAllSiteCollectorIds,
  listCitiesForSite,
  resolveAbhiBusCityId,
  resolveRedBusCityId,
  resolveCityDisplayName,
} from '../src/sources/implementations/brightdata/city-registry.js';
import {
  buildAbhiBusSearchUrl,
  buildRedBusSearchUrl,
  buildSourceSearchUrl,
} from '../src/sources/implementations/brightdata/url-builders.js';

describe('city registry', () => {
  it('maps both bus sites with collector env keys', () => {
    expect(BUS_SITES).toHaveLength(2);
    expect(BUS_SITES.map((s) => s.site)).toEqual(['redbus', 'abhibus']);
    expect(BUS_SITES[0].defaultCollectorId).toBe('c_mt45kbsacfoxm1vlm');
    expect(BUS_SITES[1].defaultCollectorId).toBe('c_mt494k6m154fl23cty');
  });

  it('resolves aliases to canonical city names and IDs', () => {
    expect(resolveCityDisplayName('bengaluru')).toBe('Bangalore');
    expect(resolveRedBusCityId('madras')).toBe(123);
    expect(resolveRedBusCityId('theni')).toBe(744);
    expect(resolveAbhiBusCityId('chennai')).toBe(6);
    expect(resolveAbhiBusCityId('bangalore')).toBe(7);
    expect(findCity('trichy')?.name).toBe('Tiruchirapalli');
  });

  it('lists collector IDs from env overrides', () => {
    const ids = getAllSiteCollectorIds({
      REDBUS_COLLECTOR_ID: 'c_red',
      ABHIBUS_COLLECTOR_ID: 'c_abhi',
    });
    expect(ids).toEqual({
      redbus: 'c_red',
      abhibus: 'c_abhi',
    });
  });

  it('has RedBus and AbhiBus IDs for every seeded city', () => {
    for (const city of CITY_DEFINITIONS) {
      expect(city.redbusId, city.name).toBeTypeOf('number');
      expect(city.abhibusId, city.name).toBeTypeOf('number');
    }
    expect(listCitiesForSite('redbus').length).toBe(CITY_DEFINITIONS.length);
  });
});

describe('site URL builders with registry IDs', () => {
  const search = {
    from_city: 'Chennai',
    to_city: 'Theni',
    travel_date: '2026-08-25',
  };

  it('builds RedBus URL with city IDs for Chennai → Theni', () => {
    const url = buildRedBusSearchUrl('Chennai', 'Theni', '2026-08-25');
    expect(url).toContain('fromCityId=123');
    expect(url).toContain('toCityId=744');
    expect(url).toContain('onward=25-Aug-2026');
  });

  it('builds AbhiBus bus_search URL with numeric city IDs when date provided', () => {
    const url = buildAbhiBusSearchUrl('Chennai', 'Theni', '2026-08-25');
    expect(url).toContain('/bus_search/Chennai/6/Theni/33/25-08-2026/O');
  });

  it('builds per-site search URLs from registry', () => {
    expect(buildSourceSearchUrl('redbus', search)).toContain('fromCityId=123');
    expect(buildSourceSearchUrl('abhibus', search)).toContain('/bus_search/Chennai/6/Theni/33/');
  });
});
