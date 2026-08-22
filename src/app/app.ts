import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import type { Env } from '../config/env.js';
import { createRedisClient, connectRedis } from '../config/redis.js';
import { requestContextPlugin } from '../middleware/request-context.middleware.js';
import { errorHandler } from '../middleware/error-handler.middleware.js';
import { createRateLimitPlugin } from '../middleware/rate-limit.middleware.js';
import { createHealthRoutes } from '../routes/health.routes.js';
import { createBusRoutes } from '../routes/bus.routes.js';
import { BusSearchController } from '../controllers/bus-search.controller.js';
import { CacheService } from '../services/cache/cache.service.js';
import { CachePolicyService } from '../services/cache/cache-policy.service.js';
import { DistributedLockService } from '../services/cache/distributed-lock.service.js';
import { FailureClassifierService } from '../services/resilience/failure-classifier.service.js';
import { RetryService } from '../services/resilience/retry.service.js';
import { CircuitBreakerService } from '../services/resilience/circuit-breaker.service.js';
import { SourceHealthService } from '../services/sources/source-health.service.js';
import { SourceRegistryService } from '../services/sources/source-registry.service.js';
import { SourceExecutorService } from '../services/sources/source-executor.service.js';
import { NormalizationService } from '../services/normalization/normalization.service.js';
import { SelfHealingService } from '../services/self-healing/self-healing.service.js';
import { MatchingScoreService } from '../services/matching/matching-score.service.js';
import { DefaultMatchingStrategy } from '../services/matching/default-matching.strategy.js';
import { BusMatchingService } from '../services/matching/bus-matching.service.js';
import { SearchOrchestratorService } from '../services/search/search-orchestrator.service.js';
import { SearchService } from '../services/search/search.service.js';
import { BrightDataClient } from '../sources/implementations/brightdata/bright-data.client.js';
import { BrightDataSourceClient } from '../sources/implementations/brightdata/bright-data-source.client.js';
import { UnifiedScraperAdapter } from '../sources/implementations/scraper/unified-scraper.adapter.js';

export async function buildApp(env: Env) {
  const redis = createRedisClient(env);
  await connectRedis(redis);

  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL,
      redact: {
        paths: [
          'apiKey',
          'api_key',
          'authorization',
          'headers.authorization',
          'BRIGHT_DATA_API_TOKEN',
        ],
        remove: true,
      },
      transport:
        env.NODE_ENV === 'development'
          ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:standard' } }
          : undefined,
    },
    trustProxy: env.TRUST_PROXY,
    requestIdHeader: 'x-request-id',
    genReqId: (req) => {
      const incoming = req.headers['x-request-id'];
      if (typeof incoming === 'string' && incoming.trim()) return incoming.trim();
      return randomUUID();
    },
  });

  app.setErrorHandler(errorHandler);
  await app.register(requestContextPlugin);
  await app.register(createRateLimitPlugin({ redis, env }));

  const cache = new CacheService(redis);
  const cachePolicy = new CachePolicyService(env.STALE_MULTIPLIER);
  const locks = new DistributedLockService(
    redis,
    env.LOCK_TTL_MS,
    env.LOCK_WAIT_MS,
    env.LOCK_POLL_MS,
  );

  const classifier = new FailureClassifierService();
  const retry = new RetryService(classifier);
  const circuitBreaker = new CircuitBreakerService(
    redis,
    env.CIRCUIT_FAILURE_THRESHOLD,
    env.CIRCUIT_COOLDOWN_MS,
  );
  const health = new SourceHealthService(redis);
  const selfHealing = new SelfHealingService(env, locks, health);

  const normalization = new NormalizationService();
  for (const site of ['redbus', 'abhibus'] as const) {
    normalization.register(UnifiedScraperAdapter.forSite(site));
  }

  const brightDataFor = (sourceName: string) =>
    new BrightDataClient({
      apiToken: env.BRIGHT_DATA_API_TOKEN,
      baseUrl: env.BRIGHT_DATA_BASE_URL,
      pollIntervalMs: env.BRIGHT_DATA_POLL_INTERVAL_MS,
      maxPollAttempts: env.BRIGHT_DATA_MAX_POLL_ATTEMPTS,
      sourceName,
    });

  const scraperLimit = env.SCRAPER_DEFAULT_LIMIT;
  const registry = new SourceRegistryService(redis, env);
  registry.registerClient(
    new BrightDataSourceClient(
      'redbus',
      brightDataFor('redbus'),
      env.REDBUS_COLLECTOR_ID,
      scraperLimit,
    ),
  );
  registry.registerClient(
    new BrightDataSourceClient(
      'abhibus',
      brightDataFor('abhibus'),
      env.ABHIBUS_COLLECTOR_ID,
      env.ABHIBUS_RESULT_LIMIT,
    ),
  );
  await registry.seedDefaultsIfMissing();

  const executor = new SourceExecutorService(
    circuitBreaker,
    retry,
    classifier,
    health,
    normalization,
    selfHealing,
  );

  const matchingScore = new MatchingScoreService();
  const matching = new BusMatchingService(new DefaultMatchingStrategy(matchingScore));
  const orchestrator = new SearchOrchestratorService(registry, executor, matching);
  const searchService = new SearchService(cache, cachePolicy, locks, orchestrator);
  const controller = new BusSearchController(searchService);

  await app.register(createHealthRoutes(redis));
  await app.register(createBusRoutes(controller));

  return { app, redis, env };
}
