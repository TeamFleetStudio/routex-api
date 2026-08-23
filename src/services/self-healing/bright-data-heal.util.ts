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

  // Explicitly allow schema changes — telling Bright Data to "preserve output
  // structure" causes output_schema_incompatible (422) on the next trigger.
  const fixHint = [
    ' You MAY change the collector fields and output schema as needed.',
    ' Do NOT try to preserve an old incompatible output schema.',
    ' Update the linked output schema to match the new extraction.',
    ' Extract bus listings with: operator_name, bus_type, departure_time, arrival_time,',
    ' duration_minutes, price_inr, seats_available, listing_url (or serviceKey),',
    ' boarding_points, dropping_points, rating.',
    ' Prefer a top-level buses[] array of listing objects.',
  ].join('');

  return `${issue}${fixHint}`.slice(0, 1000);
}
