import type { BusSearchRequest, NormalizedBusListing } from '../../../types/bus.types.js';
import { emptyNormalizedListing } from '../../../types/bus.types.js';
import type { SourceAdapter } from '../../contracts/source-adapter.interface.js';
import {
  cleanOperatorName,
  extractPriceValue,
  normalizeTimeTo24h,
  parseDurationMinutes,
} from '../../../utils/time.js';

interface AbhiBusPrice {
  value?: number;
  currency?: string;
  symbol?: string;
}

interface AbhiBusRecord {
  source_site?: string;
  operator_name?: string;
  bus_type?: string;
  departure_time?: string;
  arrival_time?: string;
  duration?: string;
  amenities?: string | string[];
  pricing?: AbhiBusPrice | number | string;
  seats?: string;
  rating?: number;
  listing_url?: string;
  product_page_url?: string;
}

interface AbhiBusPayload {
  records?: AbhiBusRecord[];
  listings?: AbhiBusRecord[];
  mode?: string;
}

function extractRecords(raw: unknown): AbhiBusRecord[] {
  if (Array.isArray(raw)) return raw as AbhiBusRecord[];
  if (raw && typeof raw === 'object') {
    const obj = raw as AbhiBusPayload;
    if (Array.isArray(obj.records)) return obj.records;
    if (Array.isArray(obj.listings)) return obj.listings;
  }
  return [];
}

function extractServiceKey(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.searchParams.get('serviceKey');
  } catch {
    return null;
  }
}

function mapAmenities(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((a): a is string => typeof a === 'string');
  }
  if (typeof value === 'string' && value.trim()) {
    return [value.trim()];
  }
  return [];
}

export class AbhiBusAdapter implements SourceAdapter<unknown> {
  readonly sourceName = 'abhibus';

  adapt(raw: unknown, search: BusSearchRequest): NormalizedBusListing[] {
    return extractRecords(raw).map((item) => {
      const base = emptyNormalizedListing(this.sourceName, search);
      const listingUrl = item.listing_url ?? item.product_page_url ?? null;

      return {
        ...base,
        source_listing_id: extractServiceKey(listingUrl ?? undefined),
        listing_url: listingUrl,
        operator_name: cleanOperatorName(item.operator_name),
        bus_type: typeof item.bus_type === 'string' ? item.bus_type : null,
        departure_time: normalizeTimeTo24h(item.departure_time),
        arrival_time: normalizeTimeTo24h(item.arrival_time),
        duration_minutes: parseDurationMinutes(item.duration),
        amenities: mapAmenities(item.amenities),
        price_inr: extractPriceValue(item.pricing),
        base_price_inr: null,
        discount_inr: null,
        seats_available: null,
        availability_text: typeof item.seats === 'string' ? item.seats : null,
        rating: typeof item.rating === 'number' ? item.rating : null,
        rating_count: null,
      };
    });
  }
}
