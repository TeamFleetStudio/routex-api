# RouteX API

Multi-source bus search and comparison backend for the hackathon stack:

**Node.js · TypeScript · Fastify · Redis · Pino · Zod · Undici · Vitest**

Redis is the **only** storage layer. There is no PostgreSQL, ORM, Docker, or authentication.

---

## What is RouteX API?

RouteX accepts an origin city, destination city, and travel date, then:

1. Rate-limits by IP
2. Checks Redis cache (fresh / stale-while-revalidate)
3. Prevents cache stampedes with distributed locks
4. Loads enabled sources from Redis
5. Calls providers in parallel
6. Adapts and normalizes responses
7. Matches listings into canonical buses
8. Returns `SUCCESS`, `PARTIAL_SUCCESS`, or `SEARCH_FAILED`

External provider URLs are configured via environment variables. Placeholder clients work locally when URLs are empty (no invented production endpoints).

---

## Features

- IP-based Redis rate limiting
- Request / correlation IDs (`x-request-id`)
- Zod search validation
- Dynamic travel-date cache TTL
- Stale-while-revalidate
- Cache stampede prevention
- Dynamic source registry in Redis
- Parallel source execution (`Promise.allSettled`)
- Provider adapters + normalization
- Failure classification, retries, circuit breaker
- Source health tracking
- Self-healing API integration (optional)
- Pluggable bus matching architecture
- Structured Pino logging
- Vitest unit tests

---

## Architecture

```text
Client
  → IP Rate Limiter
  → Request Context / Correlation ID
  → Fastify Route
  → Controller
  → Search Service
  → Redis Cache
       ├─ HIT (fresh)     → return
       ├─ STALE           → return + background refresh
       └─ MISS / EXPIRED  → lock → orchestrator → sources → normalize → match → cache → respond
```

SOLID-oriented services keep orchestration independent of provider specifics. New sources implement `BusSourceClient` + `SourceAdapter` and register in the composition root (`src/app/app.ts`).

---

## Redis usage

| Key | Purpose |
|-----|---------|
| `routex:search:{from}:{to}:{date}` | Search cache + SWR metadata |
| `routex:lock:search:...` | Stampede lock |
| `routex:ratelimit:ip:{ip}` | Rate limit counters |
| `routex:sources:config` | Dynamic source configuration |
| `routex:source:health:{name}` | Health counters / state |
| `routex:circuit:{name}` | Circuit breaker state |
| `routex:lock:healing:{name}` | Self-healing lock |

### Cache strategy

TTL depends on how far the travel date is (today → 1m, tomorrow → 5m, 2–7d → 15m, 8–14d → 1h, 15–30d → 6h, 30d+ → 24h). Stale window = fresh TTL × `STALE_MULTIPLIER` (default 3).

### Stale-while-revalidate

Cache entries store `data`, `fresh_until`, `stale_until`, `created_at`. Fresh hits return immediately. Stale hits return immediately and refresh in the background. Expired entries trigger a locked fetch.

### Cache stampede prevention

On miss, acquire `routex:lock:search:...`. Losers wait briefly for cache population (or return stale data if available).

---

## External source architecture

```text
External API → Source Client → Adapter → NormalizedBusListing[]
```

Configured sources (seeded into Redis if missing): `redbus`, `abhibus`, `makemytrip`. Secrets stay in env vars; Redis stores non-secret config (`base_url` as `ENV_REFERENCE:...`).

---

## Normalization & matching

Adapters map provider fields into the shared normalized model (unknown scalars → `null`, arrays → `[]`). Matching is pluggable via `MatchingStrategy`; the default clusters by operator + departure similarity into `CanonicalBus` with multi-source offers.

---

## Failure handling & self-healing

Failures are classified (`TIMEOUT`, `RATE_LIMITED`, `NETWORK_ERROR`, …). Retryable errors use exponential backoff with jitter. Circuit breakers skip unhealthy sources. Structural / extraction failures may call the optional self-healing API (single Redis lock per source), then retry once.

---

## How to run locally

```bash
npm install
cp .env.example .env
# set REDIS_URL to your Redis instance

npm run dev      # http://localhost:3000
npm test
npm run build
npm start
```

Redis must be reachable via `REDIS_URL`. No Docker is required or provided.

---

## Environment variables

| Variable | Description |
|----------|-------------|
| `NODE_ENV` | `development` / `test` / `production` |
| `PORT` | HTTP port (default `3000`) |
| `REDIS_URL` | Redis connection URL (**required**) |
| `TRUST_PROXY` | `true` only behind trusted reverse proxies |
| `RATE_LIMIT_MAX` | Max requests per window (default `100`) |
| `RATE_LIMIT_WINDOW_MS` | Window size (default `60000`) |
| `DEFAULT_SOURCE_TIMEOUT_MS` | Per-source timeout |
| `DEFAULT_SOURCE_RETRY_COUNT` | Retries after first attempt |
| `REDBUS_API_URL` / `REDBUS_API_KEY` | RedBus provider (optional) |
| `ABHIBUS_API_URL` / `ABHIBUS_API_KEY` | AbhiBus provider (optional) |
| `MMT_API_URL` / `MMT_API_KEY` | MakeMyTrip provider (optional) |
| `SELF_HEALING_API_URL` / `SELF_HEALING_API_KEY` | Self-healing API (optional) |

---

## API endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Liveness |
| `GET` | `/health/redis` | Redis connectivity |
| `POST` | `/api/v1/buses/search` | Bus search |

### Example request

```http
POST /api/v1/buses/search
Content-Type: application/json

{
  "from_city": "Chennai",
  "to_city": "Bengaluru",
  "travel_date": "2026-08-25"
}
```

### Example response

```json
{
  "success": true,
  "status": "PARTIAL_SUCCESS",
  "request_id": "req_xxx",
  "search_id": "search_xxx",
  "cache": { "hit": false, "stale": false },
  "sources": [
    { "source": "redbus", "status": "SUCCESS", "duration_ms": 120 },
    { "source": "abhibus", "status": "SUCCESS", "duration_ms": 98 },
    { "source": "makemytrip", "status": "TIMEOUT", "failure_kind": "TIMEOUT", "duration_ms": 10000 }
  ],
  "results": [
    {
      "canonical_bus_id": "bus_abc123",
      "operator_name": "VRL Travels",
      "departure_time": "23:00",
      "arrival_time": "05:50",
      "bus_type": "AC Sleeper",
      "match_confidence": 0.94,
      "offers": [
        { "source": "redbus", "price_inr": 1224 },
        { "source": "abhibus", "price_inr": 1100 }
      ]
    }
  ]
}
```

With placeholder providers (empty API URLs), successful sources typically return empty `results` while still reporting `SUCCESS`.

---

## Project structure

See `src/` for app, config, routes, controllers, services, sources, middleware, schemas, errors, types, and utils. Tests live under `tests/`.
