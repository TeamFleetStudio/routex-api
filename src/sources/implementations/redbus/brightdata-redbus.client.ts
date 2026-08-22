import { request } from 'undici';
import type { BusSearchRequest } from '../../../types/bus.types.js';
import type { RawSourceResult } from '../../../types/source.types.js';
import type { BusSourceClient } from '../../contracts/bus-source-client.interface.js';
import { ExternalApiError, SourceTimeoutError } from '../../../errors/index.js';
import { nowIso } from '../../../utils/time.js';
import { buildRedBusSearchUrl } from './redbus.url.js';

export interface BrightDataRedBusOptions {
  apiKey: string;
  collectorId: string;
  timeoutMs: number;
  pollIntervalMs?: number;
}

/**
 * Bright Data Scraper Studio client for redBus.
 * Flow: POST /dca/trigger → poll GET /dca/dataset until ready.
 */
export class BrightDataRedBusClient implements BusSourceClient {
  readonly sourceName = 'redbus';
  private readonly apiKey: string;
  private readonly collectorId: string;
  private readonly timeoutMs: number;
  private readonly pollIntervalMs: number;

  constructor(options: BrightDataRedBusOptions) {
    this.apiKey = options.apiKey;
    this.collectorId = options.collectorId;
    this.timeoutMs = options.timeoutMs;
    this.pollIntervalMs = options.pollIntervalMs ?? 5_000;
  }

  async search(searchRequest: BusSearchRequest): Promise<RawSourceResult> {
    if (!this.apiKey || !this.collectorId) {
      return {
        source: this.sourceName,
        payload: { listings: [], mode: 'placeholder', reason: 'missing_brightdata_config' },
        fetched_at: nowIso(),
      };
    }

    const searchUrl = buildRedBusSearchUrl(searchRequest);
    const deadline = Date.now() + this.timeoutMs;
    const collectionId = await this.trigger(searchUrl, deadline);
    const rows = await this.pollDataset(collectionId, deadline);

    return {
      source: this.sourceName,
      payload: {
        mode: 'brightdata',
        collector_id: this.collectorId,
        collection_id: collectionId,
        search_url: searchUrl,
        listings: Array.isArray(rows) ? rows : [rows],
      },
      fetched_at: nowIso(),
    };
  }

  private authHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
  }

  private async trigger(searchUrl: string, deadline: number): Promise<string> {
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      throw new SourceTimeoutError(this.sourceName, 'Bright Data trigger timed out before start');
    }

    const url = `https://api.brightdata.com/dca/trigger?collector=${encodeURIComponent(this.collectorId)}&queue_next=1`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.min(remaining, 60_000));

    try {
      const res = await request(url, {
        method: 'POST',
        headers: this.authHeaders(),
        body: JSON.stringify([{ url: searchUrl }]),
        signal: controller.signal,
      });
      const body = (await res.body.json()) as { collection_id?: string; error?: string };
      if (res.statusCode >= 400 || !body.collection_id) {
        throw new ExternalApiError(
          this.sourceName,
          `Bright Data trigger failed: ${JSON.stringify(body)}`,
          res.statusCode,
        );
      }
      return body.collection_id;
    } catch (err) {
      if (err instanceof ExternalApiError) throw err;
      if (err instanceof Error && (err.name === 'AbortError' || err.message.includes('aborted'))) {
        throw new SourceTimeoutError(this.sourceName, 'Bright Data trigger aborted', err);
      }
      throw new ExternalApiError(this.sourceName, 'Bright Data trigger network error', 502, err);
    } finally {
      clearTimeout(timer);
    }
  }

  private async pollDataset(collectionId: string, deadline: number): Promise<unknown> {
    const url = `https://api.brightdata.com/dca/dataset?id=${encodeURIComponent(collectionId)}`;

    while (Date.now() < deadline) {
      const remaining = deadline - Date.now();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), Math.min(remaining, 60_000));

      try {
        const res = await request(url, {
          method: 'GET',
          headers: this.authHeaders(),
          signal: controller.signal,
        });

        if (res.statusCode === 202) {
          clearTimeout(timer);
          await sleep(this.pollIntervalMs);
          continue;
        }

        if (res.statusCode >= 400) {
          const text = await res.body.text();
          throw new ExternalApiError(
            this.sourceName,
            `Bright Data dataset failed: ${text.slice(0, 500)}`,
            res.statusCode,
          );
        }

        return (await res.body.json()) as unknown;
      } catch (err) {
        if (err instanceof ExternalApiError) throw err;
        if (!(err instanceof Error && (err.name === 'AbortError' || err.message.includes('aborted')))) {
          throw new ExternalApiError(this.sourceName, 'Bright Data poll network error', 502, err);
        }
      } finally {
        clearTimeout(timer);
      }

      await sleep(this.pollIntervalMs);
    }

    throw new SourceTimeoutError(
      this.sourceName,
      `Bright Data dataset poll timed out after ${this.timeoutMs}ms`,
    );
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
