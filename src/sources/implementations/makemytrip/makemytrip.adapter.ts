import type { BusSearchRequest, NormalizedBusListing } from '../../../types/bus.types.js';
import { emptyNormalizedListing } from '../../../types/bus.types.js';
import type { SourceAdapter } from '../../contracts/source-adapter.interface.js';
import { normalizeTimeTo24h, parsePriceInr } from '../../../utils/time.js';

interface MmtRawListing {
  listingId?: string;
  url?: string;
  travelName?: string;
  vehicleName?: string;
  vehicleType?: string;
  berthType?: string;
  startTime?: string;
  endTime?: string;
  travelDurationMinutes?: number;
  fareAmount?: string | number;
  originalFare?: string | number;
  discountAmount?: string | number;
  offerLabel?: string;
  seatsLeft?: number;
  availabilityLabel?: string;
  userRating?: number;
  reviewCount?: number;
  refundPolicy?: string;
  boarding?: Array<{ name?: string; time?: string }>;
  dropping?: Array<{ name?: string; time?: string }>;
  amenityList?: string[];
}

interface MmtPayload {
  listings?: MmtRawListing[];
  mode?: string;
}

export class MakeMyTripAdapter implements SourceAdapter<MmtPayload> {
  readonly sourceName = 'makemytrip';

  adapt(raw: MmtPayload, search: BusSearchRequest): NormalizedBusListing[] {
    const listings = Array.isArray(raw?.listings) ? raw.listings : [];
    return listings.map((item) => {
      const base = emptyNormalizedListing(this.sourceName, search);
      return {
        ...base,
        source_listing_id: item.listingId ?? null,
        listing_url: item.url ?? null,
        operator_name: item.travelName ?? null,
        bus_name: item.vehicleName ?? null,
        bus_type: item.vehicleType ?? null,
        seat_layout: item.berthType ?? null,
        departure_time: normalizeTimeTo24h(item.startTime),
        arrival_time: normalizeTimeTo24h(item.endTime),
        duration_minutes:
          typeof item.travelDurationMinutes === 'number' ? item.travelDurationMinutes : null,
        boarding_points: (item.boarding ?? []).map((p) => ({
          name: p.name ?? null,
          time: normalizeTimeTo24h(p.time),
        })),
        dropping_points: (item.dropping ?? []).map((p) => ({
          name: p.name ?? null,
          time: normalizeTimeTo24h(p.time),
        })),
        amenities: Array.isArray(item.amenityList) ? item.amenityList : [],
        price_inr: parsePriceInr(item.fareAmount),
        base_price_inr: parsePriceInr(item.originalFare),
        discount_inr: parsePriceInr(item.discountAmount),
        offer_text: item.offerLabel ?? null,
        seats_available: typeof item.seatsLeft === 'number' ? item.seatsLeft : null,
        availability_text: item.availabilityLabel ?? null,
        rating: typeof item.userRating === 'number' ? item.userRating : null,
        rating_count: typeof item.reviewCount === 'number' ? item.reviewCount : null,
        cancellation_policy: item.refundPolicy ?? null,
      };
    });
  }
}
