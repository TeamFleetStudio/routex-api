import type { BusSearchRequest, NormalizedBusListing } from '../../../types/bus.types.js';
import { emptyNormalizedListing } from '../../../types/bus.types.js';
import type { SourceAdapter } from '../../contracts/source-adapter.interface.js';
import {
  cleanOperatorName,
  extractPriceValue,
  normalizeTimeTo24h,
  parseDurationMinutes,
  parseSeatsAvailable,
  timeToMinutes,
} from '../../../utils/time.js';

type PointInput =
  | string
  | {
      name?: string | null;
      time?: string | null;
      bpName?: string | null;
      bpTm?: string | null;
    };

interface UnifiedRecord {
  source_site?: string;
  source_listing_id?: string | null;
  route_id?: string | null;
  listingId?: string | null;
  listing_url?: string | null;
  product_page_url?: string | null;
  url?: string | null;
  search?: BusSearchRequest & { depart_after?: string | null };
  operator_name?: string | null;
  operator?: string | null;
  travelName?: string | null;
  travelsName?: string | null;
  bus_name?: string | null;
  vehicleName?: string | null;
  bus_type?: string | null;
  vehicleType?: string | null;
  seat_layout?: string | null;
  berthType?: string | null;
  departure_time?: string | null;
  arrival_time?: string | null;
  startTime?: string | null;
  endTime?: string | null;
  duration?: string | null;
  duration_minutes?: number | null;
  travelDurationMinutes?: number | null;
  boarding_points?: PointInput[];
  dropping_points?: PointInput[];
  boarding?: PointInput[];
  dropping?: PointInput[];
  amenities?: string | string[];
  amenityList?: string[];
  pricing?: unknown;
  availability?: {
    seats_available?: unknown;
    availability_text?: string | null;
  };
  price?: unknown;
  original_price?: unknown;
  price_inr?: unknown;
  base_price_inr?: unknown;
  originalFare?: unknown;
  fare?: unknown;
  fareAmount?: unknown;
  fare_amount?: unknown;
  discount_inr?: unknown;
  discountAmount?: unknown;
  offer_text?: string | null;
  offerLabel?: string | null;
  discount_offer?: string | null;
  seats_available?: unknown;
  seats?: unknown;
  seatsLeft?: unknown;
  availability_text?: string | null;
  availabilityLabel?: string | null;
  rating?: number | null;
  rating_count?: number | null;
  reviewCount?: number | null;
  userRating?: number | null;
  cancellation_policy?: string | null;
  refundPolicy?: string | null;
  collected_at?: string;
  listings?: UnifiedRecord[];
}

function asLooseRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

function asUnifiedRecord(value: unknown): UnifiedRecord | null {
  return value && typeof value === 'object' ? (value as UnifiedRecord) : null;
}

function flattenRecords(raw: unknown): UnifiedRecord[] {
  const out: UnifiedRecord[] = [];

  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }

    const record = asUnifiedRecord(value);
    if (!record) return;

    if (Array.isArray(record.listings) && record.listings.length > 0) {
      for (const nested of record.listings) visit(nested);
      return;
    }

    out.push(record);
  };

  if (Array.isArray(raw)) {
    visit(raw);
    return out;
  }

  const obj = asLooseRecord(raw);
  if (!obj) return out;

  if (Array.isArray(obj.records)) visit(obj.records);
  else if (Array.isArray(obj.data)) visit(obj.data);
  else if (Array.isArray(obj.listings)) visit(obj.listings);
  else visit(obj);

  return out;
}

function extractServiceKey(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).searchParams.get('serviceKey');
  } catch {
    return null;
  }
}

function resolveListingUrl(item: UnifiedRecord): string | null {
  return item.listing_url ?? item.product_page_url ?? item.url ?? null;
}

function resolveListingId(item: UnifiedRecord, listingUrl: string | null): string | null {
  return (
    item.source_listing_id ??
    item.route_id ??
    item.listingId ??
    extractServiceKey(listingUrl) ??
    null
  );
}

function resolveOperator(item: UnifiedRecord): string | null {
  return cleanOperatorName(
    item.operator_name ?? item.travelName ?? item.travelsName ?? item.operator ?? null,
  );
}

function resolvePrice(item: UnifiedRecord): number | null {
  const pricing = asLooseRecord(item.pricing);
  const candidates: unknown[] = [
    pricing?.price_inr,
    pricing?.value,
    pricing?.amount,
    item.pricing,
    item.price_inr,
    item.price,
    item.fare,
    item.fareAmount,
    item.fare_amount,
  ];

  for (const candidate of candidates) {
    const value = extractPriceValue(candidate);
    if (value !== null) return value;
  }

  return null;
}

function resolveBasePrice(item: UnifiedRecord, price: number | null): number | null {
  const pricing = asLooseRecord(item.pricing);
  const candidates: unknown[] = [
    item.base_price_inr,
    pricing?.base_price_inr,
    pricing?.original_price,
    item.original_price,
    item.originalFare,
  ];

  for (const candidate of candidates) {
    const value = extractPriceValue(candidate);
    if (value !== null) return value;
  }

  return price;
}

function resolveDiscount(
  item: UnifiedRecord,
  price: number | null,
  basePrice: number | null,
): number | null {
  const pricing = asLooseRecord(item.pricing);
  const explicit = extractPriceValue(
    item.discount_inr ?? item.discountAmount ?? pricing?.discount_inr,
  );
  if (explicit !== null) return explicit;
  if (price !== null && basePrice !== null && basePrice >= price) {
    return basePrice - price;
  }
  return null;
}

function resolveDurationMinutes(
  item: UnifiedRecord,
  departureTime: string | null,
  arrivalTime: string | null,
): number | null {
  if (typeof item.duration_minutes === 'number') return item.duration_minutes;
  if (typeof item.travelDurationMinutes === 'number') return item.travelDurationMinutes;

  const parsed =
    parseDurationMinutes(item.duration) ?? parseDurationMinutes(item.travelDurationMinutes);
  if (parsed !== null) return parsed;

  const dep = timeToMinutes(departureTime);
  const arr = timeToMinutes(arrivalTime);
  if (dep === null || arr === null) return null;

  let diff = arr - dep;
  if (diff <= 0) diff += 24 * 60;
  return diff;
}

function mapPoints(points: PointInput[] | undefined): Array<{ name: string | null; time: string | null }> {
  if (!Array.isArray(points)) return [];

  return points.map((point) => {
    if (typeof point === 'string') {
      return { name: null, time: normalizeTimeTo24h(point) };
    }

    const name = point.name ?? point.bpName ?? null;
    const time = normalizeTimeTo24h(point.time ?? point.bpTm);
    return { name, time };
  });
}

function mapAmenities(item: UnifiedRecord): string[] {
  if (Array.isArray(item.amenityList)) {
    return item.amenityList.filter((a): a is string => typeof a === 'string');
  }
  if (Array.isArray(item.amenities)) {
    return item.amenities.filter((a): a is string => typeof a === 'string');
  }
  if (typeof item.amenities === 'string' && item.amenities.trim()) {
    return [item.amenities.trim()];
  }
  return [];
}

function resolveSeatsAvailable(item: UnifiedRecord): number | null {
  const availability = asLooseRecord(item.availability);
  if (typeof availability?.seats_available === 'number') return availability.seats_available;
  if (typeof item.seatsLeft === 'number') return item.seatsLeft;
  return parseSeatsAvailable(
    availability?.seats_available ?? item.seats_available ?? item.seats,
  );
}

function resolveAvailabilityText(item: UnifiedRecord): string | null {
  const availability = asLooseRecord(item.availability);
  if (typeof availability?.availability_text === 'string') return availability.availability_text;
  if (typeof item.availability_text === 'string') return item.availability_text;
  if (typeof item.availabilityLabel === 'string') return item.availabilityLabel;
  if (typeof item.seats === 'string') return item.seats;
  if (typeof item.seats_available === 'string') return item.seats_available;
  return null;
}

function normalizeSourceSite(site: string): string {
  const lower = site.toLowerCase();
  if (lower.includes('redbus')) return 'redbus';
  if (lower.includes('abhibus')) return 'abhibus';
  return site;
}

export class UnifiedScraperAdapter implements SourceAdapter<unknown> {
  constructor(readonly sourceName: string) {}

  static forSite(site: string): UnifiedScraperAdapter {
    return new UnifiedScraperAdapter(site);
  }

  adapt(raw: unknown, search: BusSearchRequest): NormalizedBusListing[] {
    return flattenRecords(raw).map((item) => this.mapRecord(item, search));
  }

  private mapRecord(item: UnifiedRecord, search: BusSearchRequest): NormalizedBusListing {
    const base = emptyNormalizedListing(this.sourceName, search);
    const listingUrl = resolveListingUrl(item);
    const departureTime = normalizeTimeTo24h(
      item.departure_time ?? item.startTime,
    );
    const arrivalTime = normalizeTimeTo24h(item.arrival_time ?? item.endTime);
    const priceInr = resolvePrice(item);
    const basePriceInr = resolveBasePrice(item, priceInr);
    const discountInr = resolveDiscount(item, priceInr, basePriceInr);

    const pricingOffer = asLooseRecord(item.pricing)?.offer_text;
    return {
      ...base,
      source_site: normalizeSourceSite(item.source_site ?? this.sourceName),
      source_listing_id: resolveListingId(item, listingUrl),
      listing_url: listingUrl,
      operator_name: resolveOperator(item),
      bus_name: item.bus_name ?? item.vehicleName ?? null,
      bus_type: item.bus_type ?? item.vehicleType ?? null,
      seat_layout: item.seat_layout ?? item.berthType ?? null,
      departure_time: departureTime,
      arrival_time: arrivalTime,
      duration_minutes: resolveDurationMinutes(item, departureTime, arrivalTime),
      boarding_points: mapPoints(item.boarding_points ?? item.boarding),
      dropping_points: mapPoints(item.dropping_points ?? item.dropping),
      amenities: mapAmenities(item),
      price_inr: priceInr,
      base_price_inr: basePriceInr,
      discount_inr: discountInr,
      offer_text:
        item.offer_text ??
        item.offerLabel ??
        item.discount_offer ??
        (typeof pricingOffer === 'string' ? pricingOffer : null),
      seats_available: resolveSeatsAvailable(item),
      availability_text: resolveAvailabilityText(item),
      rating:
        typeof item.rating === 'number'
          ? item.rating
          : typeof item.userRating === 'number'
            ? item.userRating
            : null,
      rating_count:
        typeof item.rating_count === 'number'
          ? item.rating_count
          : typeof item.reviewCount === 'number'
            ? item.reviewCount
            : null,
      cancellation_policy: item.cancellation_policy ?? item.refundPolicy ?? null,
      collected_at: item.collected_at ?? base.collected_at,
    };
  }
}
