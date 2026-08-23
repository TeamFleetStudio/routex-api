# Deploying RouteX API on EasyPanel

This guide covers production deployment using the included **Dockerfile**.

## Prerequisites

- [EasyPanel](https://easypanel.io/) server with Docker
- **Redis** instance (external — RouteX has no built-in database)
- **Bright Data** API token + collector IDs

## Quick setup (EasyPanel)

1. **Create a new service** → **App** → connect your GitHub repo `TeamFleetStudio/routex-api`
2. **Build method:** Dockerfile (path: `Dockerfile` at repo root)
3. **Port:** `3000` (container port)
4. **Domain:** attach your domain; EasyPanel handles TLS reverse proxy
5. **Environment variables** — copy from `.env.example` and set at minimum:

| Variable | Required | Example |
|----------|----------|---------|
| `NODE_ENV` | yes | `production` |
| `PORT` | yes | `3000` |
| `REDIS_URL` | yes | `redis://default:password@host:6379` |
| `BRIGHT_DATA_API_TOKEN` | yes | your token |
| `TRUST_PROXY` | yes (behind EasyPanel) | `true` |
| `CORS_ORIGINS` | yes (browser frontend) | `https://routex.fsgarage.in,http://localhost:5173` |
| `REDBUS_COLLECTOR_ID` | yes | `c_mt5kcpdj13nspwzrzd` |
| `MAKEMYTRIP_COLLECTOR_ID` | yes | `c_mt5m1h3uvef2inukz` |
| `CLEARTrip_COLLECTOR_ID` | yes | `c_mt5mys6i27rezbm6py` |
| `LOG_LEVEL` | no | `info` |
| `RATE_LIMIT_MAX` | no | `100` |
| `PROVIDER_CACHE_FRESH_MS` | no | `600000` |
| `PROVIDER_CACHE_STALE_MS` | no | `900000` |

6. **Deploy** — EasyPanel builds the image (`npm ci` → `tsc` → production start)
7. **Health check** — EasyPanel can use `GET /health` on port 3000

## Verify deployment

```bash
curl https://your-domain.com/health
# {"status":"UP"}

curl https://your-domain.com/health/redis
# {"status":"UP","redis":"CONNECTED"}

curl -X POST https://your-domain.com/api/v1/buses/search \
  -H "Content-Type: application/json" \
  -d '{"from_city":"Delhi","to_city":"Jaipur","travel_date":"2026-08-25"}'
```

## Docker (local / manual)

```bash
# Build
docker build -t routex-api .

# Run (requires .env with REDIS_URL + BRIGHT_DATA_API_TOKEN)
docker run --rm -p 3000:3000 --env-file .env -e NODE_ENV=production -e TRUST_PROXY=true routex-api

# Or docker compose
docker compose up --build
```

## Architecture notes

- **Single container** — API only; Redis must be reachable via `REDIS_URL`
- **No PostgreSQL** — all state in Redis (cache, sessions, rate limits)
- **Self-healing** uses the Bright Data REST API (`refactor_template` + auto-approve via `resume_automation_job`); requires `BRIGHT_DATA_API_TOKEN` and `SELF_HEALING_CLI_TIMEOUT_SEC` (poll timeout). The local `bdata` CLI heal remains available for dev only.
- **First search** on a route may take 1–10 minutes (Bright Data scrapers); repeat searches hit Redis cache (~1s)
- **Progressive search** — POST returns after first provider; poll `GET /searches/:id/status`

## Scaling

| Knob | Recommendation |
|------|----------------|
| Replicas | 2+ behind EasyPanel load balancer (shared Redis required) |
| Redis | Dedicated instance; do not run Redis in the same container |
| `RATE_LIMIT_MAX` | Increase if many users share one IP (set `TRUST_PROXY=true`) |
| `BRIGHT_DATA_SOURCE_TIMEOUT_MS` | `300000`–`720000` for slow scrapes |
| `PROVIDER_CACHE_*` | Increase TTL to reduce Bright Data costs |

## API documentation

See [BACKEND.md](./BACKEND.md) for full endpoint reference, data models, and frontend integration.

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| Container exits on start | Check `REDIS_URL` connectivity from container network |
| `502` gateway (HTML) | Proxy timeout — ensure `POST_FIRST_RESULT_WAIT_MS` ≤ 8000 and redeploy |
| `SEARCH_FAILED` in JSON | Verify `BRIGHT_DATA_API_TOKEN` and collector IDs |
| `429` errors | Lower traffic or raise `RATE_LIMIT_MAX` |
| Stale results | Normal — SWR returns cached data; background refresh runs |
| Health check fails | Wait 15s start period; ensure port 3000 exposed |
