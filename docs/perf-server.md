# PERF-SERVER — Portal API Latency Budgets & Implementation Notes

## Budgets (server-side, measured at the Express edge)

| Class | Budget | How it's verified |
|---|---|---|
| tRPC reads | **p95 < 100 ms** | `X-Response-Time` header, `/api/perf/snapshot` per-route p95 |
| Cached reads | **p95 < 15 ms** | Second request to a `cacheWrap`'d endpoint (`X-Cache: HIT`) |
| Writes / mutations | **p95 < 300 ms** | `/api/perf/snapshot` per-route p95 |
| Slow-request alert | > 500 ms | Log line `[Perf] Slow request: METHOD route → status in Xms` |
| Slow-query alert | > 250 ms | Log line `[Perf] Slow query: <name> took Xms` |

## What changed

### Caching (`server/cache.ts` — extended, API-compatible)
- **`cacheWrap(key, ttlSeconds, fn, opts)`** — read-through cache with:
  - **SWR**: `opts.staleTtl` lets a value be served stale while exactly one background refresh runs.
  - **Single-flight**: an in-process promise map dedupes concurrent loads of the same key (no DB stampede on miss); `opts.useRedisLock` adds a best-effort cross-process `SET NX PX` lock.
  - `opts.onStatus` reports `HIT` / `STALE` / `MISS` (used to set the `X-Cache` response header).
- **In-memory LRU fallback** (500 entries, TTL-aware): `cacheSet` writes through to the LRU; when Redis is down, reads serve from it. Redis failures flip a health flag and are re-probed after **5 s** (the ioredis reconnect loop restores service automatically).
- `cacheDel(keyOrPattern)` — now also purges the LRU and accepts `*` glob patterns (SCAN-based, never `KEYS`).
- `cacheStats()` — `{ hits, misses, staleHits, fallbackHits, errors, hitRate, redisUp, fallbackSize, inFlight }`.
- Existing `cacheGet`/`cacheSet`/`getOrSet`/`cacheSetStrict` signatures and semantics are unchanged; `cacheGet` transparently unwraps SWR envelopes.

### Measurement
- **`server/_core/perfMiddleware.ts`** — Express middleware: high-res timer → `X-Response-Time` (ms, 1 decimal, injected via a `writeHead` hook so it reflects near-final latency); slow-request log; rolling 60 s per-route histogram (buckets 5/10/25/50/100/250/500/1000/2500 ms); `getPerfSnapshot()`; `measureDb(name, fn)` helper used on hot queries.
- **`server/routes/perfMetrics.ts`** — `GET /api/perf/snapshot`: per-route p50/p95/p99 (60 s window), cache stats, DB pool stats, circuit-breaker states, process memory, event-loop lag (`perf_hooks.monitorEventLoopDelay`, p50/p95/p99/max). Protected by `PERF_METRICS_TOKEN` (`X-Perf-Token` header); when unset, loopback-only.

### Database pool (`server/db.ts`)
Env-tunable `postgres` (porsager) pool: `PG_POOL_MAX` (20), `PG_READ_POOL_MAX` (10), `PG_POOL_IDLE_MS` (10 000), `PG_POOL_CONNECT_TIMEOUT_MS` (5 000), plus per-connection `statement_timeout` (15 s, `PG_STATEMENT_TIMEOUT_MS`) and `idle_in_transaction_session_timeout` (30 s, `PG_IDLE_IN_TRANSACTION_TIMEOUT_MS`) sent as startup parameters. Exported API unchanged; `getDbPoolStats()` added for the snapshot.

### Outbound HTTP (`server/_core/httpClient.ts` + `server/gatewayClient.ts`)
Shared axios instance: keep-alive agents (maxSockets 50, keepAliveMsecs 30 s), 8 s default timeout, 1 retry with 200 ms backoff on `ECONNRESET`/`ETIMEDOUT`/5xx (idempotent methods only — POSTs are never retried unless `retryOnPost: true`, protecting ledger transfers from double-posting). `wrapWithBreaker(name, fn, { failureThreshold: 5, resetMs: 30000 })` circuit breaker; the gateway client routes through it and fast-fails with the same `null` contract when the gateway is down.

### Compression
`compression()` is mounted **after** security headers, **before** routes/static, level 6, threshold 1 KB, skipping `/api/stripe/webhook`, `/api/payments/*/webhook`, and the SSE path `/api/sse/*` (plus any `Accept: text/event-stream` request).

### Hot-router caching (with `X-Cache: HIT|STALE|MISS` marker)
| Procedure | Key | TTL | Stale |
|---|---|---|---|
| `livePrices.getAll` | `live_prices:all` | 5 s | 30 s |
| `livePrices.getBySymbol` | `live_prices:symbol:{sym}` | 5 s | 30 s |
| `livePrices.getBySymbols` | `live_prices:symbols:{sorted}` | 5 s | 30 s |
| `livePrices.getByAssetClass` | `live_prices:asset_class:{cls}` | 5 s | 30 s |
| `livePrices.feedStatus` | `live_prices:feed_status` | 10 s | 60 s |
| `commodities.list` | `commodities:list` | 30 s | 300 s |
| `commodities.priceHistory` / `gradeSpread` | `commodities:live_price:{sym}` | 5 s | 30 s |
| `transparency.marketStats` | `transparency:market_stats` | 60 s | 300 s |
| `transparency.settlementStats` | `transparency:settlement_stats` | 60 s | 300 s |
| `transparency.platformHealth` | `transparency:platform_health` | 60 s | 300 s |
| `transparency.priceDiscovery` | `transparency:price_discovery` | 60 s | 300 s |
| `marketData.depth` | `order_book:{sym}` | 2 s | 10 s |
| `marketData.symbols` | `market:symbols` | 15 s | 120 s |
| `marketData.exchangeStatus` | `market:exchange_status` | 5 s | 15 s |
| `marketData.indices` | `indices:list` | 30 s | 120 s |
| `marketData.indexValues` | `indices:values` | 15 s | 60 s |

### Cache invalidation (write path)
- `orders.create` / `orders.cancel` — already deleted `order_book:{sym}` + `portfolio:summary:{uid}` (kept).
- `orders.amend` — now also deletes `order_book:{sym}` + `portfolio:summary:{uid}`.
- `orders.cancelMany` / `orders.amendMany` — now delete `order_book:{sym}` for every affected symbol + portfolio summary.
- `livePrices.triggerRefresh` (admin) — deletes `live_prices:*` + `commodities:live_price:*`.
- `deposits.create` — deletes `portfolio:summary:{uid}`.
- `deposits.updateStatus` (confirm) — deletes `portfolio:summary:{ownerUid}`, `transparency:*`, `warehouse:list`.

### N+1 eliminations
1. **`priceAlerts` polling job** — was one `SELECT` per active alert every 30 s; now a single `inArray(livePrices.symbol, symbols)` batch into a `Map` (`getCurrentPrices`).
2. **`priceAlerts.nearTriggerCount`** — same per-alert loop removed; one batch query per request.
3. **`orders.cancelMany` / `orders.amendMany`** — was `SELECT * FROM orders WHERE user_id = ?` (entire account history) filtered in memory per call; now `inArray(orders.id, input.ids)` fetches only the ≤100 targeted rows.

## How to measure

### curl timing
```bash
# Uncached vs cached read (watch X-Response-Time and X-Cache)
curl -s -o /dev/null -w 'total=%{time_total}s\n' -D - \
  -H 'Content-Type: application/json' \
  'http://localhost:3000/api/trpc/livePrices.getAll?batch=1&input=%7B%7D'
# Second call → expect X-Cache: HIT and X-Response-Time < 15.0ms
```

### Perf snapshot
```bash
PERF_METRICS_TOKEN=dev-token curl -s -H 'X-Perf-Token: dev-token' \
  http://localhost:3000/api/perf/snapshot | jq '.perf.routes[:10], .cache, .process.eventLoopLag'
```
Fields: `perf.routes[]` = `{route, count, errors, p50, p95, p99, min, max, buckets}` (60 s window); `perf.dbQueries[]` = per-`measureDb` avg/p95/max/slowCount; `cache` = hit rate, `redisUp`, `fallbackSize`; `db` = pool config; `process.eventLoopLag` = p50/p95/p99/max ms; `circuitBreakers` = state per breaker.

### Load test (no new deps)
```bash
# Built-in zero-dep bench (sequential + concurrent, budgets PASS/FAIL)
node scripts/bench-api.mjs BASE_URL=http://localhost:3000 N=200 C=10

# Or autocannon / k6 (external tools — not repo deps)
npx autocannon -c 10 -d 30 'http://localhost:3000/api/trpc/livePrices.getAll?batch=1&input=%7B%7D'
# k6: http.get(url) thresholds { 'http_req_duration': ['p(95)<100'] }
```

## Redis failure behavior
Every Redis call is wrapped in try/catch. On failure the health flag flips, a 5 s re-probe window starts, and reads/writes transparently fall through to the 500-entry TTL-aware LRU. `cacheWrap` SWR/single-flight semantics are unchanged in fallback mode (envelopes are stored in the LRU). Durable coordination paths (`cacheSetStrict`/`cacheSetIfAbsentStrict`) still **fail closed** with `CacheUnavailableError` — caching degrades, financial invariants do not.

## SWR semantics
A cached envelope is **fresh** for `ttlSeconds` (served as `HIT`), then **stale** for `staleTtl` more seconds (served as `STALE`; exactly one background refresh is triggered, single-flight deduped). After that it is a `MISS`: concurrent callers share one loader invocation. Loader failures are never cached; on `STALE` paths they are swallowed (stale data already served), on `MISS` they propagate to the caller.
