import { request } from 'undici';
import type { BusSearchRequest } from '../../../types/bus.types.js';
import type { RawSourceResult } from '../../../types/source.types.js';
import type { BusSourceClient } from '../../contracts/bus-source-client.interface.js';
import { ExternalApiError, SourceTimeoutError } from '../../../errors/index.js';
import { nowIso } from '../../../utils/time.js';

export interface GenericApiSourceOptions {
  sourceName: string;
  baseUrl: string;
  apiKey: string;
  timeoutMs: number;
}

/**
 * Placeholder HTTP client for external bus APIs.
 * When baseUrl is empty, returns an empty payload so local/dev works without providers.
 */
export class GenericApiSourceClient implements BusSourceClient {
  readonly sourceName: string;
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;

  constructor(options: GenericApiSourceOptions) {
    this.sourceName = options.sourceName;
    this.baseUrl = options.baseUrl;
    this.apiKey = options.apiKey;
    this.timeoutMs = options.timeoutMs;
  }

  async search(searchRequest: BusSearchRequest): Promise<RawSourceResult> {
    if (!this.baseUrl) {
      return {
        source: this.sourceName,
        payload: { listings: [], mode: 'placeholder' },
        fetched_at: nowIso(),
      };
    }

    const url = new URL('/search', this.baseUrl);
    url.searchParams.set('from', searchRequest.from_city);
    url.searchParams.set('to', searchRequest.to_city);
    url.searchParams.set('date', searchRequest.travel_date);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const headers: Record<string, string> = {
        accept: 'application/json',
      };
      if (this.apiKey) {
        headers['x-api-key'] = this.apiKey;
      }

      const res = await request(url, {
        method: 'GET',
        headers,
        signal: controller.signal,
      });

      if (res.statusCode === 429) {
        throw new ExternalApiError(this.sourceName, 'Provider rate limited', 429);
      }
      if (res.statusCode >= 500) {
        throw new ExternalApiError(this.sourceName, 'Provider server error', res.statusCode);
      }
      if (res.statusCode >= 400) {
        throw new ExternalApiError(this.sourceName, 'Provider request failed', res.statusCode);
      }

      const payload = (await res.body.json()) as unknown;
      return {
        source: this.sourceName,
        payload,
        fetched_at: nowIso(),
      };
    } catch (err) {
      if (err instanceof ExternalApiError) throw err;
      if (err instanceof Error && (err.name === 'AbortError' || err.message.includes('aborted'))) {
        throw new SourceTimeoutError(this.sourceName, 'Source request timed out', err);
      }
      throw new ExternalApiError(this.sourceName, 'Provider network error', 502, err);
    } finally {
      clearTimeout(timer);
    }
  }
}
