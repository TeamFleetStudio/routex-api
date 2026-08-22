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

External providers (Bright Data Scraper Studio collectors only):

| Source | `source_site` | Env collector ID | Default collector |
|--------|---------------|------------------|-------------------|
| RedBus | `redbus` | `REDBUS_COLLECTOR_ID` | `c_mt45kbsacfoxm1vlm` |
| AbhiBus | `abhibus` | `ABHIBUS_COLLECTOR_ID` | `c_mt494k6m154fl23cty` |

Flow: build studio payload → `POST /dca/trigger` → poll `GET /dca/dataset` → unified scraper adapter → normalization → matching.

Set `BRIGHT_DATA_API_TOKEN` in `.env`, or leave it empty to auto-load from the Bright Data CLI credentials file:

- Windows: `%APPDATA%\brightdata-cli\credentials.json`
- Linux/macOS: `~/.config/brightdata-cli/credentials.json`

Override the path with `BRIGHTDATA_CLI_CREDENTIALS_PATH` if needed. Probe collectors with `npm run probe:brightdata`.

---

## Bright Data collector input

Both collectors receive the same studio payload shape:

```json
{
  "site": "redbus",
  "url": "https://www.redbus.in/bus-tickets/...",
  "from": "Chennai",
  "from_city": "Chennai",
  "to": "Bengaluru",
  "to_city": "Bengaluru",
  "date": "2026-08-25",
  "time": "18:00",
  "limit": 10,
  "enrich": "true"
}
```

RedBus includes `enrich: "true"`. AbhiBus omits it. The search API accepts optional `depart_after` / `time` (HH:MM) and `limit`.

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
- Bright Data CLI self-healing on source failure
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

SOLID-oriented services keep orchestration independent of provider specifics. Sources implement `BusSourceClient` + `UnifiedScraperAdapter` and register in the composition root (`src/app/app.ts`).

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
Search request
  → Build studio payload (site, url, from, to, date, time, limit)
  → Bright Data POST /dca/trigger
  → Poll GET /dca/dataset until ready
  → UnifiedScraperAdapter → NormalizedBusListing[]
```

| Source | Collector env | Notes |
|--------|---------------|--------|
| RedBus | `REDBUS_COLLECTOR_ID` | City IDs from registry; sends `enrich: true` |
| AbhiBus | `ABHIBUS_COLLECTOR_ID` | ID-based `/bus_search/...` URLs when date known |

Configured sources are seeded into Redis (`routex:sources:config`). Both use a longer `timeout_ms` (~5 minutes) to cover polling.

---

## Normalization & matching

Adapters map provider fields into the shared normalized model (unknown scalars → `null`, arrays → `[]`).

Cross-site comparison then:

1. Enrich operator names, bus-type tags (`AC`, `SLEEPER`, …), times, prices  
2. Remove exact duplicates  
3. Score similarity **0–100**:

```text
operator×0.35 + bus_type×0.25 + departure×0.20 + arrival×0.10 + duration×0.10
```

4. **≥ 80** → merge into one comparable bus group  
5. **65–79** → link as `similar_alternatives`  
6. Compute cheapest provider, savings ₹ / %, and **deal score**  
7. Sort by deal score → price → duration → departure  

Each result includes multi-source `offers[]` so users see the same (or similar) bus across RedBus and AbhiBus with price differences.

---

## Failure handling & self-healing

Failures are classified (`TIMEOUT`, `RATE_LIMITED`, `NETWORK_ERROR`, …). Retryable errors use exponential backoff with jitter. Circuit breakers skip unhealthy sources.

On any source failure (timeout, invalid response, server error, network, etc.), self-healing runs once per source (Redis lock), then the source is retried once.

Heal backend: **Bright Data CLI**

```bash
bdata scraper heal <collector_id> "<what to fix>" \
  --url "<search page url>" \
  --auto-approve --auto-save \
  --timeout 1800 \
  --pretty -o output/<source>-heal.json
```

Configure via `BRIGHTDATA_CLI_BIN`, `SELF_HEALING_CLI_TIMEOUT_SEC`, and `SELF_HEALING_OUTPUT_DIR`.

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
| `DEFAULT_SOURCE_RETRY_COUNT` | Retries after first attempt |
| `BRIGHT_DATA_API_TOKEN` | Bright Data Bearer token (**required** for live searches) |
| `BRIGHT_DATA_BASE_URL` | Default `https://api.brightdata.com` |
| `REDBUS_COLLECTOR_ID` | RedBus Scraper Studio collector |
| `ABHIBUS_COLLECTOR_ID` | AbhiBus Scraper Studio collector |
| `BRIGHT_DATA_POLL_INTERVAL_MS` | Poll interval (default `5000`) |
| `BRIGHT_DATA_MAX_POLL_ATTEMPTS` | Max polls (default `60` ≈ 5 min) |
| `BRIGHT_DATA_SOURCE_TIMEOUT_MS` | Outer source timeout (default `300000`) |
| `SCRAPER_DEFAULT_LIMIT` | Default RedBus collector `limit` (default `10`) |
| `ABHIBUS_RESULT_LIMIT` | Default AbhiBus collector `limit` (default `10`) |
| `BRIGHTDATA_CLI_BIN` | Bright Data CLI binary (default `bdata`) |
| `SELF_HEALING_CLI_TIMEOUT_SEC` | CLI heal timeout (default `1800`) |
| `SELF_HEALING_OUTPUT_DIR` | Heal output directory (default `output`) |

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
  "travel_date": "2026-08-25",
  "depart_after": "18:00",
  "limit": 5
}
```

Optional fields: `time` (alias for `depart_after`), `limit` (max listings per source).

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
    { "source": "abhibus", "status": "TIMEOUT", "failure_kind": "TIMEOUT", "duration_ms": 10000 }
  ],
  "results": [
    {
      "canonical_bus_id": "...",
      "operator_name": "VRL Travels",
      "offers": [
        { "source": "redbus", "price_inr": 990 },
        { "source": "abhibus", "price_inr": 950 }
      ]
    }
  ]
}
```

---

## Scripts

| Command | Description |
|---------|-------------|
| `npm run probe:brightdata` | Trigger redbus + abhibus collectors and save raw JSON to `tmp/` |
| `npm run test:healing -- redbus` | Smoke-test Bright Data CLI heal for a source |
