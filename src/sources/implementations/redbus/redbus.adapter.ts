import type { BusSearchRequest, NormalizedBusListing } from '../../../types/bus.types.js';
import { emptyNormalizedListing } from '../../../types/bus.types.js';
import type { SourceAdapter } from '../../contracts/source-adapter.interface.js';
import {
  cleanOperatorName,
  extractPriceValue,
  normalizeTimeTo24h,
  parseDurationMinutes,
  parseSeatsAvailable,
} from '../../../utils/time.js';

interface RedBusPrice {
  value?: number;
  currency?: string;
  symbol?: string;
}

interface RedBusRecord {
  route_id?: string;
  operator_name?: string;
  bus_type?: string;
  departure_time?: string;
  arrival_time?: string;
  duration?: string;
  seats_available?: string;
  price?: RedBusPrice | number | string;
  original_price?: RedBusPrice | number | string;
  rating?: number;
  rating_count?: number;
  amenities?: string[];
  discount_offer?: string;
  listing_url?: string;
  product_page_url?: string;
}

interface RedBusPayload {
  records?: RedBusRecord[];
  listings?: RedBusRecord[];
  mode?: string;
}

function extractRecords(raw: unknown): RedBusRecord[] {
  if (Array.isArray(raw)) return raw as RedBusRecord[];
  if (raw && typeof raw === 'object') {
    const obj = raw as RedBusPayload;
    if (Array.isArray(obj.records)) return obj.records;
    if (Array.isArray(obj.listings)) return obj.listings;
  }
  return [];
}

export class RedBusAdapter implements SourceAdapter<unknown> {
  readonly sourceName = 'redbus';

  adapt(raw: unknown, search: BusSearchRequest): NormalizedBusListing[] {
    return extractRecords(raw).map((item) => {
      const base = emptyNormalizedListing(this.sourceName, search);
      const price = extractPriceValue(item.price);
      const basePrice = extractPriceValue(item.original_price);
      const discount =
        price !== null && basePrice !== null && basePrice >= price ? basePrice - price : null;

      return {
        ...base,
        source_listing_id: item.route_id ?? null,
        listing_url: item.listing_url ?? item.product_page_url ?? null,
        operator_name: cleanOperatorName(item.operator_name),
        bus_type: typeof item.bus_type === 'string' ? item.bus_type : null,
        departure_time: normalizeTimeTo24h(item.departure_time),
        arrival_time: normalizeTimeTo24h(item.arrival_time),
        duration_minutes: parseDurationMinutes(item.duration),
        amenities: Array.isArray(item.amenities) ? item.amenities.filter((a) => typeof a === 'string') : [],
        price_inr: price,
        base_price_inr: basePrice,
        discount_inr: discount,
        offer_text: typeof item.discount_offer === 'string' ? item.discount_offer : null,
        seats_available: parseSeatsAvailable(item.seats_available),
        availability_text:
          typeof item.seats_available === 'string' ? item.seats_available : null,
        rating: typeof item.rating === 'number' ? item.rating : null,
        rating_count: typeof item.rating_count === 'number' ? item.rating_count : null,
      };
    });
  }
}
