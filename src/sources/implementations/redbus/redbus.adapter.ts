import type { BusSearchRequest, NormalizedBusListing } from '../../../types/bus.types.js';
import { emptyNormalizedListing } from '../../../types/bus.types.js';
import type { SourceAdapter } from '../../contracts/source-adapter.interface.js';
import { normalizeTimeTo24h, parsePriceInr } from '../../../utils/time.js';

interface RedBusRawListing {
  id?: string;
  url?: string;
  travels?: string;
  busName?: string;
  busType?: string;
  seatLayout?: string;
  deptTime?: string;
  arrTime?: string;
  durationMins?: number;
  fare?: string | number;
  baseFare?: string | number;
  discount?: string | number;
  offerText?: string;
  seats?: number;
  availability?: string;
  rating?: number;
  ratingCount?: number;
  cancellationPolicy?: string;
  boardingPoints?: Array<{ name?: string; time?: string }>;
  droppingPoints?: Array<{ name?: string; time?: string }>;
  amenities?: string[];
}

interface RedBusPayload {
  listings?: RedBusRawListing[];
  mode?: string;
}

export class RedBusAdapter implements SourceAdapter<RedBusPayload> {
  readonly sourceName = 'redbus';

  adapt(raw: RedBusPayload, search: BusSearchRequest): NormalizedBusListing[] {
    const listings = Array.isArray(raw?.listings) ? raw.listings : [];
    return listings.map((item) => {
      const base = emptyNormalizedListing(this.sourceName, search);
      return {
        ...base,
        source_listing_id: item.id ?? null,
        listing_url: item.url ?? null,
        operator_name: item.travels ?? null,
        bus_name: item.busName ?? null,
        bus_type: item.busType ?? null,
        seat_layout: item.seatLayout ?? null,
        departure_time: normalizeTimeTo24h(item.deptTime),
        arrival_time: normalizeTimeTo24h(item.arrTime),
        duration_minutes:
          typeof item.durationMins === 'number' ? item.durationMins : null,
        boarding_points: (item.boardingPoints ?? []).map((p) => ({
          name: p.name ?? null,
          time: normalizeTimeTo24h(p.time),
        })),
        dropping_points: (item.droppingPoints ?? []).map((p) => ({
          name: p.name ?? null,
          time: normalizeTimeTo24h(p.time),
        })),
        amenities: Array.isArray(item.amenities) ? item.amenities : [],
        price_inr: parsePriceInr(item.fare),
        base_price_inr: parsePriceInr(item.baseFare),
        discount_inr: parsePriceInr(item.discount),
        offer_text: item.offerText ?? null,
        seats_available: typeof item.seats === 'number' ? item.seats : null,
        availability_text: item.availability ?? null,
        rating: typeof item.rating === 'number' ? item.rating : null,
        rating_count: typeof item.ratingCount === 'number' ? item.ratingCount : null,
        cancellation_policy: item.cancellationPolicy ?? null,
      };
    });
  }
}
