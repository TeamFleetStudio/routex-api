/**
 * Bus site + city ID registry for Bright Data collectors.
 * RedBus / AbhiBus use numeric IDs for URL building.
 */

export type BusSite = 'redbus' | 'abhibus';

export interface SiteDefinition {
  site: BusSite;
  label: string;
  collectorEnvKey: string;
  defaultCollectorId: string;
  usesNumericCityIds: boolean;
}

export interface CityDefinition {
  /** Canonical display name */
  name: string;
  aliases: string[];
  redbusId?: number;
  abhibusId?: number;
  /** Slug override when different from auto-slug */
  slug?: string;
}

export const BUS_SITES: SiteDefinition[] = [
  {
    site: 'redbus',
    label: 'RedBus',
    collectorEnvKey: 'REDBUS_COLLECTOR_ID',
    defaultCollectorId: 'c_mt5kcpdj13nspwzrzd',
    usesNumericCityIds: true,
  },
  {
    site: 'abhibus',
    label: 'AbhiBus',
    collectorEnvKey: 'ABHIBUS_COLLECTOR_ID',
    defaultCollectorId: 'c_mt494k6m154fl23cty',
    usesNumericCityIds: true,
  },
];

/** Major Indian bus cities with per-site IDs where applicable. */
export const CITY_DEFINITIONS: CityDefinition[] = [
  { name: 'Chennai', aliases: ['chennai', 'madras'], redbusId: 123, abhibusId: 6 },
  { name: 'Bangalore', aliases: ['bangalore', 'bengaluru', 'bangaluru'], redbusId: 122, abhibusId: 7, slug: 'bangalore' },
  { name: 'Hyderabad', aliases: ['hyderabad', 'secunderabad'], redbusId: 124, abhibusId: 12 },
  { name: 'Mumbai', aliases: ['mumbai', 'bombay'], redbusId: 462, abhibusId: 17 },
  { name: 'Pune', aliases: ['pune', 'poona'], redbusId: 130, abhibusId: 18 },
  { name: 'Delhi', aliases: ['delhi', 'new delhi', 'ncr'], redbusId: 733, abhibusId: 21 },
  { name: 'Kolkata', aliases: ['kolkata', 'calcutta'], redbusId: 734, abhibusId: 20 },
  { name: 'Ahmedabad', aliases: ['ahmedabad'], redbusId: 735, abhibusId: 19 },
  { name: 'Coimbatore', aliases: ['coimbatore', 'kovai'], redbusId: 736, abhibusId: 29 },
  { name: 'Madurai', aliases: ['madurai'], redbusId: 731, abhibusId: 30 },
  { name: 'Tiruchirapalli', aliases: ['tiruchirapalli', 'trichy', 'trichirapalli'], redbusId: 737, abhibusId: 31, slug: 'trichy' },
  { name: 'Salem', aliases: ['salem'], redbusId: 738, abhibusId: 32 },
  { name: 'Theni', aliases: ['theni'], redbusId: 744, abhibusId: 33 },
  { name: 'Pondicherry', aliases: ['pondicherry', 'puducherry', 'pondy'], redbusId: 743, abhibusId: 34, slug: 'pondicherry' },
  { name: 'Hosur', aliases: ['hosur'], redbusId: 775, abhibusId: 35 },
  { name: 'Kochi', aliases: ['kochi', 'cochin', 'ernakulam'], redbusId: 725, abhibusId: 36, slug: 'kochi' },
  { name: 'Thiruvananthapuram', aliases: ['thiruvananthapuram', 'trivandrum'], redbusId: 739, abhibusId: 37, slug: 'trivandrum' },
  { name: 'Erode', aliases: ['erode'], redbusId: 740, abhibusId: 38 },
  { name: 'Dindigul', aliases: ['dindigul'], redbusId: 741, abhibusId: 39 },
  { name: 'Tirunelveli', aliases: ['tirunelveli', 'nellai'], redbusId: 742, abhibusId: 40 },
  { name: 'Nagercoil', aliases: ['nagercoil'], redbusId: 745, abhibusId: 41 },
  { name: 'Vellore', aliases: ['vellore'], redbusId: 746, abhibusId: 42 },
  { name: 'Thanjavur', aliases: ['thanjavur', 'tanjore'], redbusId: 747, abhibusId: 43 },
  { name: 'Kumbakonam', aliases: ['kumbakonam'], redbusId: 748, abhibusId: 44 },
  { name: 'Karur', aliases: ['karur'], redbusId: 749, abhibusId: 45 },
  { name: 'Namakkal', aliases: ['namakkal'], redbusId: 750, abhibusId: 46 },
  { name: 'Sivakasi', aliases: ['sivakasi'], redbusId: 751, abhibusId: 47 },
  { name: 'Virudhunagar', aliases: ['virudhunagar'], redbusId: 752, abhibusId: 48 },
  { name: 'Karaikudi', aliases: ['karaikudi'], redbusId: 753, abhibusId: 49 },
  { name: 'Thoothukudi', aliases: ['thoothukudi', 'tuticorin'], redbusId: 754, abhibusId: 50, slug: 'tuticorin' },
  { name: 'Cuddalore', aliases: ['cuddalore'], redbusId: 755, abhibusId: 51 },
  { name: 'Villupuram', aliases: ['villupuram'], redbusId: 756, abhibusId: 52 },
  { name: 'Mysore', aliases: ['mysore', 'mysuru'], redbusId: 757, abhibusId: 53, slug: 'mysore' },
  { name: 'Mangalore', aliases: ['mangalore', 'mangaluru'], redbusId: 758, abhibusId: 54, slug: 'mangalore' },
  { name: 'Hubli', aliases: ['hubli', 'hubballi'], redbusId: 759, abhibusId: 55 },
  { name: 'Visakhapatnam', aliases: ['visakhapatnam', 'vizag'], redbusId: 760, abhibusId: 56, slug: 'visakhapatnam' },
  { name: 'Vijayawada', aliases: ['vijayawada'], redbusId: 761, abhibusId: 57 },
  { name: 'Indore', aliases: ['indore'], redbusId: 313, abhibusId: 58 },
  { name: 'Bhopal', aliases: ['bhopal'], redbusId: 979, abhibusId: 59 },
  { name: 'Jaipur', aliases: ['jaipur'], redbusId: 762, abhibusId: 60 },
  { name: 'Surat', aliases: ['surat'], redbusId: 763, abhibusId: 61 },
  { name: 'Goa', aliases: ['goa', 'panaji', 'panjim'], redbusId: 764, abhibusId: 62, slug: 'goa' },
  { name: 'Lucknow', aliases: ['lucknow'], redbusId: 765, abhibusId: 63 },
  { name: 'Nagpur', aliases: ['nagpur'], redbusId: 766, abhibusId: 64 },
  { name: 'Chandigarh', aliases: ['chandigarh'], redbusId: 767, abhibusId: 65 },
  { name: 'Amritsar', aliases: ['amritsar'], redbusId: 768, abhibusId: 66 },
  { name: 'Jodhpur', aliases: ['jodhpur'], redbusId: 769, abhibusId: 67 },
  { name: 'Udaipur', aliases: ['udaipur'], redbusId: 770, abhibusId: 68 },
  { name: 'Raipur', aliases: ['raipur'], redbusId: 771, abhibusId: 69 },
  { name: 'Patna', aliases: ['patna'], redbusId: 772, abhibusId: 70 },
  { name: 'Ranchi', aliases: ['ranchi'], redbusId: 773, abhibusId: 71 },
  { name: 'Guwahati', aliases: ['guwahati'], redbusId: 774, abhibusId: 72 },
];

const aliasIndex = new Map<string, CityDefinition>();

for (const city of CITY_DEFINITIONS) {
  aliasIndex.set(normalizeCityKey(city.name), city);
  for (const alias of city.aliases) {
    aliasIndex.set(normalizeCityKey(alias), city);
  }
}

export function normalizeCityKey(city: string): string {
  return city.trim().toLowerCase().replace(/\s+/g, ' ');
}

export function findCity(city: string): CityDefinition | null {
  return aliasIndex.get(normalizeCityKey(city)) ?? null;
}

export function resolveCityDisplayName(city: string): string {
  return findCity(city)?.name ?? city.trim().replace(/\b\w/g, (c) => c.toUpperCase());
}

export function resolveRedBusCityId(city: string): number | null {
  return findCity(city)?.redbusId ?? null;
}

export function resolveAbhiBusCityId(city: string): number | null {
  return findCity(city)?.abhibusId ?? null;
}

export function slugifyCity(city: string): string {
  const def = findCity(city);
  const base = def?.slug ?? def?.name ?? city;
  return base
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

export function getSiteDefinition(site: BusSite): SiteDefinition {
  const def = BUS_SITES.find((s) => s.site === site);
  if (!def) throw new Error(`Unknown site: ${site}`);
  return def;
}

export function getAllSiteCollectorIds(env: Record<string, string | undefined>): Record<BusSite, string> {
  return {
    redbus: env.REDBUS_COLLECTOR_ID ?? getSiteDefinition('redbus').defaultCollectorId,
    abhibus: getSiteDefinition('abhibus').defaultCollectorId,
  };
}

export function listCitiesForSite(site: BusSite): Array<{ name: string; id: number | null }> {
  return CITY_DEFINITIONS.map((city) => ({
    name: city.name,
    id:
      site === 'redbus'
        ? (city.redbusId ?? null)
        : site === 'abhibus'
          ? (city.abhibusId ?? null)
          : null,
  }));
}
