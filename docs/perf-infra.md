# NEXCOM Exchange — Performance & Infra Tuning Guide

Scope: latency hardening of the money path (Go/Rust internal RPC p95 < 50 ms,
Python inference p95 < 250 ms) plus production-tight `docker-compose.yml`.
All changes are **additive tuning only** — timeouts, pools, warmup, resource
limits. No behavioral/API changes.

---

## 1. Latency budget table (per language)

| Layer | Target p95 | Budget breakdown |
|---|---|---|
| Go internal RPC/HTTP (core-banking, mojaloop-adapter, middleware-hub, channel-gateway, gateway) | < 50 ms | handler work < 20 ms; DB acquire+query < 15 ms (pool 20–25 conns); outbound upstream call < 8 s client timeout but p95 < 30 ms via keep-alive reuse |
| Rust services (matching-engine, settlement-engine, ussd-engine, credit-scoring) | < 50 ms | in-memory hot path (matching) < 5 ms; DB-backed paths bounded by 5 s acquire timeout, p95 < 20 ms |
| Python inference (kyc-service, ml-platform) | < 250 ms | models pre-warmed at boot (no cold-start penalty); uvicorn workers=2, limit-concurrency=200 |
| Gateway edge (APISIX) | +< 10 ms over upstream | upstream keep-alive 64 conns/host, gzip, 30 s proxy timeouts (300 s SSE exception) |

## 2. What changed per service

### Go
| Service | Changes |
|---|---|
| `services/core-banking` | `http.Server`: ReadHeaderTimeout 5s, ReadTimeout 15s, WriteTimeout 30s, IdleTimeout 60s, MaxHeaderBytes 64 KiB; pprof admin server on `GO_PPROF=1` (`PPROF_ADDR`, default 127.0.0.1:6060); graceful shutdown already present (verified) |
| `services/mojaloop-adapter` | server: +ReadHeaderTimeout, MaxHeaderBytes, IdleTimeout 60s; shared tuned `http.Transport` (MaxIdleConns 100, MaxIdleConnsPerHost 32, IdleConnTimeout 90s, TLSHandshakeTimeout 5s, ExpectContinueTimeout 1s) on FSPIOP callback client and settlement reconciler client; pprof under `GO_PPROF=1`; pgx pool already tuned (MaxConns env-driven, verified) |
| `services/middleware-hub` | server had **no timeouts** — added full set; pprof under `GO_PPROF=1` |
| `services/channel-gateway` | server: +ReadHeaderTimeout 5s, ReadTimeout 15s, WriteTimeout 30s, MaxHeaderBytes; pprof; `internal/db`: pgx pool now ParseConfig-based — `DB_MAX_CONNS` (default 25), MinConns 2, MaxConnLifetime 5m, MaxConnIdleTime 1m, HealthCheckPeriod 30s |
| `gateway-service` (compose service `gateway`) | server: +ReadHeaderTimeout 5s, ReadTimeout 15s, MaxHeaderBytes, IdleTimeout 60s; **WriteTimeout kept at 30 s** (SSE endpoints rely on it); pprof under `GO_PPROF=1` |

### Rust
| Service | Changes |
|---|---|
| `settlement-engine` | new `[profile.release]`: opt-level 3, lto "thin", codegen-units 1, panic "unwind", strip |
| `matching-engine` | profile: kept fat `lto = true` (hot-path inlining), added strip, panic abort → unwind (tokio survives handler panics) |
| `services/ussd-engine` | profile: +panic "unwind", strip; sqlx pool: `DB_MAX_CONNECTIONS` (default 20), min 2, acquire_timeout 5s, idle 60s, lifetime 300s |
| `services/credit-scoring` | new `[profile.release]`; sqlx pool (was plain `PgPool::connect`): same tuned options, still non-fatal on DB outage |

Debug builds are untouched (`[profile.release]` only). `TOKIO_WORKER_THREADS`
is set in compose for matching-engine (8), settlement-engine (4), ussd-engine (4).

### Python
| Service | Changes |
|---|---|
| `services/kyc-service` | `MODEL_WARMUP=1` (default): startup event pre-loads PaddleOCR/Docling/VLM/liveness engines in a background thread; failures log + continue (lazy-load fallback intact); `UVICORN_WORKERS` (default 2) + timeout-keep-alive 30 + limit-concurrency 200 |
| `services/ml-platform` | registry champion/challenger preload at boot **already present** (lifespan thread, verified); `UVICORN_WORKERS` (default 2) + keep-alive/concurrency limits |

Outbound HTTP audit (kyc-service, ml-platform): every `httpx` call site
already carries an explicit timeout (keycloak 10s, permify 5s, screening,
liveness, drift/performance monitors 5s). No `requests` usage. No fixes needed.

## 3. Compose tuning summary

| Area | Change |
|---|---|
| postgres | command: shared_buffers 1GB, effective_cache_size 3GB, work_mem 16MB, maintenance_work_mem 256MB, max_connections 300, wal_compression on, log_min_duration_statement 250, shared_preload_libraries pg_stat_statements |
| redis | + maxmemory 512mb, maxmemory-policy allkeys-lru (appendonly preserved) |
| logging | `x-logging` anchor (json-file, 10m × 3) applied to all 63 services |
| restart | `unless-stopped` on all long-running services (one-shots temporal-setup/permify-init untouched) |
| resources | `deploy.resources` everywhere; heavies: postgres 2G/1G, portal 3G/512M, ml-platform 2G/512M, kyc 1.5G/512M, tigerbeetle 1G/256M; JVM/infra sized (kafka 1536M, keycloak 1G, opensearch 1536M, neo4j 1536M, ray 2G); light services 256M |
| env (new, additive) | portal NODE_OPTIONS=--max-old-space-size=3072; notification/user-management 384 (sized to their 512M limits); kyc UVICORN_WORKERS=2 MODEL_WARMUP=1; ml-platform UVICORN_WORKERS=2; core-banking/middleware-hub GOMEMLIMIT=450MiB GOGC=50; matching/settlement/ussd TOKIO_WORKER_THREADS; channel-gateway CHANNEL_GATEWAY_PORT=8021 (aligns listen port with the existing 8021 mapping — previously the container listened on the code default 8030 while publishing 8021) |
| healthchecks (new) | portal, gateway, keycloak (bash /dev/tcp — ubi-minimal has no curl), zookeeper (tcp), fluvio, ussd-engine, bot-logic — interval 10s/timeout 3s/retries 5 |
| healthcheck-exempt | core-banking, channel-gateway, indices: distroless/scratch images have no probe binary (shell/wget/curl absent) — covered by restart policy + downstream health aggregation |

Nothing removed; ports, networks, volumes, image names unchanged (validated
programmatically against the original file).

## 4. Capacity math

**Postgres connections.** max_connections=300. Worst-case pool demand:
mojaloop-adapter 20 + channel-gateway 25 + ussd-engine 20 + credit-scoring 20 +
permify 10 + keycloak ~15 + temporal ~30 + kyc-service ~10 + misc Go services
(5 × pgx default 4–10) ≈ 200. Headroom ≈ 100 for migrations/admin. If you raise
`DB_MAX_CONNS`/`DB_MAX_CONNECTIONS`, keep total under 280.

**Python workers.** uvicorn workers=2 × limit-concurrency=200 → 400 in-flight
requests max per Python service; inference p95 250 ms ⇒ ~1600 req/s ceiling
before queuing. kyc-service memory: 2 workers × (interpreter + PaddleOCR +
Docling caches) ≈ 1.2–1.4 GB → 1.5G limit. ml-platform: 2 workers × per-process
model singleton ≈ 1.6 GB → 2G limit. Do not raise UVICORN_WORKERS without
raising the memory limit proportionally.

**Go memory.** GOMEMLIMIT=450MiB with GOGC=50 on core-banking/middleware-hub
keeps the Go heap under the 512M container limit while halving GC CPU vs the
default GOGC=100 trade-off (more frequent but smaller cycles, tighter tail).

**Rust threads.** TOKIO_WORKER_THREADS 8 (matching) / 4 (settlement, ussd):
size to container CPU. Matching engine is single-hottest-path; 8 workers with
fat LTO + codegen-units=1 maximizes per-core IPC.

**Gateway.** APISIX upstream keepalive 64/host: with ~15 upstreams ≈ 960 idle
conns worst case — trivial. gzip level 5 for JSON ≥ 1 KiB.

## 5. Load testing

**Go/Rust HTTP endpoints** (hey or wrk):

```bash
# core-banking account read
hey -n 20000 -c 50 -m GET http://localhost:8023/health
wrk -t4 -c100 -d60s --latency http://localhost:8200/health
# mojaloop quote flow (p95 target <50ms in-network)
hey -n 10000 -c 20 -m POST -H "Content-Type: application/json" \
    -d '{"quoteId":"...","transactionId":"...","amount":{"currency":"NGN","amount":"100"}}' \
    http://localhost:4001/quotes
```

**Python inference** (locust):

```bash
locust -f locustfile.py --host http://localhost:8015 \
       -u 50 -r 5 --run-time 5m   # /v1/predict endpoints
```

Measure **inside the docker network** (run the load tool as a compose service
or `docker compose exec`) to exclude host NAT noise from p95.

## 6. Profiling how-to

**Go pprof** (per service, disabled by default):

```bash
docker compose exec core-banking env GO_PPROF=1 ... # or set in compose env, restart
go tool pprof http://localhost:6060/debug/pprof/profile?seconds=30
go tool pprof http://localhost:6060/debug/pprof/heap
```
`PPROF_ADDR` defaults to loopback; set `0.0.0.0:6060` + a port mapping to
profile from the host. Never expose publicly.

**Rust flamegraph:**

```bash
cargo install flamegraph
CARGO_PROFILE_RELEASE_DEBUG=true cargo flamegraph --bin matching-engine
# or perf-based against the running container:
docker compose exec matching-engine perf record -F 99 -g -p 1 -- sleep 30
```

**Python py-spy:**

```bash
pip install py-spy
docker compose exec kyc-service py-spy record -o /tmp/profile.svg -d 60 -p 1
docker compose exec ml-platform py-spy top --pid 1
```

**Postgres:** `pg_stat_statements` is preloaded; after `CREATE EXTENSION
pg_stat_statements;` query `SELECT * FROM pg_stat_statements ORDER BY
total_exec_time DESC LIMIT 20;`. Statements > 250 ms are logged
(log_min_duration_statement).

## 7. Container stats reading

```bash
docker stats --no-stream            # instantaneous CPU/MEM per container
docker compose exec redis redis-cli info memory   # used_memory vs 512mb maxmemory
docker compose exec postgres psql -U nexcom -c \
  "SELECT count(*) FROM pg_stat_activity;"        # vs max_connections=300
```

Watch for: MEM USAGE approaching LIMIT (OOM risk — resize `deploy.resources`),
throttled CPU (raise limits or reduce workers), redis evictions
(`info stats → evicted_keys`) indicating maxmemory pressure.

## 8. Continuous guardrail

```bash
node scripts/perf-compose-audit.mjs docker-compose.yml
```
Exits 1 if any critical service loses its healthcheck/logging/restart/resources
wiring. Run in CI on any compose change.
