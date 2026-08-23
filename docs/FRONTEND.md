# RouteX API — Frontend Integration Guide

Handoff doc for the frontend team. For backend architecture details, see [BACKEND.md](./BACKEND.md).

---

## Base URL

| Environment | URL |
|-------------|-----|
| **Production** | `https://routex-api.fsgarage.in` |
| Local dev | `http://localhost:3000` |

All API paths below are relative to the base URL.

**Frontend app:** [https://routex.fsgarage.in](https://routex.fsgarage.in) — must be listed in the API’s `CORS_ORIGINS` env var.

**Active providers:** `redbus`, `makemytrip`, `cleartrip` (3 sources, merged into one list).

---

## Endpoints at a glance

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/health` | Liveness check |
| `POST` | `/api/v1/buses/search` | Start search → get `search_id` + first results |
| `GET` | `/api/v1/searches/:searchId/status` | **Poll** provider progress |
| `GET` | `/api/v1/searches/:searchId/buses` | Get/update results (pagination, sort, filter) |
| `GET` | `/api/v1/searches/:searchId/events` | **SSE** live updates (alternative to polling) |
| `GET` | `/api/v1/analytics/providers` | Provider health/stats (optional, admin/debug) |

---

## How search works (read this first)

RouteX uses **progressive search**:

1. You `POST /buses/search`.
2. The API returns **as soon as the fastest provider finishes** (usually ClearTrip or MakeMyTrip in ~5–30s).
3. Other providers keep loading in the background (RedBus can take ~2–3 min).
4. While loading, `updating_more_results: true`.
5. You **poll `/status`** and **re-fetch `/buses`** until `updating_more_results` is `false`.
6. Each time a new provider finishes, results are **re-merged** — same bus on multiple sites becomes one card with price comparison.

```text
POST /search  ──►  show first results immediately
       │
       ├── poll GET /status every 2–3s  (progress bar)
       └── poll GET /buses every 2–3s   (refresh list)
              │
              └── when updating_more_results === false → done
```

---

## 1. Start a search

```http
POST /api/v1/buses/search
Content-Type: application/json

{
  "from_city": "Delhi",
  "to_city": "Jaipur",
  "travel_date": "2026-08-25",
  "depart_after": "18:00",
  "limit": 20
}
```

| Field | Required | Notes |
|-------|----------|-------|
| `from_city` | yes | City name, e.g. `"Delhi"`, `"Chennai"` |
| `to_city` | yes | Must differ from `from_city` |
| `travel_date` | yes | `YYYY-MM-DD`, cannot be in the past |
| `depart_after` | no | `HH:MM` — only buses departing at or after this time |
| `time` | no | Alias for `depart_after` |
| `limit` | no | Max buses per page (1–50, default 20) |

**Optional query param:** `?wait=all` — blocks until **all** providers finish (slower; use only if you don't want progressive UI).

### Response (200)

```json
{
  "success": true,
  "status": "PARTIAL_SUCCESS",
  "request_id": "uuid",
  "search_id": "664cddff-8842-4ad8-9ccc-db9c6d10337e",
  "cache": { "hit": false, "stale": false },
  "sources": [
    { "source": "cleartrip", "status": "SUCCESS", "duration_ms": 5200, "cache_status": "miss" },
    { "source": "makemytrip", "status": "SUCCESS", "duration_ms": 24000, "cache_status": "miss" },
    { "source": "redbus", "status": "TIMEOUT", "duration_ms": 300000, "cache_status": "miss" }
  ],
  "results": [ "..." ],
  "total_buses": 14,
  "pagination": {
    "limit": 20,
    "total_items": 14,
    "has_more": false,
    "next_cursor": null
  },
  "updating_more_results": true
}
```

**Save `search_id`** — you need it for status, buses, and events.

| Field | What to do |
|-------|------------|
| `updating_more_results` | If `true`, start polling (see below) |
| `results` | Render bus cards immediately (may be empty on cold start — keep polling) |
| `cache.hit` | `true` = overall search session reused from Redis (instant). Separate from per-provider `sources[].cache_status`. |
| `cache.stale` | `true` = session is past fresh TTL; background refresh may run |
| `sources[].cache_status` | How **this response** got that provider’s data: `miss` = live scrape, `fresh`/`stale` = served from cache, `skipped` = cooldown |
| `sources[].duration_ms` | Live scrape time on `miss`; `0` when this response was served from overall session cache |
| `status` | `SUCCESS` / `PARTIAL_SUCCESS` / `SEARCH_FAILED` |

**Cold-start timing:** POST returns in under ~5s (often &lt;1s) with `search_id` + `updating_more_results`. Scrapes continue in background — that avoids reverse-proxy **502 gateway timeouts**. Always poll `/status` + `/buses` while `updating_more_results === true`. The API never intentionally returns HTTP 502 for search.

**Cache labeling tip:** First search on a route often shows `cache_status: "miss"` and a long `duration_ms` (RedBus can take 2–4 min). That means live fetch succeeded and was **written** to cache — not that caching failed. The next search for the same route should show `cache.hit: true` and `sources[].cache_status: "fresh"` (or `"stale"`).

HTTP status is always **200** for a valid search. Check `success` / `status` in the JSON body (`SEARCH_FAILED` when every provider failed).

---

## 2. Poll for progress

```http
GET /api/v1/searches/{search_id}/status
```

### Response

```json
{
  "search_id": "664cddff-8842-4ad8-9ccc-db9c6d10337e",
  "status": "PARTIAL_SUCCESS",
  "progress_percent": 67,
  "completed": 2,
  "processing": 1,
  "failed": 0,
  "skipped": 0,
  "total_providers": 3,
  "total_buses": 14,
  "updating_more_results": true,
  "providers": {
    "cleartrip": { "status": "SUCCESS", "cache_status": "miss", "bus_count": 6 },
    "makemytrip": { "status": "SUCCESS", "cache_status": "miss", "bus_count": 8 },
    "redbus": { "status": "processing" }
  }
}
```

### Polling rules

| Setting | Value |
|---------|-------|
| **Interval** | Every **2–3 seconds** |
| **Stop when** | `updating_more_results === false` |
| **Use for** | Progress bar, provider badges (“RedBus loading…”) |

Provider `status` values: `SUCCESS`, `processing`, `FAILED`, `TIMEOUT`, `SKIPPED`, `CIRCUIT_OPEN`.

---

## 3. Refresh results while polling

On each poll tick (or when status changes), re-fetch buses:

```http
GET /api/v1/searches/{search_id}/buses
```

Same response shape as `POST /buses/search` (results grow as providers complete).

### Sort & filter (query params)

```http
GET /api/v1/searches/{search_id}/buses?sort=cheapest&min_platforms=2&limit=20
```

| Param | Values | Default |
|-------|--------|---------|
| `sort` | `best_value`, `cheapest`, `fastest`, `earliest`, `latest` | `best_value` |
| `limit` | 1–50 | `20` |
| `cursor` | from previous `pagination.next_cursor` | — |
| `min_price` / `max_price` | number | — |
| `depart_after` / `depart_before` | `HH:MM` | — |
| `bus_type` | comma-separated: `AC,SLEEPER,VOLVO` | — |
| `min_platforms` | e.g. `2` = only buses on 2+ sites | — |
| `operator` | substring match | — |

Filters apply **before** pagination. `total_buses` = filtered count.

---

## 4. Complete polling example (copy-paste)

```javascript
const API = 'https://routex-api.fsgarage.in';

async function searchBuses({ from_city, to_city, travel_date, depart_after }) {
  const res = await fetch(`${API}/api/v1/buses/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ from_city, to_city, travel_date, depart_after, limit: 20 }),
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.error?.message ?? 'Search failed');

  const { search_id } = data;
  renderResults(data.results);
  updateProgress(data);

  if (!data.updating_more_results) return data;

  return new Promise((resolve) => {
    const interval = setInterval(async () => {
      const [status, buses] = await Promise.all([
        fetch(`${API}/api/v1/searches/${search_id}/status`).then((r) => r.json()),
        fetch(`${API}/api/v1/searches/${search_id}/buses`).then((r) => r.json()),
      ]);

      updateProgress(status);       // progress bar + provider states
      renderResults(buses.results);   // refresh list

      if (!status.updating_more_results) {
        clearInterval(interval);
        resolve(buses);
      }
    }, 2500);
  });
}
```

---

## 5. Alternative: Server-Sent Events (SSE)

Instead of polling `/status`, open an event stream:

```javascript
const es = new EventSource(`${API}/api/v1/searches/${searchId}/events`);

es.addEventListener('connected', (e) => {
  const status = JSON.parse(e.data);
  updateProgress(status);
});

es.addEventListener('provider_completed', (e) => {
  const { provider, bus_count, total_buses } = JSON.parse(e.data);
  // Re-fetch /buses to get merged results
  refreshBuses(searchId);
});

es.addEventListener('session_updated', () => refreshBuses(searchId));

es.addEventListener('search_finished', (e) => {
  refreshBuses(searchId);
  es.close();
});
```

| Event | When |
|-------|------|
| `connected` | On connect — full status snapshot |
| `provider_completed` | One provider finished |
| `session_updated` | Results re-merged |
| `search_finished` | All done — close stream |

If search is already complete on connect, you get `connected` then `search_finished` immediately.

---

## 6. Bus card — fields to render

Each item in `results[]` is a **CanonicalBus** (one physical bus, possibly multiple booking sites).

| Field | Type | UI use |
|-------|------|--------|
| `canonical_bus_id` | string | React `key` |
| `operator_name` | string | Title |
| `departure_time` / `arrival_time` | `HH:MM` | Schedule |
| `duration_minutes` | number | “8h 30m” |
| `bus_type_normalized` | string[] | Tags: AC, SLEEPER, VOLVO |
| `cheapest_price_inr` | number | Main price |
| `cheapest_provider` | string | “Best on cleartrip” |
| `platform_count` | number | “On 2 platforms” |
| `save_up_to_inr` | number | “Save up to ₹64” |
| `best_deal_label` | `"Best Deal"` \| `"Cheapest"` \| null | Badge |
| `deal_reasons` | string[] | Tooltip bullets |
| `deal_score` | number | Default sort (higher = better value) |
| `match_tier` | `"same"` \| `"unique"` | `"same"` = matched across sites |
| `offers` | array | Per-platform prices + book links |

### `offers[]` — book buttons

```json
{
  "source": "cleartrip",
  "price_inr": 285,
  "difference_from_cheapest": 0,
  "difference_percentage": 0,
  "listing_url": "https://..."
}
```

Use `listing_url` as the **Book on {source}** link. Show `difference_from_cheapest` when > 0 (e.g. “+₹64 vs cheapest”).

### Cross-platform savings example

Same bus on ClearTrip ₹285 and MakeMyTrip ₹349:

```json
{
  "operator_name": "Maharani Travels",
  "platform_count": 2,
  "cheapest_price_inr": 285,
  "cheapest_provider": "cleartrip",
  "save_up_to_inr": 64,
  "best_deal_label": "Cheapest",
  "deal_reasons": ["₹64 cheaper than other platforms", "Available on 2 platforms"]
}
```

---

## 7. Pagination

```http
GET /api/v1/searches/{search_id}/buses?cursor=eyJvZmZzZXQiOjIwfQ&limit=20
```

Use `pagination.next_cursor` from the previous response when `has_more: true`.

---

## 8. Errors

All errors:

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "travel_date cannot be in the past"
  },
  "request_id": "uuid"
}
```

| HTTP | Code | Meaning |
|------|------|---------|
| 400 | `VALIDATION_ERROR` | Bad request body |
| 404 | `NOT_FOUND` | Invalid `search_id` |
| 429 | `RATE_LIMIT_EXCEEDED` | Too many requests — back off |
| 500 | `INTERNAL_ERROR` | Server error |

Use JSON `status: "SEARCH_FAILED"` / `success: false` when every provider failed (still HTTP 200).

Optional header: `x-request-id` for debugging (server generates one if omitted).

---

## 9. Recommended UI flow

```text
┌─────────────────────────────────────────────────────────┐
│  Search form: from, to, date, optional depart_after     │
└───────────────────────────┬─────────────────────────────┘
                            │ POST /buses/search
                            ▼
┌─────────────────────────────────────────────────────────┐
│  Show results immediately (may be partial)              │
│  Progress: "Loading RedBus… 67%"  (from /status)        │
│  Badge: "Updating prices from more sites"               │
└───────────────────────────┬─────────────────────────────┘
                            │ poll every 2.5s
                            ▼
┌─────────────────────────────────────────────────────────┐
│  List grows + cross-platform matches appear             │
│  Show save_up_to_inr / platform_count badges              │
│  Book buttons from offers[].listing_url                 │
└───────────────────────────┬─────────────────────────────┘
                            │ updating_more_results = false
                            ▼
┌─────────────────────────────────────────────────────────┐
│  Hide progress bar                                      │
│  Enable sort/filter toolbar → GET /buses?sort=...       │
└─────────────────────────────────────────────────────────┘
```

---

## 10. Quick curl tests

```bash
# Health
curl https://routex-api.fsgarage.in/health

# Search
curl -X POST https://routex-api.fsgarage.in/api/v1/buses/search \
  -H "Content-Type: application/json" \
  -d '{"from_city":"Delhi","to_city":"Jaipur","travel_date":"2026-08-25"}'

# Status (replace SEARCH_ID)
curl https://routex-api.fsgarage.in/api/v1/searches/SEARCH_ID/status

# Buses with sort
curl "https://routex-api.fsgarage.in/api/v1/searches/SEARCH_ID/buses?sort=cheapest&min_platforms=2"
```

---

## Checklist for frontend

- [ ] Store `search_id` from POST response
- [ ] Render `results` immediately — don't wait for all providers
- [ ] Poll `/status` every 2–3s while `updating_more_results === true`
- [ ] Re-fetch `/buses` on each poll tick to refresh the list
- [ ] Show provider-level loading from `status.providers`
- [ ] Use `offers[].listing_url` for book CTAs
- [ ] Show `save_up_to_inr` + `platform_count` when `platform_count >= 2`
- [ ] Sort/filter via GET `/buses` query params (not client-side on full dataset)
- [ ] Handle 429 with backoff; treat `status: SEARCH_FAILED` in the JSON body as a full failure
