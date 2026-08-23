export function normalizeCity(city: string): string {
  return city
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .replace(/\s/g, '-');
}

/** Normalize depart_after (HH:MM) into a cache key segment. */
export function normalizeTimeSlot(departAfter: string | undefined): string {
  const trimmed = departAfter?.trim() ?? '';
  if (!trimmed) return 'any';
  const compact = trimmed.replace(':', '');
  return `after-${compact}`;
}

export function buildRouteKey(
  fromCity: string,
  toCity: string,
  travelDate: string,
  departAfter?: string,
): string {
  return `${normalizeCity(fromCity)}:${normalizeCity(toCity)}:${travelDate}:${normalizeTimeSlot(departAfter)}`;
}

export function buildSearchCacheKey(
  fromCity: string,
  toCity: string,
  travelDate: string,
  departAfter?: string,
): string {
  return `routex:search:${buildRouteKey(fromCity, toCity, travelDate, departAfter)}`;
}

export function buildSearchLockKey(
  fromCity: string,
  toCity: string,
  travelDate: string,
  departAfter?: string,
): string {
  return `routex:lock:search:${buildRouteKey(fromCity, toCity, travelDate, departAfter)}`;
}

export function buildProviderCacheKey(
  provider: string,
  fromCity: string,
  toCity: string,
  travelDate: string,
  departAfter?: string,
): string {
  return `routex:provider:${provider}:${buildRouteKey(fromCity, toCity, travelDate, departAfter)}`;
}

export function buildProviderLockKey(
  provider: string,
  fromCity: string,
  toCity: string,
  travelDate: string,
  departAfter?: string,
): string {
  return `routex:lock:provider:${provider}:${buildRouteKey(fromCity, toCity, travelDate, departAfter)}`;
}

export function buildSearchSessionKey(searchId: string): string {
  return `routex:search-session:${searchId}`;
}

export function buildRouteSessionIndexKey(
  fromCity: string,
  toCity: string,
  travelDate: string,
  departAfter?: string,
): string {
  return `routex:route-session:${buildRouteKey(fromCity, toCity, travelDate, departAfter)}`;
}

export function buildRateLimitKey(ip: string): string {
  return `routex:ratelimit:ip:${ip}`;
}

export const SOURCES_CONFIG_KEY = 'routex:sources:config';

export function buildSourceHealthKey(source: string): string {
  return `routex:source:health:${source}`;
}

export function buildCircuitKey(source: string): string {
  return `routex:circuit:${source}`;
}

export function buildHealingLockKey(source: string): string {
  return `routex:lock:healing:${source}`;
}
