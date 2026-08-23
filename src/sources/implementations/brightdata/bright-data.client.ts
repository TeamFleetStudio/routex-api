import { request } from 'undici';
import { ExternalApiError, SourceTimeoutError } from '../../../errors/index.js';
import { sleep } from '../../../utils/time.js';
import { logger } from '../../../utils/logger.js';

export interface BrightDataClientOptions {
  apiToken: string;
  baseUrl: string;
  pollIntervalMs: number;
  maxPollAttempts: number;
  sourceName: string;
  /** @deprecated Always applied on trigger; kept for call-site compat. */
  overrideIncompatibleSchema?: boolean;
}

export class BrightDataClient {
  private readonly apiToken: string;
  private readonly baseUrl: string;
  private readonly pollIntervalMs: number;
  private readonly maxPollAttempts: number;
  private readonly sourceName: string;

  constructor(options: BrightDataClientOptions) {
    this.apiToken = options.apiToken;
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.pollIntervalMs = options.pollIntervalMs;
    this.maxPollAttempts = options.maxPollAttempts;
    this.sourceName = options.sourceName;
  }

  async collect(collectorId: string, inputs: unknown[]): Promise<unknown[]> {
    if (!this.apiToken) {
      throw new ExternalApiError(
        this.sourceName,
        'BRIGHT_DATA_API_TOKEN is not configured',
        500,
      );
    }

    const collectionId = await this.trigger(collectorId, inputs);
    return this.pollUntilReady(collectionId);
  }

  async trigger(collectorId: string, inputs: unknown[]): Promise<string> {
    // Always override — MMT (and healed collectors) often diverge from the linked
    // output schema; without this Bright Data returns 422 output_schema_incompatible.
    const params = new URLSearchParams({
      collector: collectorId,
      queue_next: '1',
      override_incompatible_schema: '1',
    });
    const url = `${this.baseUrl}/dca/trigger?${params.toString()}`;

    let res;
    try {
      res = await request(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiToken}`,
          'Content-Type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify(inputs),
      });
    } catch (err) {
      throw new ExternalApiError(this.sourceName, 'Bright Data trigger network error', 502, err);
    }

    const text = await res.body.text();
    if (res.statusCode === 429) {
      throw new ExternalApiError(this.sourceName, 'Bright Data rate limited', 429);
    }
    if (res.statusCode >= 500) {
      throw new ExternalApiError(this.sourceName, 'Bright Data server error', res.statusCode);
    }
    if (res.statusCode >= 400) {
      const detail = summarizeBrightDataError(text);
      throw new ExternalApiError(
        this.sourceName,
        detail
          ? `Bright Data trigger failed (${res.statusCode}): ${detail}`
          : `Bright Data trigger failed (${res.statusCode})`,
        res.statusCode,
      );
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(text) as unknown;
    } catch (err) {
      throw new ExternalApiError(this.sourceName, 'Bright Data trigger returned invalid JSON', 502, err);
    }

    const collectionId =
      typeof parsed === 'object' &&
      parsed !== null &&
      'collection_id' in parsed &&
      typeof (parsed as { collection_id: unknown }).collection_id === 'string'
        ? (parsed as { collection_id: string }).collection_id
        : null;

    if (!collectionId) {
      throw new ExternalApiError(
        this.sourceName,
        'Bright Data trigger returned no collection_id',
        502,
      );
    }

    logger.info({
      event: 'SOURCE_STARTED',
      source: this.sourceName,
      collection_id: collectionId,
      phase: 'bright_data_triggered',
    });

    return collectionId;
  }

  async pollUntilReady(collectionId: string): Promise<unknown[]> {
    const url = `${this.baseUrl}/dca/dataset?id=${encodeURIComponent(collectionId)}`;

    for (let attempt = 1; attempt <= this.maxPollAttempts; attempt++) {
      await sleep(this.pollIntervalMs);

      let res;
      try {
        res = await request(url, {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${this.apiToken}`,
            accept: 'application/json',
          },
        });
      } catch (err) {
        throw new ExternalApiError(this.sourceName, 'Bright Data poll network error', 502, err);
      }

      const text = await res.body.text();

      if (res.statusCode === 202) {
        logger.info({
          event: 'SOURCE_STARTED',
          source: this.sourceName,
          collection_id: collectionId,
          phase: 'bright_data_building',
          attempt,
        });
        continue;
      }

      if (res.statusCode === 429) {
        throw new ExternalApiError(this.sourceName, 'Bright Data rate limited', 429);
      }
      if (res.statusCode >= 500) {
        // Transient — continue polling a few times; after last attempt throw
        if (attempt < this.maxPollAttempts) continue;
        throw new ExternalApiError(this.sourceName, 'Bright Data server error', res.statusCode);
      }
      if (res.statusCode >= 400) {
        throw new ExternalApiError(
          this.sourceName,
          `Bright Data dataset failed (${res.statusCode})`,
          res.statusCode,
        );
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(text) as unknown;
      } catch (err) {
        throw new ExternalApiError(this.sourceName, 'Bright Data dataset invalid JSON', 502, err);
      }

      if (this.isBuilding(parsed)) {
        logger.info({
          event: 'SOURCE_STARTED',
          source: this.sourceName,
          collection_id: collectionId,
          phase: 'bright_data_building',
          attempt,
        });
        continue;
      }

      if (Array.isArray(parsed)) {
        logger.info({
          event: 'SOURCE_SUCCESS',
          source: this.sourceName,
          collection_id: collectionId,
          phase: 'bright_data_ready',
          count: parsed.length,
        });
        return parsed;
      }

      const nested = extractDatasetRecords(parsed);
      if (nested) {
        logger.info({
          event: 'SOURCE_SUCCESS',
          source: this.sourceName,
          collection_id: collectionId,
          phase: 'bright_data_ready',
          count: nested.length,
        });
        return nested;
      }

      throw new ExternalApiError(
        this.sourceName,
        'Bright Data dataset returned unexpected shape',
        422,
      );
    }

    throw new SourceTimeoutError(
      this.sourceName,
      'Timed out waiting for Bright Data collector results',
    );
  }

  private isBuilding(parsed: unknown): boolean {
    if (typeof parsed !== 'object' || parsed === null) return false;
    const status = (parsed as { status?: unknown }).status;
    return typeof status === 'string' && status.toLowerCase() === 'building';
  }
}

function extractDatasetRecords(parsed: unknown): unknown[] | null {
  if (typeof parsed !== 'object' || parsed === null) return null;
  const obj = parsed as Record<string, unknown>;
  for (const key of ['data', 'records', 'results'] as const) {
    const value = obj[key];
    if (Array.isArray(value)) return value;
  }
  return null;
}

function summarizeBrightDataError(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  try {
    const parsed = JSON.parse(trimmed) as {
      error?: { message?: string; code?: string };
      message?: string;
    };
    const msg = parsed.error?.message ?? parsed.message;
    const code = parsed.error?.code;
    if (msg && code) return `${code}: ${msg}`;
    if (msg) return msg;
  } catch {
    /* fall through */
  }
  return trimmed.slice(0, 300);
}
