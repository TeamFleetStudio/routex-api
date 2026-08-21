export function normalizeCity(city: string): string {
  return city
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .replace(/\s/g, '-');
}

export function buildSearchCacheKey(fromCity: string, toCity: string, travelDate: string): string {
  return `routex:search:${normalizeCity(fromCity)}:${normalizeCity(toCity)}:${travelDate}`;
}

export function buildSearchLockKey(fromCity: string, toCity: string, travelDate: string): string {
  return `routex:lock:search:${normalizeCity(fromCity)}:${normalizeCity(toCity)}:${travelDate}`;
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
