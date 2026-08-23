# RouteX API

Multi-source bus search and comparison backend — **RedBus**, **MakeMyTrip**, and **ClearTrip** via Bright Data, with cross-platform matching, progressive results, Redis caching, and cursor pagination.

**Stack:** Node.js 20 · TypeScript · Fastify · Redis · Docker

---

## Features

- Progressive multi-provider search with status polling and SSE
- Per-provider Redis cache (fresh / stale-while-revalidate)
- Cross-site bus matching with price comparison and deal scoring
- Cursor pagination, sort, and filters
- Circuit breaker, retries, and partial success
- IP rate limiting with request correlation IDs

---

## API endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Liveness |
| `GET` | `/health/redis` | Redis connectivity |
| `POST` | `/api/v1/buses/search` | Start search (returns first page) |
| `GET` | `/api/v1/searches/:id/buses` | Paginated results + filters |
| `GET` | `/api/v1/searches/:id/status` | Provider progress |
| `GET` | `/api/v1/searches/:id/events` | SSE live updates |
| `GET` | `/api/v1/analytics/providers` | Provider metrics |

Full reference: **[docs/BACKEND.md](docs/BACKEND.md)**

---

## Local development

```bash
npm install
cp .env.example .env
# Set REDIS_URL and BRIGHT_DATA_API_TOKEN

npm run dev      # http://localhost:3000
npm run build    # compile TypeScript
npm start        # run compiled output
```

---

## Production (Docker / EasyPanel)

```bash
docker build -t routex-api .
docker run --rm -p 3000:3000 --env-file .env \
  -e NODE_ENV=production -e TRUST_PROXY=true routex-api
```

**EasyPanel:** connect repo, use Dockerfile, expose port `3000`, set env vars from `.env.example`.

Detailed guide: **[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)**

---

## Example search

```http
POST /api/v1/buses/search
Content-Type: application/json

{
  "from_city": "Delhi",
  "to_city": "Jaipur",
  "travel_date": "2026-08-25"
}
```

```http
GET /api/v1/searches/{search_id}/status
GET /api/v1/searches/{search_id}/buses?sort=cheapest&limit=20
```

---

## Environment variables

See [`.env.example`](.env.example) for the full list. Required for production:

- `REDIS_URL`
- `BRIGHT_DATA_API_TOKEN`
- `REDBUS_COLLECTOR_ID`, `MAKEMYTRIP_COLLECTOR_ID`, `CLEARTrip_COLLECTOR_ID`

---

## License

MIT
