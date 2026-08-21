/** Canonical city aliases used when building provider URLs. */
const CITY_ALIASES: Record<string, string> = {
  bengaluru: 'Bangalore',
  bangalore: 'Bangalore',
  chennai: 'Chennai',
  madras: 'Chennai',
};

/** RedBus city IDs for known routes (expand as needed). */
const REDBUS_CITY_IDS: Record<string, number> = {
  chennai: 123,
  madras: 123,
  bangalore: 122,
  bengaluru: 122,
};

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

function normalizeKey(city: string): string {
  return city.trim().toLowerCase().replace(/\s+/g, ' ');
}

export function resolveCityDisplayName(city: string): string {
  const key = normalizeKey(city);
  return CITY_ALIASES[key] ?? city.trim().replace(/\b\w/g, (c) => c.toUpperCase());
}

export function resolveRedBusCityId(city: string): number | null {
  const key = normalizeKey(city);
  return REDBUS_CITY_IDS[key] ?? null;
}

/** Format YYYY-MM-DD → 25-Aug-2026 */
export function formatRedBusDate(travelDate: string): string {
  const [y, m, d] = travelDate.split('-').map(Number);
  const day = String(d).padStart(2, '0');
  const month = MONTHS[m - 1];
  return `${day}-${month}-${y}`;
}

export function slugifyCityForPath(city: string): string {
  return resolveCityDisplayName(city)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

export function buildAbhiBusSearchUrl(fromCity: string, toCity: string): string {
  const from = resolveCityDisplayName(fromCity);
  const to = resolveCityDisplayName(toCity);
  return `https://www.abhibus.com/buses/2/${encodeURIComponent(from)}-${encodeURIComponent(to)}`;
}

export function buildRedBusSearchUrl(
  fromCity: string,
  toCity: string,
  travelDate: string,
): string | null {
  const fromId = resolveRedBusCityId(fromCity);
  const toId = resolveRedBusCityId(toCity);
  if (fromId === null || toId === null) {
    return null;
  }

  const fromName = resolveCityDisplayName(fromCity);
  const toName = resolveCityDisplayName(toCity);
  const fromSlug = slugifyCityForPath(fromCity);
  const toSlug = slugifyCityForPath(toCity);
  const doj = formatRedBusDate(travelDate);

  const params = new URLSearchParams({
    fromCityId: String(fromId),
    fromCityName: fromName,
    toCityId: String(toId),
    toCityName: toName === 'Bangalore' ? 'Bengaluru' : toName,
    onward: doj,
    doj,
    ref: 'search',
  });

  return `https://www.redbus.in/bus-tickets/${fromSlug}-to-${toSlug}?${params.toString()}`;
}
