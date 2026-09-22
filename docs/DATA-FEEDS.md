# DATA-FEEDS — Pluggable External Data-Feed Framework

External market-information feeds for the NEXCOM exchange: agro-weather,
external reference prices (AFEX etc.), and official statistics (NBS).
Provider-pattern design — a new feed is a drop-in adapter.

```
┌────────────┐   fetch()   ┌──────────────────────────────┐
│  Adapter   │ ──────────► │ Registry (server/services/   │
│ (weather,  │             │ feeds/registry.ts)           │
│  prices,   │             │  • zod-validate payload      │
│  stats…)   │             │  • persist → market_feed_    │
└────────────┘             │    snapshots (durable LKG)   │
                           │  • cacheSet fresh (TTL)      │
                           │  • cacheSet lastKnownGood    │
                           │    (1y TTL + in-mem mirror)  │
                           └───────┬──────────────────────┘
                                   │ getSnapshot: fresh → LKG → DB
                          ┌────────▼─────────┐     ┌────────────────┐
                          │ feedsRouter tRPC │ ──► │ /market-weather│
                          │ (public, SWR-    │     │ page + SWR/off │
                          │  cacheable)      │     │ line read cache│
                          └──────────────────┘     └────────────────┘
```

## Feeds shipped

| Feed         | Kind             | Upstream                                        | Default |
| ------------ | ---------------- | ----------------------------------------------- | ------- |
| `openmeteo`  | `weather`        | api.open-meteo.com (free, keyless)              | ON      |
| `afex`       | `reference_price`| AFEX-compatible JSON endpoint (env-configured)  | OFF     |
| `nbs`        | `statistics`     | NBS CSV/JSON download (env-configured)          | OFF     |
| `manual_csv` | `reference_price`| Operator-uploaded CSV at a mounted path         | OFF     |

Weather covers Kano, Kaduna, Makurdi (Benue), Ibadan (Oyo), Jos (Plateau),
Calabar (Cross River) — current conditions + 7-day daily forecast, normalized
to `{ location, lat, lon, current:{tempC,humidity,precipMm,windKph}, daily:[…] }`.
Set `FEEDS_WEATHER_RAINFALL_HISTORY=true` to append 30-day rainfall history
from the Open-Meteo archive API.

## Adding a feed in 4 steps

1. **Write the adapter** in `server/services/feeds/adapters/myFeed.ts`
   implementing `FeedAdapter` (`name`, `kind`, `ttlSeconds`, `intervalSeconds`,
   `isEnabled()`, `fetch()`). Use `httpGetJson`/`httpGetText` from
   `../http` (10s timeout + 1 retry are built in). Validate payloads with zod
   and return normalized `FeedSnapshot[]`; return `[]` only for soft-empty.
2. **Register it**: add to `ADAPTER_CATALOG` in `server/services/feeds/registry.ts`.
3. **Enable it**: add the name to `FEEDS_ENABLED` (comma list).
4. **Surface it**: reference-price feeds merge automatically in
   `feeds.getReferencePrices` when added to `REFERENCE_PRICE_FEEDS` in
   `server/routers/feedsRouter.ts`; other kinds can reuse
   `getSnapshot`/`getAllSnapshots` in a new procedure.

No other wiring needed — scheduling, backoff, circuit breaking, persistence,
stale serving and health reporting come from the registry.

## Environment reference

| Variable | Default | Purpose |
| --- | --- | --- |
| `FEEDS_ENABLED` | `openmeteo` | Comma list of enabled feeds (`*` = all catalog) |
| `FEEDS_WEATHER_LOCATIONS` | 6 built-in zones | JSON array of `{key,name,state,lat,lon}` |
| `FEEDS_WEATHER_RAINFALL_HISTORY` | `false` | Include 30-day rainfall history |
| `AFEX_FEED_URL` | — | AFEX-compatible JSON endpoint |
| `AFEX_ROOT_PATH` | `$` | JSONPath-lite to the record array |
| `AFEX_FIELD_MAP` | — | JSON `{symbol,price,date,currency?,unit?}` → JSONPath-lite |
| `AFEX_API_KEY` | — | Optional bearer token |
| `NBS_FEED_URL` | — | NBS CSV/JSON endpoint |
| `NBS_FEED_FORMAT` | auto | `csv` \| `json` |
| `NBS_ROOT_PATH` | `$` | JSONPath-lite to records (JSON only) |
| `NBS_FIELD_MAP` | — | JSON `{series,value,date,unit?}` → JSONPath-lite / CSV columns |
| `FEEDS_MANUAL_CSV_PATH` | — | Mounted operator CSV (`symbol,price,unit,currency,asOf,region`) |

All feed env vars are optional — unconfigured feeds are skipped gracefully
(`getFeedHealth` reports `enabled: false`), never a startup failure.

## Failure modes

- **Stale serving (offline-first).** Every successful fetch writes three
  places: Postgres (`market_feed_snapshots`), a fresh Redis key (adapter TTL),
  and a last-known-good Redis key (1-year TTL) plus an in-process mirror.
  `getSnapshot` serves fresh → LKG → DB, marking stale serves with
  `{ stale: true, servedAt, source }`. The UI badges stale data; the SWR
  service worker adds a final client-side layer (24h cap, per sw.js policy).
- **Backoff.** On failure the poll interval grows `base × 2^failures` with
  ±20% jitter, capped at 15 minutes.
- **Circuit breaker.** After 5 consecutive failures the circuit opens for
  5 minutes (no upstream calls), then a single half-open probe closes it on
  success or re-opens on failure.
- **No scheduler crashes.** Ticks catch everything; failures are recorded in
  `feeds.getFeedHealth` (admin-only).
- **DB outage.** Persists fail non-fatally; Redis/in-memory LKG keeps serving.

## HTTP policy

All outbound feed traffic goes through `server/services/feeds/http.ts`:
axios, 10s timeout, exactly 1 retry on network/5xx errors, identifying
`User-Agent: nexcom-feeds/1.0`.

## Production recommendations

- **Reference prices:** license the AFEX commercial data API (or exchange
  bilateral feeds like LCFE/NCX) and set `AFEX_FEED_URL` + `AFEX_FIELD_MAP`.
  Until then, use the `manual_csv` operator feed with a daily uploaded CSV —
  ops owns freshness, the platform shows source/asOf/stale honestly.
- **Weather:** Open-Meteo is free/CC-BY-4.0 and adequate for launch; for
  operational agriculture advisories contract **NiMet** (Nigerian
  Meteorological Agency) or a commercial ag-weather provider and add an
  adapter — the registry handles the rest.
- **Statistics:** point `NBS_FEED_URL` at NBS CPI/price-watch releases
  (republished as stable CSV/JSON by your data team; NBS does not offer a
  stable public API).
- Keep `FEEDS_ENABLED` minimal in production; each enabled feed is one
  outbound dependency the platform must tolerate losing.

## Lakehouse landing notes

Feeds currently land portal-side (`market_feed_snapshots` + Redis). To also
land them in the analytical lakehouse, follow the `server/lakehouse.ts`
pattern: a typed helper POSTs `{ records, ingested_at }` to the Python
ingestion engine at `POST {INGESTION_ENGINE_URL}/api/v1/ingest/{table}`.
Add e.g. `ingestMarketFeedSnapshot()` in `server/lakehouse.ts` targeting a
`nexcom_market_feed_snapshots` table and call it from the registry's
`persistSnapshots()` — the ingestion engine handles idempotent lakehouse
writes, so feed history becomes available to analytics without changing the
serving path. (Left out of the default path deliberately: serving must never
depend on the analytics pipeline.)

## Verification

`node scripts/smoke-feeds.mjs` — live Open-Meteo check (10s timeout, SKIP when
offline) plus PASS/FAIL/SKIP for each configured optional feed.
