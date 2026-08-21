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

export type BusTypeTag =
  | 'AC'
  | 'NON_AC'
  | 'SLEEPER'
  | 'SEMI_SLEEPER'
  | 'SEATER'
  | 'VOLVO'
  | 'MULTI_AXLE'
  | 'ELECTRIC';

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
  /** Filled during matching enrichment */
  operator_name_normalized?: string | null;
  bus_type_raw?: string | null;
  bus_type_normalized?: BusTypeTag[];
  departure_minutes?: number | null;
  arrival_minutes?: number | null;
  normalized_price?: number | null;
}

export interface CanonicalOffer {
  source: string;
  price_inr: number | null;
  difference_from_cheapest: number | null;
  difference_percentage: number | null;
  source_listing_id?: string | null;
  listing_url?: string | null;
}

export interface SimilarAlternative {
  canonical_bus_id: string;
  similarity_score: number;
  operator_name: string | null;
  departure_time: string | null;
  cheapest_price_inr: number | null;
}

export interface CanonicalBus {
  canonical_bus_id: string;
  match_tier: 'same' | 'unique';
  match_confidence: number;
  operator_name: string | null;
  operator_name_normalized: string | null;
  bus_type_raw: string | null;
  bus_type_normalized: BusTypeTag[];
  departure_time: string | null;
  arrival_time: string | null;
  duration_minutes: number | null;
  cheapest_price_inr: number | null;
  cheapest_provider: string | null;
  deal_score: number;
  offers: CanonicalOffer[];
  similar_alternatives: SimilarAlternative[];
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
