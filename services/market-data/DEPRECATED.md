# DEPRECATED (LEGACY) — services/market-data

This Go market-data service is **legacy** and has been removed from
`docker-compose.yml` and `docker-compose.ngapp.yml`.

## Canonical replacement

**services/ingestion-engine** is the canonical market-data ingestion path
(lakehouse bronze/silver/gold pipeline). Price freshness/staleness semantics
added in `internal/feeds/processor.go` (stale flags, `/api/v1/market/health`,
feed reconnect/backoff in `internal/feeds/feed_runner.go`) remain available if
this service is ever revived, but new work belongs in ingestion-engine.

## Guard

The binary refuses to start unless `ALLOW_DEPRECATED=true` is explicitly set
and prints a loud banner on startup (see `cmd/main.go`). Do not deploy.
