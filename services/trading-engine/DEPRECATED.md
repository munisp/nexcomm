# DEPRECATED — services/trading-engine

This Go service is **deprecated** and has been removed from
`docker-compose.yml` and `docker-compose.ngapp.yml`.

## Canonical replacement

The **Rust matching engine** (`services/matching-engine`, consumed via
`server/matchingEngineClient.ts` — see the module header comment) is the
canonical order-matching and settlement-adjacent path.

## Why it still exists in the tree

Source is retained for reference only. The binary refuses to start unless
`ALLOW_DEPRECATED=true` is explicitly set (see `cmd/main.go`), and it prints a
loud banner on startup. Do not deploy.
