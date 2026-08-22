import type { BusSearchRequest } from '../../../types/bus.types.js';
import type { Env } from '../../../config/env.js';
import {
  buildAbhiBusSearchUrl,
  buildRedBusSearchUrl,
  buildSourceSearchUrl,
  resolveCityDisplayName,
} from './url-builders.js';
import type { BusSite } from './city-registry.js';

export type BrightDataSite = BusSite;

export function resolveCollectorId(site: BrightDataSite, env: Env): string {
  switch (site) {
    case 'redbus':
      return env.REDBUS_COLLECTOR_ID;
    case 'abhibus':
      return env.ABHIBUS_COLLECTOR_ID;
  }
}

export { buildSourceSearchUrl };

export interface BrightDataCollectorInput {
  site: BrightDataSite;
  url: string;
  from: string;
  from_city: string;
  to: string;
  to_city: string;
  date: string;
  time: string;
  limit: number;
  enrich?: string;
}

export function buildBrightDataInputs(
  site: BrightDataSite,
  search: BusSearchRequest,
  defaultLimit: number,
): BrightDataCollectorInput[] {
  const from = resolveCityDisplayName(search.from_city);
  const to = resolveCityDisplayName(search.to_city);
  const date = search.travel_date;
  const time = search.depart_after?.trim() ?? '';
  const limit = search.limit ?? defaultLimit;

  const url =
    site === 'redbus'
      ? buildRedBusSearchUrl(search.from_city, search.to_city, date)
      : buildAbhiBusSearchUrl(search.from_city, search.to_city, date);

  const base: BrightDataCollectorInput = {
    site,
    url,
    from,
    from_city: from,
    to,
    to_city: to,
    date,
    time,
    limit,
  };

  if (site === 'redbus') {
    return [{ ...base, enrich: 'true' }];
  }

  return [base];
}
