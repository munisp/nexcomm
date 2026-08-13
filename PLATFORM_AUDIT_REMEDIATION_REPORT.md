# NEXCOMM Platform Audit and Remediation Report

**Author:** Manus AI
**Scope:** Repository-wide application, middleware, schema, workflow, frontend-build, and silent-mockware audit
**Status:** Code remediation and compile validation completed; live infrastructure validation remains a deployment gate.

## Executive Assessment

The repository contained several **production-dangerous silent-success paths**. These included fabricated authentication tokens, permissive authorization fallbacks, local financial-ledger behavior, simulated workflow state, generated market/SSE data, non-executed lakehouse query responses, synthetic cross-border quotes, and authorization bypasses during dependency outages. The remediation replaces those paths with explicit errors or verified responses from the authoritative dependency.

The application now favors **fail-closed semantics** for identity, authorization, financial settlement, WAF inspection, live market data, workflow execution, and compliance checks. This prevents an unavailable dependency from producing plausible-looking but unverified results. A forward Drizzle reconciliation migration also brings previously unjournaled schema changes into normal deployment flow.

This pass also exposed and repaired build defects outside the initial mockware findings. The journey orchestrator had malformed workflow wiring and multiple missing Temporal activity-name bindings. The matching engine had stale Spot FX HTTP handlers and an AMM borrow conflict. Both now compile against their declared implementations.

| Area | Remediation outcome |
|---|---|
| Keycloak | Removed mock tokens and unsigned token decoding from active gateway/analytics paths; identity failures are explicit. |
| Permify | Removed allow-all behavior from gateway, analytics, and portal adapters; dependency errors deny requests. |
| TigerBeetle | Removed in-memory ledger fallbacks in gateway and settlement paths; matching and trading engines reject unknown balances and unconfirmed reservations. |
| Dapr, Temporal, Redis, Fluvio, Kafka | Removed local/no-op success fallbacks; state, event, rate-limit, workflow, and stream dependency failures are surfaced. |
| APISIX/Open-appsec | WAF agent failures, non-200 inspection responses, and malformed verdicts now return `503`, rather than bypass inspection. |
| Lakehouse | The query endpoint no longer claims execution unless a configured executor responds successfully; health reports layer-manager status rather than fixed healthy strings. |
| Postgres/schema | Added and journaled an idempotent forward reconciliation migration for formerly unjournaled schema work. |
| Workflows | Replaced KYC, sanctions, balance, risk, warehouse, cross-border, and holder-query success-like fallbacks with verified downstream results or errors. |
| AI/ML | Risk-model first-time training now requires a validated real lakehouse export; readiness is degraded when verified model artifacts are unavailable. |

## Principal Code Changes

The Go gateway now has strict Keycloak, Permify, TigerBeetle, Dapr, Redis, Temporal, Fluvio, and Kafka clients. It no longer emits local event-stream results after an external publish failure, and it no longer starts simulated workflows or returns mock identity/authorization artifacts. The seeded in-memory gateway store is no longer initialized and no longer generates order-book depth or OHLCV candles.

The matching engine now rejects BUY orders when the settlement balance cannot be verified. Its reservation/release client returns explicit Rust `Result` failures rather than sentinel balances or empty identifiers. The matching engine’s Spot FX HTTP handlers were reconciled to the actual `SpotFxEngine` API, including canonical `BASE/QUOTE` pair IDs and authoritative request/response DTOs. The multi-currency AMM calculator was made borrow-safe without changing the constant-product calculation.

The journey orchestrator now has canonical Temporal activity-name constants for all referenced Activities methods. It compiles all journeys and uses explicit downstream errors for critical user, warehouse, loan, corporate-action, pre-trade-risk, circuit-breaker, balance, KYC, sanctions, and settlement queries. Its previously malformed investor-relations query construction was corrected.

The AI/ML service no longer trains the gradient-boosting risk model from generated samples at startup. If no persisted model artifact is present, it requires `RISK_TRAINING_DATA_PATH` to point to a real NumPy `.npz` export containing validated `features` and `labels` arrays. Its health and readiness endpoints now disclose unavailable model artifacts instead of reporting ready inference.

## Schema and Indexing

The repository had two schema changes that existed on disk but were absent from the Drizzle journal. A new forward migration, `drizzle/0063_schema_reconciliation.sql`, contains the idempotent table, partition, ledger, and index reconciliation work. It is registered as `0063_schema_reconciliation` in `drizzle/meta/_journal.json`.

> Apply the new migration through the normal Drizzle deployment path before deploying application binaries that depend on the reconciled tables and indexes.

## Verification Evidence

| Validation | Result | Notes |
|---|---:|---|
| Portal TypeScript check | Passed | `pnpm run check` completed with `tsc --noEmit`. |
| Portal production build | Passed | `pnpm run build` completed successfully. Large vendor chunks remain a performance warning, not a build failure. |
| Gateway Go packages | Passed | `go test ./internal/... -run '^$'` compiled all modified gateway packages. |
| Journey orchestrator | Passed | `go mod tidy` repaired missing checksums; `go test ./... -run '^$'` compiled API, worker, activities, clients, configuration, and workflows. |
| Middleware hub | Passed | `go test ./... -run '^$'` compiled all module packages. |
| Trading engine | Passed | `go test ./... -run '^$'` compiled all module packages. |
| Matching engine | Passed | `cargo check` passed after Spot FX route reconciliation and AMM borrow repair. |
| Settlement engine | Passed | `cargo check` passed after strict TigerBeetle adapter changes. |
| Modified Python services | Passed | `py_compile` passed for ingestion, analytics authorization, AI lifecycle, and risk model modules. |
| Migration journal integrity | Passed | The reconciliation migration is present and journaled. |
| Focused silent-mockware scan | Passed | No remaining focused `allow-all`, `fail-open`, synthetic quote, mock token, unsigned-token, in-memory ledger, or in-memory workflow markers were found in production paths, excluding test/audit/historical files. |

## Deployment Gates and Residual Risks

The repository does **not** include running credentials, live service endpoints, a populated production lakehouse, or a deployed dependency topology in this sandbox. Consequently, no claim is made that Keycloak, TigerBeetle, PostgreSQL, APISIX, Permify, Dapr, Temporal, Redis, Open-appsec, Fluvio/Kafka, the lakehouse executor, or external KYC/sanctions/Mojaloop services were live-tested here. The code now rejects or reports those outages rather than fabricating success.

The AI service requires genuine, governed model artifacts or a real lakehouse training export before readiness can become healthy. For risk scoring, provide `RISK_TRAINING_DATA_PATH` with a NumPy `.npz` file containing a `features` matrix with 47 finite columns and aligned class labels in `labels`. This is intentional: inventing a trained financial risk model from generated samples would reintroduce the silent-mockware condition the audit removed.

The generic static scanner continues to report broad keyword-driven findings. Many are legitimate-looking but non-authorizing predicates, availability checks, test fixtures, or historical scripts. The focused scan and manual call-path reviews above are the relevant evidence for the dangerous silent-success classes remediated in this pass. Every remaining generic scanner hit should still be triaged before a regulated production deployment.

## Recommended Deployment Order

| Order | Required action |
|---:|---|
| 1 | Apply `0063_schema_reconciliation` using the production migration workflow. |
| 2 | Provision and health-check Keycloak, Permify, TigerBeetle, PostgreSQL, Redis, Temporal, Dapr, APISIX/Open-appsec, Kafka/Fluvio, and the lakehouse executor. |
| 3 | Configure secrets and endpoint variables; do not enable bypass flags. |
| 4 | Publish verified ML artifacts and training provenance, then confirm `/readyz` returns `200`. |
| 5 | Execute staging end-to-end scenarios for sign-in, authorization denial, order reservation, settlement, KYC, sanctions, market streaming, lakehouse querying, and failure injection. |
| 6 | Monitor `503` dependency responses during staged rollout; they are now intentional evidence of fail-closed behavior and should be resolved operationally rather than bypassed. |

## Key Artifacts

The reusable static audit tools are retained in `scripts/audit_platform.py` and `scripts/audit_frontend_wiring.py`. The final machine-readable scanner output is `.audit_static_report_post_validation.json`, and the migration repair is `drizzle/0063_schema_reconciliation.sql`.
