import type { BusSearchRequest, NormalizedBusListing } from '../../../types/bus.types.js';
import { emptyNormalizedListing } from '../../../types/bus.types.js';
import type { SourceAdapter } from '../../contracts/source-adapter.interface.js';
import { normalizeTimeTo24h, parsePriceInr } from '../../../utils/time.js';
import { buildRedBusSearchUrl, resolveRedBusListingUrl } from './redbus.url.js';

/** Bright Data scraper row (and legacy placeholder fields). */
interface RedBusRawListing {
  id?: string;
  source_listing_id?: string;
  url?: string;
  listing_url?: string;
  product_page_url?: string;
  travels?: string;
  operator_name?: string;
  busName?: string;
  bus_name?: string;
  busType?: string;
  bus_type?: string;
  seatLayout?: string;
  seat_layout?: string;
  deptTime?: string;
  departure_time?: string;
  arrTime?: string;
  arrival_time?: string;
  durationMins?: number;
  duration_minutes?: number;
  duration?: string | number;
  fare?: string | number;
  price_inr?: string | number | { value?: number };
  baseFare?: string | number;
  base_price_inr?: string | number;
  discount?: string | number;
  discount_inr?: string | number;
  offerText?: string;
  offer_text?: string;
  seats?: number;
  seats_available?: number;
  availability?: string;
  availability_text?: string;
  rating?: number;
  ratingCount?: number;
  rating_count?: number;
  cancellationPolicy?: string;
  cancellation_policy?: string;
  boardingPoints?: Array<{ name?: string; time?: string }>;
  boarding_points?: Array<{ name?: string; time?: string }>;
  droppingPoints?: Array<{ name?: string; time?: string }>;
  dropping_points?: Array<{ name?: string; time?: string }>;
  amenities?: string[];
}

interface RedBusPayload {
  listings?: RedBusRawListing[];
  mode?: string;
  collector_id?: string;
  collection_id?: string;
  search_url?: string;
}

function parseDurationMinutes(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return null;
  const s = value.trim().toLowerCase();
  const hm = s.match(/(?:(\d+)\s*h)?\s*(?:(\d+)\s*m)?/);
  if (hm && (hm[1] || hm[2])) {
    return (Number(hm[1] || 0) * 60) + Number(hm[2] || 0);
  }
  const asNum = Number(s);
  return Number.isFinite(asNum) ? asNum : null;
}

function parseSeats(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const m = value.match(/(\d+)/);
    return m ? Number(m[1]) : null;
  }
  return null;
}

function pickPrice(item: RedBusRawListing): number | null {
  if (item.price_inr && typeof item.price_inr === 'object' && 'value' in item.price_inr) {
    return parsePriceInr((item.price_inr as { value?: number }).value);
  }
  return parsePriceInr(item.price_inr ?? item.fare);
}

export class RedBusAdapter implements SourceAdapter<RedBusPayload> {
  readonly sourceName = 'redbus';

  adapt(raw: RedBusPayload, search: BusSearchRequest): NormalizedBusListing[] {
    const listings = Array.isArray(raw?.listings) ? raw.listings : [];
    const searchUrl = raw?.search_url || buildRedBusSearchUrl(search);
    return listings.map((item) => {
      const base = emptyNormalizedListing(this.sourceName, search);
      const boarding = item.boarding_points ?? item.boardingPoints ?? [];
      const dropping = item.dropping_points ?? item.droppingPoints ?? [];
      const resolved = resolveRedBusListingUrl({
        searchUrl,
        productPageUrl: item.product_page_url,
        listingUrl: item.listing_url,
        url: item.url,
      });
      return {
        ...base,
        source_listing_id:
          resolved.source_listing_id ?? item.source_listing_id ?? item.id ?? null,
        listing_url: resolved.listing_url,
        operator_name: item.operator_name ?? item.travels ?? null,
        bus_name: item.bus_name ?? item.busName ?? null,
        bus_type: item.bus_type ?? item.busType ?? null,
        seat_layout: item.seat_layout ?? item.seatLayout ?? null,
        departure_time: normalizeTimeTo24h(item.departure_time ?? item.deptTime),
        arrival_time: normalizeTimeTo24h(item.arrival_time ?? item.arrTime),
        duration_minutes:
          typeof item.duration_minutes === 'number'
            ? item.duration_minutes
            : typeof item.durationMins === 'number'
              ? item.durationMins
              : parseDurationMinutes(item.duration),
        boarding_points: boarding.map((p) => ({
          name: p.name ?? null,
          time: normalizeTimeTo24h(p.time),
        })),
        dropping_points: dropping.map((p) => ({
          name: p.name ?? null,
          time: normalizeTimeTo24h(p.time),
        })),
        amenities: Array.isArray(item.amenities) ? item.amenities : [],
        pricing: {
          price_inr: pickPrice(item),
          base_price_inr: parsePriceInr(item.base_price_inr ?? item.baseFare),
          discount_inr: parsePriceInr(item.discount_inr ?? item.discount),
          offer_text: item.offer_text ?? item.offerText ?? null,
        },
        availability: {
          seats_available: parseSeats(item.seats_available ?? item.seats),
          availability_text: item.availability_text ?? item.availability ?? null,
        },
        rating: typeof item.rating === 'number' ? item.rating : null,
        rating_count:
          typeof item.rating_count === 'number'
            ? item.rating_count
            : typeof item.ratingCount === 'number'
              ? item.ratingCount
              : null,
        cancellation_policy: item.cancellation_policy ?? item.cancellationPolicy ?? null,
      };
    });
  }
}
