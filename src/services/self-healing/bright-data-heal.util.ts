import type { BusSearchRequest } from '../../types/bus.types.js';
import type { FailureKind } from '../../types/source.types.js';
import type { BrightDataSite } from '../../sources/implementations/brightdata/bright-data-input.builder.js';

export interface BrightDataHealContext {
  source: string;
  collectorId: string;
  search: BusSearchRequest;
  failure_kind: FailureKind;
  message?: string;
}

export interface BrightDataHealResult {
  success: boolean;
  mode: 'api' | 'cli';
  message?: string;
  outputPath?: string;
}

const BRIGHT_DATA_SOURCES = new Set<string>(['redbus', 'makemytrip', 'cleartrip']);

export function isBrightDataSource(source: string): source is BrightDataSite {
  return BRIGHT_DATA_SOURCES.has(source);
}

export function buildHealPrompt(context: BrightDataHealContext): string {
  const route = `${context.search.from_city} → ${context.search.to_city} on ${context.search.travel_date}`;
  const issue =
    context.message?.trim() ||
    `${context.source} failed with ${context.failure_kind} for route ${route}.`;
  const fixHint =
    ' Fix the bus scraper to extract operator_name, price_inr, listing_url, duration_minutes, boarding_points, and dropping_points from the search results page.';
  return `${issue}${fixHint}`.slice(0, 1000);
}
