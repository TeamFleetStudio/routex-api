import { randomUUID } from 'node:crypto';
import cors from '@fastify/cors';
import Fastify from 'fastify';
import type { Env } from '../config/env.js';
import { createRedisClient, connectRedis } from '../config/redis.js';
import { requestContextPlugin } from '../middleware/request-context.middleware.js';
import { errorHandler } from '../middleware/error-handler.middleware.js';
import { createRateLimitPlugin } from '../middleware/rate-limit.middleware.js';
import { createHealthRoutes } from '../routes/health.routes.js';
import { createBusRoutes } from '../routes/bus.routes.js';
import { BusSearchController } from '../controllers/bus-search.controller.js';
import { SearchPaginationController } from '../controllers/search-pagination.controller.js';
import { SearchStatusController } from '../controllers/search-status.controller.js';
import { SearchEventsController } from '../controllers/search-events.controller.js';
import { AnalyticsController } from '../controllers/analytics.controller.js';
import { DistributedLockService } from '../services/cache/distributed-lock.service.js';
import { ProviderCacheService } from '../services/cache/provider-cache.service.js';
import { SearchSessionService } from '../services/cache/search-session.service.js';
import { ProviderRefreshScheduler } from '../services/cache/provider-refresh.scheduler.js';
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
import { SearchEventsService } from '../services/search/search-events.service.js';
import { SearchFilterService } from '../services/search/search-filter.service.js';
import { ProviderAnalyticsService } from '../services/analytics/provider-analytics.service.js';
import { BrightDataClient } from '../sources/implementations/brightdata/bright-data.client.js';
import { BrightDataSourceClient } from '../sources/implementations/brightdata/bright-data-source.client.js';
import { UnifiedScraperAdapter } from '../sources/implementations/scraper/unified-scraper.adapter.js';
import { getPinoTransport } from '../utils/pino-transport.js';

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
      transport: getPinoTransport(),
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

  const allowedOrigins = new Set(env.CORS_ORIGINS);
  await app.register(cors, {
    origin: (origin: string | undefined, cb: (err: Error | null, allow?: boolean) => void): void => {
      // Non-browser clients (curl, server-to-server) send no Origin
      if (!origin) {
        cb(null, true);
        return;
      }
      const normalized = origin.replace(/\/$/, '');
      cb(null, allowedOrigins.has(normalized));
    },
    methods: ['GET', 'HEAD', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Accept', 'x-request-id', 'Authorization'],
    exposedHeaders: ['x-request-id'],
    credentials: true,
    maxAge: 86_400,
    preflight: true,
    strictPreflight: false,
  });

  await app.register(requestContextPlugin);
  await app.register(createRateLimitPlugin({ redis, env }));

  const locks = new DistributedLockService(
    redis,
    env.LOCK_TTL_MS,
    env.LOCK_WAIT_MS,
    env.LOCK_POLL_MS,
  );
  const providerCache = new ProviderCacheService(redis, env);
  const sessionService = new SearchSessionService(redis, env);
  const refreshScheduler = new ProviderRefreshScheduler();

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
  normalization.register(UnifiedScraperAdapter.forSite('redbus'));
  normalization.register(UnifiedScraperAdapter.forSite('makemytrip'));
  normalization.register(UnifiedScraperAdapter.forSite('cleartrip'));

  const brightDataFor = (sourceName: string) =>
    new BrightDataClient({
      apiToken: env.BRIGHT_DATA_API_TOKEN,
      baseUrl: env.BRIGHT_DATA_BASE_URL,
      pollIntervalMs: env.BRIGHT_DATA_POLL_INTERVAL_MS,
      maxPollAttempts: env.BRIGHT_DATA_MAX_POLL_ATTEMPTS,
      sourceName,
      // Always on in client.trigger; keep flag for clarity / future collectors.
      overrideIncompatibleSchema: true,
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
      'makemytrip',
      brightDataFor('makemytrip'),
      env.MAKEMYTRIP_COLLECTOR_ID,
      scraperLimit,
    ),
  );
  registry.registerClient(
    new BrightDataSourceClient(
      'cleartrip',
      brightDataFor('cleartrip'),
      env.CLEARTrip_COLLECTOR_ID,
      scraperLimit,
    ),
  );
  await registry.seedDefaultsIfMissing();

  const analytics = new ProviderAnalyticsService(redis);
  const executor = new SourceExecutorService(
    circuitBreaker,
    retry,
    classifier,
    health,
    normalization,
    selfHealing,
    providerCache,
    locks,
    refreshScheduler,
    analytics,
  );

  const matchingScore = new MatchingScoreService();
  const matching = new BusMatchingService(new DefaultMatchingStrategy(matchingScore));
  const searchEvents = new SearchEventsService();
  const searchFilter = new SearchFilterService();
  const orchestrator = new SearchOrchestratorService(
    registry,
    executor,
    matching,
    sessionService,
    searchEvents,
    env.POST_FIRST_RESULT_WAIT_MS,
  );
  const searchService = new SearchService(
    sessionService,
    locks,
    orchestrator,
    refreshScheduler,
    searchFilter,
    searchEvents,
    env.POST_HARD_DEADLINE_MS,
  );
  const controller = new BusSearchController(searchService);
  const paginationController = new SearchPaginationController(searchService);
  const statusController = new SearchStatusController(searchService);
  const eventsController = new SearchEventsController(searchService);
  const analyticsController = new AnalyticsController(analytics, registry, health);

  await app.register(createHealthRoutes(redis));
  await app.register(
    createBusRoutes(
      controller,
      paginationController,
      statusController,
      eventsController,
      analyticsController,
    ),
  );

  return { app, redis, env };
}
