import type { BusTypeTag, CanonicalBus } from '../../types/bus.types.js';
import { timeToMinutes } from '../../utils/time.js';

export type SortOption = 'best_value' | 'cheapest' | 'fastest' | 'earliest' | 'latest';

export interface SearchFilterOptions {
  sort?: SortOption;
  min_price?: number;
  max_price?: number;
  depart_after?: string;
  depart_before?: string;
  bus_type?: BusTypeTag[];
  min_platforms?: number;
  operator?: string;
}

export class SearchFilterService {
  apply(results: CanonicalBus[], options: SearchFilterOptions = {}): CanonicalBus[] {
    let filtered = results;

    if (options.min_price != null) {
      filtered = filtered.filter(
        (b) => b.cheapest_price_inr != null && b.cheapest_price_inr >= options.min_price!,
      );
    }
    if (options.max_price != null) {
      filtered = filtered.filter(
        (b) => b.cheapest_price_inr != null && b.cheapest_price_inr <= options.max_price!,
      );
    }
    if (options.depart_after) {
      const min = timeToMinutes(options.depart_after);
      if (min != null) {
        filtered = filtered.filter((b) => {
          if (!b.departure_time) return false;
          const dep = timeToMinutes(b.departure_time);
          return dep != null && dep >= min;
        });
      }
    }
    if (options.depart_before) {
      const max = timeToMinutes(options.depart_before);
      if (max != null) {
        filtered = filtered.filter((b) => {
          if (!b.departure_time) return false;
          const dep = timeToMinutes(b.departure_time);
          return dep != null && dep <= max;
        });
      }
    }
    if (options.bus_type && options.bus_type.length > 0) {
      const required = new Set(options.bus_type);
      filtered = filtered.filter((b) =>
        (b.bus_type_normalized ?? []).some((tag) => required.has(tag)),
      );
    }
    if (options.min_platforms != null && options.min_platforms > 1) {
      filtered = filtered.filter((b) => (b.platform_count ?? b.offers.length) >= options.min_platforms!);
    }
    if (options.operator) {
      const needle = options.operator.trim().toLowerCase();
      filtered = filtered.filter((b) =>
        (b.operator_name ?? '').toLowerCase().includes(needle) ||
        (b.operator_name_normalized ?? '').toLowerCase().includes(needle),
      );
    }

    return this.sort(filtered, options.sort ?? 'best_value');
  }

  sort(results: CanonicalBus[], sort: SortOption): CanonicalBus[] {
    const copy = [...results];
    switch (sort) {
      case 'cheapest':
        copy.sort((a, b) => {
          const pa = a.cheapest_price_inr ?? Number.POSITIVE_INFINITY;
          const pb = b.cheapest_price_inr ?? Number.POSITIVE_INFINITY;
          return pa - pb;
        });
        break;
      case 'fastest':
        copy.sort((a, b) => {
          const da = a.duration_minutes ?? Number.POSITIVE_INFINITY;
          const db = b.duration_minutes ?? Number.POSITIVE_INFINITY;
          return da - db;
        });
        break;
      case 'earliest':
        copy.sort((a, b) => (a.departure_time ?? '').localeCompare(b.departure_time ?? ''));
        break;
      case 'latest':
        copy.sort((a, b) => (b.departure_time ?? '').localeCompare(a.departure_time ?? ''));
        break;
      case 'best_value':
      default:
        copy.sort((a, b) => {
          if (b.deal_score !== a.deal_score) return b.deal_score - a.deal_score;
          const pa = a.cheapest_price_inr ?? Number.POSITIVE_INFINITY;
          const pb = b.cheapest_price_inr ?? Number.POSITIVE_INFINITY;
          return pa - pb;
        });
        break;
    }
    return copy;
  }
}
