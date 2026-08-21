export interface BusSearchRequest {
  from_city: string;
  to_city: string;
  travel_date: string;
}

export interface BoardingPoint {
  name: string | null;
  time: string | null;
}

export interface DroppingPoint {
  name: string | null;
  time: string | null;
}

export interface NormalizedBusListing {
  source_site: string;
  source_listing_id: string | null;
  listing_url: string | null;
  search: BusSearchRequest;
  operator_name: string | null;
  bus_name: string | null;
  bus_type: string | null;
  seat_layout: string | null;
  departure_time: string | null;
  arrival_time: string | null;
  duration_minutes: number | null;
  boarding_points: BoardingPoint[];
  dropping_points: DroppingPoint[];
  amenities: string[];
  price_inr: number | null;
  base_price_inr: number | null;
  discount_inr: number | null;
  offer_text: string | null;
  seats_available: number | null;
  availability_text: string | null;
  rating: number | null;
  rating_count: number | null;
  cancellation_policy: string | null;
  collected_at: string;
}

export interface CanonicalOffer {
  source: string;
  price_inr: number | null;
  source_listing_id?: string | null;
  listing_url?: string | null;
}

export interface CanonicalBus {
  canonical_bus_id: string;
  operator_name: string | null;
  departure_time: string | null;
  arrival_time: string | null;
  bus_type: string | null;
  match_confidence: number;
  offers: CanonicalOffer[];
  listings: NormalizedBusListing[];
}

export function emptyNormalizedListing(
  sourceSite: string,
  search: BusSearchRequest,
): NormalizedBusListing {
  return {
    source_site: sourceSite,
    source_listing_id: null,
    listing_url: null,
    search,
    operator_name: null,
    bus_name: null,
    bus_type: null,
    seat_layout: null,
    departure_time: null,
    arrival_time: null,
    duration_minutes: null,
    boarding_points: [],
    dropping_points: [],
    amenities: [],
    price_inr: null,
    base_price_inr: null,
    discount_inr: null,
    offer_text: null,
    seats_available: null,
    availability_text: null,
    rating: null,
    rating_count: null,
    cancellation_policy: null,
    collected_at: new Date().toISOString(),
  };
}
