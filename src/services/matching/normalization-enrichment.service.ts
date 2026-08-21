import type { BusTypeTag, NormalizedBusListing } from '../../types/bus.types.js';
import { normalizeTimeTo24h, timeToMinutes } from '../../utils/time.js';

export class NormalizationEnrichmentService {
  enrich(listing: NormalizedBusListing): NormalizedBusListing {
    const busTypeRaw = listing.bus_type;
    const departureTime =
      normalizeTimeTo24h(listing.departure_time) ?? listing.departure_time;
    const arrivalTime = normalizeTimeTo24h(listing.arrival_time) ?? listing.arrival_time;
    const tags = this.normalizeBusTypeTags(busTypeRaw);
    const operatorNormalized = this.normalizeOperatorName(listing.operator_name);
    const normalizedPrice = listing.price_inr ?? listing.base_price_inr ?? null;

    return {
      ...listing,
      departure_time: departureTime,
      arrival_time: arrivalTime,
      operator_name_normalized: operatorNormalized,
      bus_type_raw: busTypeRaw,
      bus_type_normalized: tags,
      departure_minutes: timeToMinutes(departureTime),
      arrival_minutes: timeToMinutes(arrivalTime),
      normalized_price: normalizedPrice,
      price_inr: normalizedPrice,
    };
  }

  enrichAll(listings: NormalizedBusListing[]): NormalizedBusListing[] {
    return listings.map((l) => this.enrich(l));
  }

  normalizeOperatorName(value: string | null | undefined): string | null {
    if (!value || !value.trim()) return null;
    let s = value
      .replace(/\nAD\s*$/i, '')
      .toUpperCase()
      .replace(/&/g, ' ')
      .replace(/[^A-Z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    s = s
      .replace(/\bAND\b/g, ' ')
      .replace(/\bTRAVELS?\b/g, ' ')
      .replace(/\bPVT\b/g, ' ')
      .replace(/\bLTD\b/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    return s || null;
  }

  normalizeBusTypeTags(raw: string | null | undefined): BusTypeTag[] {
    if (!raw || !raw.trim()) return [];
    const text = raw.toLowerCase();
    const tags = new Set<BusTypeTag>();

    if (/\bnon[\s-]?ac\b/.test(text) || /\bnon[\s-]?a\/c\b/.test(text)) {
      tags.add('NON_AC');
    } else if (
      /\ba\/c\b/.test(text) ||
      /\bac\b/.test(text) ||
      text.includes('air conditioned') ||
      text.includes('air-conditioned')
    ) {
      tags.add('AC');
    }

    if (/semi[\s-]?sleeper/.test(text)) {
      tags.add('SEMI_SLEEPER');
    } else if (/\bsleeper\b/.test(text) || /\bberth\b/.test(text)) {
      tags.add('SLEEPER');
    }

    if (/\bseater\b/.test(text)) {
      tags.add('SEATER');
    }

    if (/\bvolvo\b/.test(text)) {
      tags.add('VOLVO');
    }

    if (/multi[\s-]?axle/.test(text) || /\b6x2\b/.test(text)) {
      tags.add('MULTI_AXLE');
    }

    if (/\belectric\b/.test(text) || /\bev\b/.test(text)) {
      tags.add('ELECTRIC');
    }

    return [...tags];
  }
}
