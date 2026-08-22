import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import type { Env } from '../config/env.js';
import { createRedisClient, connectRedis } from '../config/redis.js';
import { requestContextPlugin } from '../middleware/request-context.middleware.js';
import { errorHandler } from '../middleware/error-handler.middleware.js';
import { createRateLimitPlugin } from '../middleware/rate-limit.middleware.js';
import { createHealthRoutes } from '../routes/health.routes.js';
import { createBusRoutes } from '../routes/bus.routes.js';
import { createBrightDataRoutes } from '../routes/brightdata.routes.js';
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
import { RedBusSourceClient } from '../sources/implementations/redbus/redbus.client.js';
import { BrightDataRedBusClient } from '../sources/implementations/redbus/brightdata-redbus.client.js';
import { RedBusAdapter } from '../sources/implementations/redbus/redbus.adapter.js';
import { AbhiBusSourceClient } from '../sources/implementations/abhibus/abhibus.client.js';
import { AbhiBusAdapter } from '../sources/implementations/abhibus/abhibus.adapter.js';
import { MMTSourceClient } from '../sources/implementations/makemytrip/makemytrip.client.js';
import { MakeMyTripAdapter } from '../sources/implementations/makemytrip/makemytrip.adapter.js';

export async function buildApp(env: Env) {
  const redis = createRedisClient(env);
  await connectRedis(redis);

  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL,
      redact: {
        paths: ['apiKey', 'api_key', 'authorization', 'headers.authorization'],
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
  normalization.register(new RedBusAdapter());
  normalization.register(new AbhiBusAdapter());
  normalization.register(new MakeMyTripAdapter());

  const registry = new SourceRegistryService(redis, env);
  const redBusClient =
    env.BRIGHTDATA_API_KEY && env.COLLECTOR_REDBUS
      ? new BrightDataRedBusClient({
          apiKey: env.BRIGHTDATA_API_KEY,
          collectorId: env.COLLECTOR_REDBUS,
          timeoutMs: env.BRIGHTDATA_TIMEOUT_MS,
          pollIntervalMs: env.BRIGHTDATA_POLL_INTERVAL_MS,
        })
      : new RedBusSourceClient(env.REDBUS_API_URL, env.REDBUS_API_KEY, env.DEFAULT_SOURCE_TIMEOUT_MS);
  registry.registerClient(redBusClient);
  registry.registerClient(
    new AbhiBusSourceClient(
      env.ABHIBUS_API_URL,
      env.ABHIBUS_API_KEY,
      env.DEFAULT_SOURCE_TIMEOUT_MS,
    ),
  );
  registry.registerClient(
    new MMTSourceClient(env.MMT_API_URL, env.MMT_API_KEY, env.DEFAULT_SOURCE_TIMEOUT_MS),
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
  await app.register(createBrightDataRoutes(env));

  return { app, redis, env };
}
