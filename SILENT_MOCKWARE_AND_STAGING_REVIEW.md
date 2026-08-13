# Silent-Mockware Remediation and Staging Dependency Review

**Repository:** `munisp/nexcomm`
**Audit baseline:** `22e21321564f868f5e920a48db950b18e873b1aa`
**Purpose:** Document verified silent-mockware findings, their concrete fail-closed replacements, and the configuration gates for a staging deployment.

## 1. What Qualified as Silent Mockware

> **Silent mockware** is code that returns a plausible success, authorization decision, financial state, stream event, workflow result, or analytical answer even though the authoritative service has failed or was never called.

The audit prioritized this class because it is more dangerous than an overt `503`: it can convince a user, downstream service, or operator that a financial, identity, or operational action completed when it did not.

| Surface | Verified pre-remediation behavior | Why it was dangerous | Replacement now in place |
|---|---|---|---|
| Keycloak gateway client | Generated mock access/refresh/ID tokens, returned canned account successes, and parsed JWT-like data without signature verification when Keycloak failed. | A caller could appear authenticated without a validated identity-provider exchange. | The gateway uses OIDC discovery/token endpoints and Keycloak introspection; unavailable or invalid responses return explicit errors. Analytics no longer decodes unsigned JWT payloads. |
| Permify authorization | Stored tuples in process memory, permitted checks after service/API failure, and let relationship writes appear successful without persistence. | An authorization outage could become an allow decision. | Gateway, portal, and analytics checks deny on dependency/API failure. Relationship writes report failure instead of pretending to persist. |
| TigerBeetle ledger | Created accounts/transfers and balances in a local in-process map when the ledger was unavailable. | Financial operations could appear complete without a durable, double-entry ledger record. | The gateway and settlement adapter require a live official TigerBeetle client. Account, transfer, commit, void, balance, and history calls return dependency errors when no ledger confirmation exists. |
| Dapr | Fell back to process-local state, no-op publishes, fabricated service invocation `{status: ok}`, and empty secrets. | State/event/secret calls could look successful while not crossing the sidecar boundary. | State, publish, invoke, and secret APIs propagate Dapr failures; no local replacement is used. |
| Temporal | On workflow-start failure, created a pseudo-workflow in memory and marked it complete after a delay. | A settlement, KYC, or trading workflow could look orchestrated when no durable execution existed. | Starts, signals, queries, cancellations, and status requests require the Temporal gRPC client. Unavailability returns an error. |
| Fluvio market streaming | Returned generated SSE events/snapshots and HTTP `200` when subscriptions or Fluvio failed. | Traders could see credible but fabricated market data. | Subscription/produce/fetch operations require sidecar health. The gateway responds unavailable instead of emitting locally generated prices or depth. |
| Kafka eventing | Dispatched messages to in-process handlers after broker failure. | An event could appear delivered despite no durable broker acknowledgment. | Producer operations return broker failure; local handler dispatch is not used as a substitute. |
| Redis | Allowed permissive rate-limit/no-op publication behavior in failure paths. | A cache outage could weaken a security or event-delivery control. | Rate-limit and publication failures are surfaced. Cache-only operations remain distinct from security decisions. |
| Gateway data store | `store.New()` seeded a demo user, orders, trades, positions, tickers, notifications, random order books, and random candles. The PostgreSQL store was not the active server store. | Market, portfolio, and ledger-looking API data could be entirely generated. | Automatic seeding was removed. In-memory order-book/candle methods no longer generate values; authoritative upstream data is required. |
| Lakehouse API | User-facing query endpoints responded `executed` or `submitted` without invoking DataFusion, Spark, or Sedona; health reported hard-coded healthy layers. | Operators could believe analytical queries or data quality checks succeeded when they had not run. | Queries require `LAKEHOUSE_EXECUTOR_URL` and a successful executor response; otherwise `503` is returned. Health uses live layer-manager output. |
| Cross-border workflow | Sanctions screening passed through; Mojaloop outage generated a synthetic quote, packet, exchange rate, fee, and expiry. | A payment/settlement path could advance on fabricated compliance or price evidence. | The workflow requires an OpenSanctions key and valid screening response, plus a validated Mojaloop quote with the required settlement fields. |
| KYC, balance, credit, and risk workflows | Several activities converted unavailable services into approval-like booleans or empty results. | Deposits, lending, orders, and compliance journeys could progress using unknown state. | KYC, balance, pre-trade risk, credit scoring, warehouse, corporate-action, loan, and holder checks now return explicit errors on upstream failure. |
| Open-appsec WAF | The APISIX attachment plugin could allow traffic when its inspection agent was unreachable or malformed. | A WAF outage could bypass the security perimeter. | Agent outage, non-200 inspection, and invalid verdict responses now return `503`. |
| CPU AI risk model | The gradient-boosting model generated synthetic training data and persisted a local `/tmp` artifact. | Inference could look trained and credible without platform data lineage. | First-time training now requires a validated real lakehouse `.npz` feature export. The service remains degraded/unready when verified artifacts are absent. |

## 2. Evidence of Fail-Closed Semantics

The remediation does not merely remove demo text. It changes the control flow at dependency boundaries so the application can no longer return a credible success after failure. The following patterns are now expected during an outage.

| Dependency class | Required behavior after remediation | Expected caller-visible outcome |
|---|---|---|
| Identity and authorization | No token parsing or permission allow decision without the authoritative provider. | `401`, `403`, or dependency-aware error. |
| Financial ledger and settlement | No account creation, balance, transfer, hold, commit, or void without TigerBeetle confirmation. | Failed order/settlement workflow; no synthetic transfer ID or balance. |
| Workflow orchestration | No local workflow state after Temporal start/query/control failure. | Workflow start/control error; worker retry policy can decide recovery. |
| Market and event streams | No generated snapshot, SSE event, or local delivery substitute. | Stream unavailable/error; no fabricated market data. |
| Security perimeter | No WAF bypass or permissive permission check after a dependency error. | `503` at WAF failure, or access denial at authorization failure. |
| Lakehouse/AI | No execution claim without executor response and no model-ready claim without verified artifact/data. | `503`/degraded readiness; operator must restore configuration or data. |

## 3. Staging Deployment: Required Configuration Before Starting Workloads

### 3.1 Non-negotiable staging rules

1. **Do not carry development bypass settings into staging.** In particular, remove `PERMIFY_FAIL_OPEN=true`, default JWT secrets, default database passwords, default dashboard credentials, and any `localhost` endpoints from workload environment variables.
2. **All service endpoints must be cluster-resolvable.** The strict gateway configuration expects concrete values for `KEYCLOAK_URL`, `PERMIFY_ENDPOINT`, `TEMPORAL_HOST`, `TIGERBEETLE_ADDRESSES`, `DAPR_HTTP_PORT`, `DAPR_GRPC_PORT`, `FLUVIO_ENDPOINT`, `KAFKA_BROKERS`, `REDIS_URL`, `POSTGRES_URL`, `APISIX_ADMIN_URL`, and downstream service URLs.
3. **Persist financial, identity, workflow, policy, and database state.** An ephemeral volume is not adequate for PostgreSQL, TigerBeetle, Temporal persistence, Redis where used for state, Kafka, Permify, or model artifacts.
4. **Restrict all control-plane ports.** Do not publicly expose APISIX Admin (`9180`), Keycloak admin, Temporal UI, Permify gRPC/HTTP, Grafana, Prometheus, Redis, PostgreSQL, TigerBeetle, or Dapr control ports.
5. **Treat readiness failures as deployment blockers.** The new fail-closed behavior deliberately exposes incomplete dependencies; staging must repair the dependency rather than permit a fallback.

### 3.2 Required secrets and configuration objects

| Object | Required keys or values | Owner/notes |
|---|---|---|
| `nexcom-secrets` | Production-grade database credentials, application session/JWT secret, APISIX admin key, integration credentials, OIDC client secrets, and service-specific secrets. | Referenced by Helm base values; use a managed secret mechanism rather than `--set` secrets in shell history. |
| `nexcom-keycloak-db-secret` | `password` key for the `keycloak` PostgreSQL user. | Required by Keycloak `externalDatabase` configuration. |
| Keycloak realm ConfigMap | `nexcom-keycloak-realms`, mounted at `/opt/keycloak/data/import`. | Must contain realm, clients, redirect URIs, roles, scope mappings, and token settings used by the strict gateway client. |
| Permify schema | Tenant `t1` and the NEXCOM relationship schema from `permify.perm`. | `permify-init` is an opt-in compose profile and must be run successfully before permission-protected traffic. |
| TLS secrets | `nexcom-tls-staging` for `staging.nexcom.exchange`; separate Keycloak/Caddy certificate handling as applicable. | Certificates and hostnames must match strict Keycloak hostname settings. |
| AI model registry / training export | Persisted, trusted model artifacts or `RISK_TRAINING_DATA_PATH` pointing to a validated lakehouse `.npz` dataset. | Do not permit synthetic model generation. |

## 4. Dependency-by-Dependency Staging Checklist

### PostgreSQL

- [ ] Provision PostgreSQL 16 or a compatible hardened cluster with durable storage, backups, point-in-time recovery, TLS, and network policies.
- [ ] Create at least the NEXCOM application database/user and the dedicated Keycloak database/user expected by the Keycloak chart (`database: keycloak`, `user: keycloak`).
- [ ] Set `DATABASE_URL` / `POSTGRES_URL` for every service using the correct cluster DNS name and TLS mode; do not use the compose default password.
- [ ] Apply the normal Drizzle migration workflow, including `0063_schema_reconciliation`, before application rollout.
- [ ] Verify the migration journal records `0063_schema_reconciliation`, and confirm ledger tables/indexes exist before enabling financial workflows.

### Keycloak

- [ ] Deploy the Keycloak chart in a dedicated IAM namespace with `production: true`, `proxyHeaders: edge`, strict public and admin hostnames, two replicas, and Kubernetes cache discovery.
- [ ] Inject the Keycloak admin password through a secret; do not leave `adminPassword` empty or use the chart command-line example in CI logs.
- [ ] Supply `nexcom-keycloak-db-secret`, validate database connectivity, and ensure realm ConfigMaps are created before `--import-realm` starts.
- [ ] Create/verify the gateway client, client secret or permitted public flow, service-account/admin client credentials where account-management operations require them, redirect URIs for staging, and the `nexcom` realm.
- [ ] Set workloads to `KEYCLOAK_URL=https://<staging-auth-host>`, `KEYCLOAK_REALM=nexcom`, and the correct `KEYCLOAK_CLIENT_ID`. Where the gateway uses client-authenticated administrative functions, also set the required client credentials as secrets.
- [ ] Verify OIDC discovery, JWKS/introspection, token issuance, refresh, and a denied invalid-token path before exposing application routes.

### TigerBeetle

- [ ] Deploy a pinned TigerBeetle image compatible with the Go/Rust SDK versions in the repository. The local compose file currently uses `0.16.73`; do not silently upgrade the service independently of clients.
- [ ] Format the cluster data file once, then start the node(s) using durable block storage. The compose pattern uses `/data/0_0.tigerbeetle` and port `3001`.
- [ ] For staging resilience, define the replication topology, node addresses, storage class, backup/restore process, and monitoring before treating the single-node compose configuration as adequate.
- [ ] Set `TIGERBEETLE_ADDRESSES=<service-DNS>:3001` in gateway, settlement, matching, trading, and workflow workers. Ensure all account IDs and transfer code contracts are initialized consistently.
- [ ] Run account creation, duplicate transfer, pending transfer, commit, void, lookup, and restart-recovery scenarios. Any unavailable ledger condition must stop the financial action.

### Temporal

- [ ] Use PostgreSQL-backed Temporal persistence. The compose service uses `temporalio/auto-setup` with `DB=postgresql`, `POSTGRES_SEEDS=postgres`, and gRPC `7233`; staging should use pinned images and persistent database credentials from secrets.
- [ ] Ensure Temporal is healthy before startup of `temporal-setup`; the setup job must create or verify the `nexcom` namespace with the intended retention and archival policy.
- [ ] Set `TEMPORAL_HOST=<temporal-service>:7233`, `TEMPORAL_NAMESPACE=nexcom`, and task queues such as `nexcom-main` consistently across gateway, workers, middleware hub, and journey orchestrator.
- [ ] Deploy workers only after namespace registration. Confirm workflow registration, activity registration, workflow start, query, signal, retry, and cancellation using a staging test workflow.
- [ ] Restrict Temporal UI (`8233` in compose) to the operations network; do not publish it externally.

### Permify

- [ ] Deploy Permify with a PostgreSQL-backed datastore and durable credentials. The compose configuration uses HTTP `3476`, gRPC `3478`, and tenant `t1`.
- [ ] Execute the schema initialization job after health is green; confirm the schema version and required relationship tuples exist.
- [ ] Configure every caller with a network-resolvable `PERMIFY_ENDPOINT` and tenant. Remove `PERMIFY_FAIL_OPEN` from staging configuration entirely.
- [ ] Verify three paths: known allow, known deny, and dependency outage. The outage must deny access, not permit it.

### Redis and Kafka

- [ ] Run Redis with persistence appropriate to the role it plays; the local compose uses AOF. Add authentication, TLS where supported, eviction policy, memory limits, and monitored replication for staging.
- [ ] Set `REDIS_URL` with credentials; remove bare `redis://redis:6379` if staging requires authentication.
- [ ] Deploy Kafka with durable storage, ACLs/TLS/SASL as applicable, topic creation under infrastructure-as-code, retention policies, partitions, and consumer-group monitoring. The local compose is a single-broker development topology and is not a staging reliability baseline.
- [ ] Update `KAFKA_BROKERS` across all producers/consumers, then verify actual producer acknowledgements and consumer offsets rather than local handler behavior.

### Dapr and Fluvio

- [ ] Deploy Dapr placement before any actor-enabled sidecars. Every workload using the Go Dapr client requires reachable gRPC/HTTP sidecars on its configured ports.
- [ ] Apply real Dapr component manifests for state, pub/sub, and secrets, and validate that component metadata points to secured Redis/Kafka/secret backends.
- [ ] **Manifest gap:** `docker-compose.yml` mounts `./services/middleware-hub/dapr/components`, but that directory was not present in the reviewed repository path. Supply the actual component directory/manifests before staging rollout.
- [ ] **Manifest gap:** Helm values declare a `fluvioSidecar`, but the primary compose file exposes only a `FLUVIO_HTTP_URL=http://fluvio-proxy:8090` reference rather than a concrete Fluvio service declaration. Define the Fluvio cluster/sidecar deployment, topic lifecycle, credentials, health endpoint, and `FLUVIO_ENDPOINT`/`FLUVIO_HTTP_URL` consistently before enabling market streaming.

### APISIX and open-appsec

- [ ] Deploy APISIX with persistent configuration storage and a non-default admin key. The compose file currently declares unauthenticated etcd and exposes management ports suitable only for local development.
- [ ] Deploy the open-appsec agent and verify the APISIX attachment plugin communicates with it. The remediated plugin returns `503` when the agent is unavailable; test that condition deliberately before public exposure.
- [ ] **Routing gap:** the reviewed standalone configuration uses `nexcom.example.com` while staging Helm uses `staging.nexcom.exchange`; update route hosts and CORS origins to the actual staging domain.
- [ ] **Authentication gap:** public tRPC routes in the reviewed APISIX configuration have rate limiting and CORS but no OIDC/OpenID Connect plugin attachment. Add and validate an OIDC enforcement policy for protected traffic, or ensure a documented upstream-only authentication boundary with no public bypass.
- [ ] **WAF attachment gap:** confirm the open-appsec plugin/policy is attached to every public route, not only that an agent container exists. Run an allow request, a blocked signature request, and an agent-outage request.

### Lakehouse, OpenSearch, and AI/ML

- [ ] Supply a real lakehouse executor URL via `LAKEHOUSE_EXECUTOR_URL`, with an authenticated DataFusion/Spark/Sedona execution path and constrained query policy.
- [ ] Confirm Bronze/Silver/Gold table registration, data lineage, quality/freshness metadata, and actual table statistics from durable storage before trusting dashboards.
- [ ] Provision OpenSearch with authentication/TLS, index lifecycle policy, and durable storage. Treat no-op indexing as an operational failure.
- [ ] Mount a persistent model registry. Populate signed/approved model artifacts or a valid real training export; then verify AI `/readyz` is healthy and inference requests have provenance.

## 5. Required Environment Contract for the Gateway

The gateway configuration code supplies localhost defaults for development. In staging, all of the following should be explicitly set through workload environment configuration or secret references; no service should inherit a localhost fallback.

| Variable | Staging value form | Purpose |
|---|---|---|
| `ENVIRONMENT` | `staging` | Enables correct environment context/logging. |
| `POSTGRES_URL` | `postgres://…@<postgres-DNS>:5432/nexcom?...` | Portal/gateway durable store access. |
| `KAFKA_BROKERS` | `<kafka-bootstrap-DNS>:9092` or TLS listener | Durable events. |
| `REDIS_URL` | `redis://:<secret>@<redis-DNS>:6379/...` or TLS scheme | Cache/rate-limit/event support. |
| `TIGERBEETLE_ADDRESSES` | `<tigerbeetle-DNS>:3001[,node2:3001,…]` | Authoritative ledger. |
| `TEMPORAL_HOST` | `<temporal-frontend-DNS>:7233` | Durable workflows. |
| `DAPR_HTTP_PORT` / `DAPR_GRPC_PORT` | Sidecar ports, typically `3500` / `50001` | Dapr calls. |
| `FLUVIO_ENDPOINT` | Sidecar/cluster endpoint | Live market/event streaming. |
| `KEYCLOAK_URL` | `https://<staging-auth-host>` | OIDC discovery, token, introspection. |
| `KEYCLOAK_REALM` / `KEYCLOAK_CLIENT_ID` | Realm/client values from imported configuration | Identity contract. |
| `PERMIFY_ENDPOINT` | `<permify-DNS>:3476` or full HTTP URL per client | Fine-grained authorization. |
| `APISIX_ADMIN_URL` / `APISIX_ADMIN_KEY` | Internal management endpoint and secret key | Controlled route/policy management. |
| `CORS_ORIGINS` | Exact staging UI origins | Browser protection. |
| Downstream URLs | Cluster service DNS names | Matching, KYC, analytics, AI/ML, ingestion, blockchain, user management, and Mojaloop calls. |

> **Important configuration mismatch:** the reviewed `gateway` compose service sets TigerBeetle, Kafka, and Redis but does not explicitly inject Keycloak, Permify, Temporal, Dapr, Fluvio, PostgreSQL, or APISIX variables. Because the gateway now fails closed, staging must add these variables rather than rely on its localhost defaults.

## 6. Staged Bring-up Order and Acceptance Tests

| Stage | Bring-up action | Required acceptance signal |
|---:|---|---|
| 1 | Create namespaces, network policies, secret objects, persistent volumes, and DNS/TLS. | No external control ports are public; secret references resolve. |
| 2 | Start PostgreSQL, Redis, Kafka, TigerBeetle, and backing object/model storage. | Health checks pass; data survives a controlled restart. |
| 3 | Apply Drizzle migration reconciliation and initialize application/Keycloak/Permify databases. | Journal/table/index verification passes. |
| 4 | Start Keycloak, Temporal, Permify, Dapr placement/components, Fluvio, OpenSearch, lakehouse executor. | Identity, workflow namespace, policy schema, sidecars, and executor readiness checks pass. |
| 5 | Start matching, settlement, gateway, ingestion, analytics, AI/ML, and worker services with explicit endpoint variables. | Each service readiness endpoint is green; AI only becomes ready with verified artifacts. |
| 6 | Start APISIX and open-appsec last, configure actual staging hosts, OIDC, WAF attachment, and restricted admin access. | Route tests pass; WAF agent outage returns `503`; protected routes cannot bypass authorization. |
| 7 | Execute end-to-end test suite. | Login; deny; order reserve; transfer commit/void; workflow start/query; market stream; lakehouse query; model inference; and failure injection all produce expected outcomes. |

## 7. Deployment Stop Conditions

Do **not** advance a staging release if any of the following is true:

- a workload has a `localhost` value for a cluster dependency;
- any `PERMIFY_FAIL_OPEN`/development bypass remains;
- Keycloak realm/client or Permify schema initialization failed;
- TigerBeetle storage is not durable or the client cannot create/lookup real records;
- Temporal namespace/worker registration is absent;
- Dapr components or Fluvio sidecar/cluster deployment are missing;
- APISIX public hosts, OIDC enforcement, or open-appsec policy attachment have not been verified;
- lakehouse executor is absent but users can still call analytical routes;
- AI readiness is healthy without an approved model artifact or real training export.

## 8. Repository Evidence

The review is derived from the repository’s integration finding ledger, gateway configuration contract, local-compose topology, staging Helm values, Keycloak Helm values, APISIX route file, and the remediated source paths. The main supporting artifacts are `.audit_verified_findings.md`, `gateway-service/internal/config/config.go`, `docker-compose.yml`, `gateway/docker-compose.gateway.yml`, `infra/helm/nexcom/values*.yaml`, `infra/keycloak/values.yaml`, and `gateway/apisix/apisix-standalone.yaml`.
