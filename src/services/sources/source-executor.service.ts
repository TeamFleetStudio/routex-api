import type { BusSearchRequest, NormalizedBusListing } from '../../types/bus.types.js';
import type { SourceConfig, SourceResultMeta } from '../../types/source.types.js';
import type { BusSourceClient } from '../../sources/contracts/bus-source-client.interface.js';
import type { CircuitBreakerService } from '../resilience/circuit-breaker.service.js';
import type { FailureClassifierService } from '../resilience/failure-classifier.service.js';
import type { RetryService } from '../resilience/retry.service.js';
import type { SourceHealthService } from './source-health.service.js';
import type { NormalizationService } from '../normalization/normalization.service.js';
import type { SelfHealingService } from '../self-healing/self-healing.service.js';
import { SourceTimeoutError } from '../../errors/index.js';
import { logger } from '../../utils/logger.js';

export interface SourceExecutionResult {
  meta: SourceResultMeta;
  listings: NormalizedBusListing[];
}

export class SourceExecutorService {
  constructor(
    private readonly circuitBreaker: CircuitBreakerService,
    private readonly retry: RetryService,
    private readonly classifier: FailureClassifierService,
    private readonly health: SourceHealthService,
    private readonly normalization: NormalizationService,
    private readonly selfHealing: SelfHealingService,
  ) {}

  async executeAll(
    sources: Array<{ config: SourceConfig; client: BusSourceClient }>,
    search: BusSearchRequest,
  ): Promise<SourceExecutionResult[]> {
    const settled = await Promise.allSettled(
      sources.map((s) => this.executeOne(s.config, s.client, search)),
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
        },
        listings: [],
      };
    });
  }

  private async executeOne(
    config: SourceConfig,
    client: BusSourceClient,
    search: BusSearchRequest,
  ): Promise<SourceExecutionResult> {
    const started = Date.now();
    const source = config.name;

    const allowed = await this.circuitBreaker.allowRequest(source);
    if (!allowed) {
      logger.info({ event: 'SOURCE_FAILED', source, reason: 'circuit_open' });
      return {
        meta: {
          source,
          status: 'CIRCUIT_OPEN',
          failure_kind: 'UNKNOWN',
          message: 'Circuit breaker open',
          duration_ms: Date.now() - started,
        },
        listings: [],
      };
    }

    logger.info({ event: 'SOURCE_STARTED', source });

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

      if (classified.mayTriggerSelfHealing && config.self_healing_enabled) {
        const healed = await this.selfHealing.tryHeal(source);
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
            return {
              meta: {
                source,
                status: 'SUCCESS',
                duration_ms: Date.now() - started,
              },
              listings,
            };
          } catch {
            // fall through to failure
          }
        }
      }

      const status = classified.kind === 'TIMEOUT' ? 'TIMEOUT' : 'FAILED';
      logger.warn({
        event: status === 'TIMEOUT' ? 'SOURCE_TIMEOUT' : 'SOURCE_FAILED',
        source,
        failure_kind: classified.kind,
        duration_ms: Date.now() - started,
      });

      return {
        meta: {
          source,
          status,
          failure_kind: classified.kind,
          message: classified.message,
          duration_ms: Date.now() - started,
        },
        listings: [],
      };
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
