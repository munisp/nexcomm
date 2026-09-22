# NEXCOM Performance Engineering — Master Document

**Latency budgets (industry standard):**

| Surface | Budget |
|---|---|
| tRPC reads (server-side) | p95 < 100ms; cache hits < 15ms |
| tRPC writes | p95 < 300ms |
| Go/Rust internal RPC | p95 < 50ms |
| Python inference (ML/KYC) | p95 < 250ms |
| Payment webhooks | ack < 200ms (async settle) |
| Hot SQL queries | < 10ms (indexed) |
| Web (Fast-3G, Moto G4) | LCP < 2.5s, FCP < 1.8s, TBT < 200ms, CLS < 0.1 |

**How to measure:**
- Every response carries `X-Response-Time` (perfMiddleware).
- `GET /api/perf/snapshot` — per-route p50/p95/p99 (60s window), cache stats, DB pool stats, event-loop lag. Gated by `X-Perf-Token` (`PERF_METRICS_TOKEN`) or loopback.
- `node scripts/bench-api.mjs` — zero-dep benchmark with budget PASS/FAIL exit code.
- `psql -f scripts/check-indexes.sql` — missing/unused indexes, MV freshness.
- `node scripts/perf-compose-audit.mjs` — compose hardening audit.
- `scripts/lighthouse-budget.json` — Lighthouse CI Web Vitals budgets.

**Area documents:**
- `docs/perf-server.md` — API caching (SWR + single-flight + LRU fallback), compression, N+1 fixes, circuit breakers.
- `docs/perf-db.md` — 28 hot-path indexes, materialized views, EXPLAIN recipes, pg_stat_statements.
- `docs/perf-infra.md` — Go/Rust/Python service tuning, compose resources/healthchecks/logging, capacity math.
- `docs/perf-client.md` — React Query tuning, memoization, windowed lists, SW v5 caching, idle prefetch.
