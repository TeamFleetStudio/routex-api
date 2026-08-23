import type { BusSearchRequest } from '../../../types/bus.types.js';
import {
  findCity,
  normalizeCityKey,
  resolveCityDisplayName,
  resolveRedBusCityId,
  resolveAbhiBusCityId,
  slugifyCity,
  type BusSite,
} from './city-registry.js';

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

/** Format YYYY-MM-DD → 25-Aug-2026 */
export function formatRedBusDate(travelDate: string): string {
  const [y, m, d] = travelDate.split('-').map(Number);
  const day = String(d).padStart(2, '0');
  const month = MONTHS[m - 1];
  return `${day}-${month}-${y}`;
}

/** Format YYYY-MM-DD → 25-08-2026 for AbhiBus bus_search URLs */
export function formatAbhiBusDate(travelDate: string): string {
  const [y, m, d] = travelDate.split('-');
  return `${d}-${m}-${y}`;
}

export function slugifyCityForPath(city: string): string {
  return slugifyCity(city);
}

export { resolveCityDisplayName, resolveRedBusCityId, resolveAbhiBusCityId, findCity, normalizeCityKey };

export function buildAbhiBusSearchUrl(
  fromCity: string,
  toCity: string,
  travelDate?: string,
): string {
  const fromDef = findCity(fromCity);
  const toDef = findCity(toCity);
  const fromName = resolveCityDisplayName(fromCity);
  const toName = resolveCityDisplayName(toCity);

  if (
    travelDate &&
    fromDef?.abhibusId != null &&
    toDef?.abhibusId != null
  ) {
    return `https://www.abhibus.com/bus_search/${encodeURIComponent(fromName)}/${fromDef.abhibusId}/${encodeURIComponent(toName)}/${toDef.abhibusId}/${formatAbhiBusDate(travelDate)}/O`;
  }

  return `https://www.abhibus.com/buses/2/${encodeURIComponent(fromName)}-${encodeURIComponent(toName)}`;
}

export function buildRedBusSearchUrl(
  fromCity: string,
  toCity: string,
  travelDate: string,
): string {
  const fromName = resolveCityDisplayName(fromCity);
  const toName = resolveCityDisplayName(toCity);
  const fromSlug = slugifyCityForPath(fromCity);
  const toSlug = slugifyCityForPath(toCity);
  const doj = formatRedBusDate(travelDate);

  const fromId = resolveRedBusCityId(fromCity);
  const toId = resolveRedBusCityId(toCity);

  if (fromId === null || toId === null) {
    const params = new URLSearchParams({
      onward: doj,
      doj,
      ref: 'search',
    });
    return `https://www.redbus.in/bus-tickets/${fromSlug}-to-${toSlug}?${params.toString()}`;
  }

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

export function buildMakeMyTripSearchUrl(fromCity: string, toCity: string): string {
  const fromSlug = slugifyCityForPath(fromCity);
  const toSlug = slugifyCityForPath(toCity);
  return `https://www.makemytrip.com/bus-tickets/${fromSlug}-${toSlug}-bus-ticket-booking.html`;
}

export function buildClearTripSearchUrl(fromCity: string, toCity: string): string {
  const fromSlug = slugifyCityForPath(fromCity);
  const toSlug = slugifyCityForPath(toCity);
  return `https://www.cleartrip.com/bus-tickets/${fromSlug}-to-${toSlug}/`;
}

export function buildSourceSearchUrl(
  site: BusSite | 'makemytrip' | 'cleartrip',
  search: BusSearchRequest,
): string {
  const date = search.travel_date;

  switch (site) {
    case 'redbus':
      return buildRedBusSearchUrl(search.from_city, search.to_city, date);
    case 'abhibus':
      return buildAbhiBusSearchUrl(search.from_city, search.to_city, date);
    case 'makemytrip':
      return buildMakeMyTripSearchUrl(search.from_city, search.to_city);
    case 'cleartrip':
      return buildClearTripSearchUrl(search.from_city, search.to_city);
  }
}
