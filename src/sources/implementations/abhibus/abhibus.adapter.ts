import type { BusSearchRequest, NormalizedBusListing } from '../../../types/bus.types.js';
import { emptyNormalizedListing } from '../../../types/bus.types.js';
import type { SourceAdapter } from '../../contracts/source-adapter.interface.js';
import { normalizeTimeTo24h, parsePriceInr } from '../../../utils/time.js';

interface AbhiBusRawListing {
  serviceId?: string;
  deepLink?: string;
  operator?: string;
  serviceName?: string;
  coachType?: string;
  layout?: string;
  departure?: string;
  arrival?: string;
  duration?: number;
  price?: string | number;
  mrp?: string | number;
  savings?: string | number;
  promo?: string;
  availableSeats?: number;
  seatStatus?: string;
  avgRating?: number;
  totalRatings?: number;
  cancelPolicy?: string;
  pickups?: Array<{ name?: string; time?: string }>;
  dropoffs?: Array<{ name?: string; time?: string }>;
  facilities?: string[];
}

interface AbhiBusPayload {
  listings?: AbhiBusRawListing[];
  mode?: string;
}

export class AbhiBusAdapter implements SourceAdapter<AbhiBusPayload> {
  readonly sourceName = 'abhibus';

  adapt(raw: AbhiBusPayload, search: BusSearchRequest): NormalizedBusListing[] {
    const listings = Array.isArray(raw?.listings) ? raw.listings : [];
    return listings.map((item) => {
      const base = emptyNormalizedListing(this.sourceName, search);
      return {
        ...base,
        source_listing_id: item.serviceId ?? null,
        listing_url: item.deepLink ?? null,
        operator_name: item.operator ?? null,
        bus_name: item.serviceName ?? null,
        bus_type: item.coachType ?? null,
        seat_layout: item.layout ?? null,
        departure_time: normalizeTimeTo24h(item.departure),
        arrival_time: normalizeTimeTo24h(item.arrival),
        duration_minutes: typeof item.duration === 'number' ? item.duration : null,
        boarding_points: (item.pickups ?? []).map((p) => ({
          name: p.name ?? null,
          time: normalizeTimeTo24h(p.time),
        })),
        dropping_points: (item.dropoffs ?? []).map((p) => ({
          name: p.name ?? null,
          time: normalizeTimeTo24h(p.time),
        })),
        amenities: Array.isArray(item.facilities) ? item.facilities : [],
        pricing: {
          price_inr: parsePriceInr(item.price),
          base_price_inr: parsePriceInr(item.mrp),
          discount_inr: parsePriceInr(item.savings),
          offer_text: item.promo ?? null,
        },
        availability: {
          seats_available: typeof item.availableSeats === 'number' ? item.availableSeats : null,
          availability_text: item.seatStatus ?? null,
        },
        rating: typeof item.avgRating === 'number' ? item.avgRating : null,
        rating_count: typeof item.totalRatings === 'number' ? item.totalRatings : null,
        cancellation_policy: item.cancelPolicy ?? null,
      };
    });
  }
}
