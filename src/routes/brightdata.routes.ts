import type { FastifyPluginAsync } from 'fastify';
import type { Env } from '../config/env.js';
import { BrightDataRedBusClient } from '../sources/implementations/redbus/brightdata-redbus.client.js';
import { RedBusAdapter } from '../sources/implementations/redbus/redbus.adapter.js';
import { buildRedBusSearchUrl } from '../sources/implementations/redbus/redbus.url.js';
import { ValidationError } from '../errors/index.js';
import { busSearchBodySchema } from '../schemas/search.schema.js';
import {
  DEFAULT_PREFERRED_TIME_WINDOW_MINUTES,
  filterByPreferredTime,
} from '../utils/preferred-time-filter.js';

/**
 * Direct Bright Data redBus endpoint.
 * Scrapes by from/to/date URL, then filters listings by preferred_time (±30 min).
 */
export function createBrightDataRoutes(env: Env): FastifyPluginAsync {
  return async (app) => {
    app.post('/api/v1/brightdata/redbus/search', async (request, reply) => {
      const parsed = busSearchBodySchema.safeParse(request.body);
      if (!parsed.success) {
        throw new ValidationError(parsed.error.issues.map((i) => i.message).join('; '));
      }
      if (!env.BRIGHTDATA_API_KEY || !env.COLLECTOR_REDBUS) {
        return reply.status(500).send({
          success: false,
          error: {
            code: 'MISSING_CONFIG',
            message: 'BRIGHTDATA_API_KEY and COLLECTOR_REDBUS required',
          },
        });
      }

      const search = parsed.data;
      const search_url = buildRedBusSearchUrl(search);
      const client = new BrightDataRedBusClient({
        apiKey: env.BRIGHTDATA_API_KEY,
        collectorId: env.COLLECTOR_REDBUS,
        timeoutMs: env.BRIGHTDATA_TIMEOUT_MS,
        pollIntervalMs: env.BRIGHTDATA_POLL_INTERVAL_MS,
      });
      const adapter = new RedBusAdapter();

      const started = Date.now();
      const raw = await client.search(search);
      const duration_ms = Date.now() - started;
      const payload = raw.payload as {
        mode?: string;
        collector_id?: string;
        collection_id?: string;
        search_url?: string;
        listings?: unknown[];
      };
      const allListings = adapter.adapt(
        payload as Parameters<RedBusAdapter['adapt']>[0],
        search,
      );
      const listings = filterByPreferredTime(
        allListings,
        search.preferred_time,
        DEFAULT_PREFERRED_TIME_WINDOW_MINUTES,
      );

      return reply.send({
        success: true,
        provider: 'brightdata',
        timing: {
          duration_ms,
          duration_human: formatDuration(duration_ms),
          started_at: new Date(started).toISOString(),
          finished_at: new Date().toISOString(),
        },
        brightdata: {
          collector_id: env.COLLECTOR_REDBUS,
          collection_id: payload.collection_id ?? null,
          trigger: {
            method: 'POST',
            url: `https://api.brightdata.com/dca/trigger?collector=${env.COLLECTOR_REDBUS}&queue_next=1`,
            body: [{ url: search_url }],
          },
          dataset: {
            method: 'GET',
            url: payload.collection_id
              ? `https://api.brightdata.com/dca/dataset?id=${payload.collection_id}`
              : null,
          },
          search_url,
        },
        input: search,
        filter: {
          preferred_time: search.preferred_time,
          window_minutes: DEFAULT_PREFERRED_TIME_WINDOW_MINUTES,
          note: 'Only buses with departure within ±window of preferred_time are returned',
        },
        raw_count: Array.isArray(payload.listings) ? payload.listings.length : 0,
        normalized_count_before_time_filter: allListings.length,
        normalized_count: listings.length,
        raw_sample: Array.isArray(payload.listings) ? payload.listings.slice(0, 2) : [],
        normalized: listings,
        output_schema: {
          source_site: 'string',
          source_listing_id: 'string|null',
          listing_url: 'string|null',
          search: {
            from_city: 'string',
            to_city: 'string',
            travel_date: 'YYYY-MM-DD',
            preferred_time: 'HH:MM',
          },
          operator_name: 'string|null',
          bus_name: 'string|null',
          bus_type: 'string|null',
          seat_layout: 'string|null',
          departure_time: 'HH:MM|null',
          arrival_time: 'HH:MM|null',
          duration_minutes: 'number|null',
          boarding_points: [{ name: 'string|null', time: 'HH:MM|null' }],
          dropping_points: [{ name: 'string|null', time: 'HH:MM|null' }],
          amenities: ['string'],
          pricing: {
            price_inr: 'number|null',
            base_price_inr: 'number|null',
            discount_inr: 'number|null',
            offer_text: 'string|null',
          },
          availability: {
            seats_available: 'number|null',
            availability_text: 'string|null',
          },
          rating: 'number|null',
          rating_count: 'number|null',
          cancellation_policy: 'string|null',
          collected_at: 'ISO-8601',
        },
      });
    });
  };
}

function formatDuration(ms: number): string {
  const sec = Math.round(ms / 1000);
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m <= 0 ? `${s}s` : `${m}m ${s}s`;
}
