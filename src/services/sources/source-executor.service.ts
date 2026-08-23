import type { BusSearchRequest, NormalizedBusListing } from '../../types/bus.types.js';
import type { SourceConfig, SourceResultMeta } from '../../types/source.types.js';
import type { BusSourceClient } from '../../sources/contracts/bus-source-client.interface.js';
import type { CircuitBreakerService } from '../resilience/circuit-breaker.service.js';
import type { FailureClassifierService } from '../resilience/failure-classifier.service.js';
import type { RetryService } from '../resilience/retry.service.js';
import type { SourceHealthService } from './source-health.service.js';
import type { NormalizationService } from '../normalization/normalization.service.js';
import type { SelfHealingService } from '../self-healing/self-healing.service.js';
import type { ProviderCacheService } from '../cache/provider-cache.service.js';
import type { DistributedLockService } from '../cache/distributed-lock.service.js';
import type { ProviderRefreshScheduler } from '../cache/provider-refresh.scheduler.js';
import { SourceTimeoutError } from '../../errors/index.js';
import {
  buildProviderCacheKey,
  buildProviderLockKey,
} from '../../utils/cache-key.js';
import { logger } from '../../utils/logger.js';

export interface SourceExecutionResult {
  meta: SourceResultMeta;
  listings: NormalizedBusListing[];
}

export interface SourceExecutionOptions {
  forceLive?: boolean;
  onProviderRefreshed?: (result: SourceExecutionResult) => void;
}

export class SourceExecutorService {
  constructor(
    private readonly circuitBreaker: CircuitBreakerService,
    private readonly retry: RetryService,
    private readonly classifier: FailureClassifierService,
    private readonly health: SourceHealthService,
    private readonly normalization: NormalizationService,
    private readonly selfHealing: SelfHealingService,
    private readonly providerCache: ProviderCacheService,
    private readonly locks: DistributedLockService,
    private readonly refreshScheduler: ProviderRefreshScheduler,
  ) {}

  async executeAll(
    sources: Array<{ config: SourceConfig; client: BusSourceClient }>,
    search: BusSearchRequest,
    options?: SourceExecutionOptions,
  ): Promise<SourceExecutionResult[]> {
    const settled = await Promise.allSettled(
      sources.map((s) => this.executeOne(s.config, s.client, search, options)),
    );

    return settled.map((result, index) => {
      if (result.status === 'fulfilled') return result.value;
      const source = sources[index].config.name;
      const classified = this.classifier.classify(result.reason);
      return {
        meta: {
          source,
          status: classified.kind === 'TIMEOUT' ? 'TIMEOUT' : 'FAILED',
          failure_kind: classified.kind,
          message: classified.message,
          duration_ms: 0,
          cache_status: 'miss',
        },
        listings: [],
      };
    });
  }

  async executeOne(
    config: SourceConfig,
    client: BusSourceClient,
    search: BusSearchRequest,
    options?: SourceExecutionOptions,
  ): Promise<SourceExecutionResult> {
    const started = Date.now();
    const source = config.name;
    const cacheKey = buildProviderCacheKey(
      source,
      search.from_city,
      search.to_city,
      search.travel_date,
      search.depart_after,
    );

    if (!options?.forceLive) {
      const cached = await this.tryServeFromCache(
        config,
        client,
        search,
        cacheKey,
        started,
        options,
      );
      if (cached) return cached;
    }

    return this.fetchLiveWithLock(config, client, search, cacheKey, started, options);
  }

  private async tryServeFromCache(
    config: SourceConfig,
    client: BusSourceClient,
    search: BusSearchRequest,
    cacheKey: string,
    started: number,
    options?: SourceExecutionOptions,
  ): Promise<SourceExecutionResult | null> {
    const source = config.name;
    const { entry, freshness } = await this.providerCache.getProvider(cacheKey);

    if (!entry) return null;

    if (entry.status === 'failed' && this.providerCache.isInRetryCooldown(entry)) {
      if (entry.listings.length > 0) {
        return {
          meta: {
            source,
            status: 'SUCCESS',
            duration_ms: Date.now() - started,
            cache_status: 'stale',
            message: entry.message,
          },
          listings: entry.listings,
        };
      }
      return {
        meta: {
          source,
          status: 'SKIPPED',
          failure_kind: entry.failure_kind,
          message: entry.message ?? 'Provider in retry cooldown',
          duration_ms: Date.now() - started,
          cache_status: 'skipped',
        },
        listings: [],
      };
    }

    if (freshness === 'fresh' && entry.status === 'success') {
      return {
        meta: {
          source,
          status: 'SUCCESS',
          duration_ms: Date.now() - started,
          cache_status: 'fresh',
        },
        listings: entry.listings,
      };
    }

    if (freshness === 'stale' && entry.listings.length > 0) {
      this.scheduleProviderRefresh(config, client, search, cacheKey, options);
      return {
        meta: {
          source,
          status: 'SUCCESS',
          duration_ms: Date.now() - started,
          cache_status: 'stale',
        },
        listings: entry.listings,
      };
    }

    return null;
  }

  private scheduleProviderRefresh(
    config: SourceConfig,
    client: BusSourceClient,
    search: BusSearchRequest,
    cacheKey: string,
    options?: SourceExecutionOptions,
  ): void {
    this.refreshScheduler.schedule(cacheKey, async () => {
      await this.executeOne(config, client, search, {
        forceLive: true,
        onProviderRefreshed: options?.onProviderRefreshed,
      });
    });
  }

  private async fetchLiveWithLock(
    config: SourceConfig,
    client: BusSourceClient,
    search: BusSearchRequest,
    cacheKey: string,
    started: number,
    options?: SourceExecutionOptions,
  ): Promise<SourceExecutionResult> {
    const source = config.name;
    const lockKey = buildProviderLockKey(
      source,
      search.from_city,
      search.to_city,
      search.travel_date,
      search.depart_after,
    );
    const token = await this.locks.acquire(lockKey);

    if (!token) {
      const { entry } = await this.providerCache.getProvider(cacheKey);
      if (entry && entry.listings.length > 0) {
        return {
          meta: {
            source,
            status: 'SUCCESS',
            duration_ms: Date.now() - started,
            cache_status: 'stale',
          },
          listings: entry.listings,
        };
      }
    }

    try {
      if (!options?.forceLive) {
        const cached = await this.tryServeFromCache(
          config,
          client,
          search,
          cacheKey,
          started,
          options,
        );
        if (cached) return cached;
      }

      const result = await this.fetchLive(config, client, search, started);
      await this.providerCache.setProviderSuccess(cacheKey, source, result.listings);
      options?.onProviderRefreshed?.(result);
      return { ...result, meta: { ...result.meta, cache_status: 'miss' } };
    } catch (err) {
      const classified = this.classifier.classify(err);
      const { entry } = await this.providerCache.getProvider(cacheKey);
      await this.providerCache.setProviderFailure(
        cacheKey,
        source,
        { failure_kind: classified.kind, message: classified.message },
        entry?.listings ?? [],
      );

      if (entry && entry.listings.length > 0) {
        return {
          meta: {
            source,
            status: 'SUCCESS',
            failure_kind: classified.kind,
            message: classified.message,
            duration_ms: Date.now() - started,
            cache_status: 'stale',
          },
          listings: entry.listings,
        };
      }

      const status = classified.kind === 'TIMEOUT' ? 'TIMEOUT' : 'FAILED';
      return {
        meta: {
          source,
          status,
          failure_kind: classified.kind,
          message: classified.message,
          duration_ms: Date.now() - started,
          cache_status: 'miss',
        },
        listings: [],
      };
    } finally {
      if (token) {
        await this.locks.release(lockKey, token);
      }
    }
  }

  private async fetchLive(
    config: SourceConfig,
    client: BusSourceClient,
    search: BusSearchRequest,
    started: number,
  ): Promise<SourceExecutionResult> {
    const source = config.name;

    const allowed = await this.circuitBreaker.allowRequest(source);
    if (!allowed) {
      logger.info({ event: 'SOURCE_FAILED', source, reason: 'circuit_open' });
      throw new SourceTimeoutError(source);
    }

    logger.info({ event: 'SOURCE_STARTED', source, phase: 'live_fetch' });

    try {
      const listings = await this.retry.execute(
        async () => {
          const raw = await this.withTimeout(
            () => client.search(search),
            config.timeout_ms,
            source,
          );
          return this.normalization.normalize(source, raw.payload, search);
        },
        { retryCount: config.retry_count, source },
      );

      await this.circuitBreaker.recordSuccess(source);
      await this.health.recordSuccess(source);
      logger.info({
        event: 'SOURCE_SUCCESS',
        source,
        duration_ms: Date.now() - started,
        count: listings.length,
      });

      return {
        meta: {
          source,
          status: 'SUCCESS',
          duration_ms: Date.now() - started,
        },
        listings,
      };
    } catch (err) {
      const classified = this.classifier.classify(err);
      await this.circuitBreaker.recordFailure(source);
      await this.health.recordFailure(source, classified.kind);

      let healingAttempted = false;

      if (config.self_healing_enabled && this.selfHealing.shouldAttemptHeal(classified.kind)) {
        healingAttempted = true;
        const healed = await this.selfHealing.tryHeal(source, {
          search,
          failure_kind: classified.kind,
          message: classified.message,
        });
        if (healed) {
          try {
            const raw = await this.withTimeout(
              () => client.search(search),
              config.timeout_ms,
              source,
            );
            const listings = this.normalization.normalize(source, raw.payload, search);
            await this.circuitBreaker.recordSuccess(source);
            await this.health.recordSuccess(source);
            logger.info({
              event: 'SOURCE_SUCCESS',
              source,
              duration_ms: Date.now() - started,
              count: listings.length,
              after_healing: true,
            });
            return {
              meta: {
                source,
                status: 'SUCCESS',
                duration_ms: Date.now() - started,
                healing_attempted: true,
              },
              listings,
            };
          } catch (retryErr) {
            logger.warn({
              event: 'SOURCE_FAILED',
              source,
              failure_kind: classified.kind,
              phase: 'post_healing_retry',
              message: retryErr instanceof Error ? retryErr.message : 'unknown',
            });
          }
        }
      }

      const status = classified.kind === 'TIMEOUT' ? 'TIMEOUT' : 'FAILED';
      logger.warn({
        event: status === 'TIMEOUT' ? 'SOURCE_TIMEOUT' : 'SOURCE_FAILED',
        source,
        failure_kind: classified.kind,
        duration_ms: Date.now() - started,
        healing_attempted: healingAttempted,
      });

      throw err;
    }
  }

  private async withTimeout<T>(
    fn: () => Promise<T>,
    timeoutMs: number,
    source: string,
  ): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        fn(),
        new Promise<T>((_, reject) => {
          timer = setTimeout(() => {
            reject(new SourceTimeoutError(source));
          }, timeoutMs);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
