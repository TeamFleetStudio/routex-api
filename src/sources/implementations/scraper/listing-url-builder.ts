import type { BusSearchRequest } from '../../../types/bus.types.js';
import {
  buildClearTripListingUrl,
  buildMakeMyTripSearchUrl,
  buildRedBusSearchUrl,
} from '../brightdata/url-builders.js';

function appendServiceKey(baseUrl: string, serviceKey: string): string {
  try {
    const url = new URL(baseUrl);
    url.searchParams.set('serviceKey', serviceKey);
    return url.toString();
  } catch {
    return baseUrl;
  }
}

export function buildFallbackListingUrl(
  sourceSite: string,
  search: BusSearchRequest,
  listingId: string | null,
  scrapedParentUrl?: string | null,
): string | null {
  const site = sourceSite.toLowerCase();

  switch (site) {
    case 'makemytrip': {
      const base =
        scrapedParentUrl ??
        buildMakeMyTripSearchUrl(search.from_city, search.to_city);
      if (listingId && /^\d{4,}$/.test(listingId)) {
        return appendServiceKey(base, listingId);
      }
      return base;
    }
    case 'cleartrip':
      return (
        scrapedParentUrl ??
        buildClearTripListingUrl(search.from_city, search.to_city, search.travel_date)
      );
    case 'redbus':
      return (
        scrapedParentUrl ??
        buildRedBusSearchUrl(search.from_city, search.to_city, search.travel_date)
      );
    default:
      return scrapedParentUrl ?? null;
  }
}
