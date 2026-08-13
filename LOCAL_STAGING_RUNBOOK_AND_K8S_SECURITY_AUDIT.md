# Local Staging Runbook and Kubernetes Manifest Security Audit

**Scope:** Secure local staging bring-up with Docker Compose, plus the Helm/Kubernetes deployment templates under `infra/helm/nexcom` and the Keycloak chart values.
**Author:** Manus AI
**Assessment state:** The runbook is executable on a host with Docker Compose. This sandbox has no Docker daemon, Kubernetes client, Helm client, or cluster context; commands have been reviewed but not deployed here.

## Part I — Local Staging Runbook

> **Purpose.** This procedure starts a local, staging-like dependency topology without silently replacing Keycloak, Permify, Temporal, Dapr, TigerBeetle, or durable data dependencies with mocks. It deliberately uses the hardened base Compose file and **does not auto-merge** the developer override.

### 1. Preconditions

Use a Linux/macOS workstation or Docker Desktop host with Docker Engine and the Compose plugin available. Allocate at least **8 CPU cores, 16 GB RAM, and 40 GB of free disk** for the full platform; the service graph includes PostgreSQL, Redis, Kafka/Zookeeper, TigerBeetle, Keycloak, Temporal, Permify, APISIX/open-appsec, Dapr sidecars, MinIO, OpenSearch, and multiple application services.

Confirm that ports `3000`, `3001`, `5432`, `6379`, `7233`, `8080`, `8200`, `8233`, `9080`, `9443`, `9000`, `9001`, and `9090` are not occupied. Do not expose administrative ports beyond the local host.

```bash
docker version
docker compose version
git status --short
```

The repository’s `docker-compose.override.yml` is a **developer convenience file**. It automatically merges if `docker compose up` is invoked without explicit `-f` flags. It redefines Keycloak as `start-dev`, disables strict hostname checks, and includes weak default credentials. Do not use it for this runbook.

### 2. Prepare a non-committed staging environment file

Create a local environment file from the provided contract. Do not reuse `.env.example`, which contains development-oriented defaults.

```bash
cp .env.staging.example .env.local-staging
chmod 600 .env.local-staging
```

Generate unique local secrets and edit `.env.local-staging`. The commands below produce example values; keep their output out of terminal recordings and shell history where practical.

```bash
openssl rand -base64 36   # POSTGRES_PASSWORD
openssl rand -base64 48   # JWT_SECRET
openssl rand -base64 36   # REDIS_PASSWORD
openssl rand -base64 36   # KEYCLOAK_ADMIN_PASSWORD
openssl rand -base64 36   # KEYCLOAK_CLIENT_SECRET
openssl rand -base64 36   # KEYCLOAK_ADMIN_CLIENT_SECRET
openssl rand -base64 36   # APISIX_ADMIN_KEY
```

For a single-host local run, configure the internal DNS values exactly as expected by Compose. Keep these values in `.env.local-staging`:

| Variable family | Local Compose value | Notes |
|---|---|---|
| PostgreSQL | `postgres:5432` | The base compose mounts `infra/postgres/init/00-keycloak-schema.sql` and creates the `keycloak` schema only on first volume creation. |
| Keycloak service URL | `http://keycloak:8080` | Used by internal services. The public issuer URL must match the local TLS/proxy hostname selected below. |
| Permify | `permify:3476`, tenant `t1` | The schema-init profile must run before protected traffic. |
| Temporal | `temporal:7233`, namespace `nexcom`, task queue `nexcom-main` | `temporal-setup` creates/verifies the namespace. |
| TigerBeetle | `tigerbeetle:3001` | The data file is persisted in the named volume. |
| Dapr | HTTP `3500`, gRPC `50001` | Gateway and portal sidecars mount `infra/dapr/components`. |
| Kafka/Redis | `kafka:9092`, `redis:6379` | The local Dapr component files reference these Compose service names. |
| Fluvio | `fluvio-proxy:9003` | Start the Fluvio/proxy service present in the stack before enabling live-stream tests. |

### 3. Configure a local TLS/hostname boundary for strict Keycloak

The hardened Keycloak Compose service expects a strict public hostname through `KEYCLOAK_PUBLIC_URL`. A secure staging-like run should place a local TLS reverse proxy in front of Keycloak and APISIX, for example with `auth.staging.local` and `app.staging.local` mapped to `127.0.0.1` in the host resolver. Generate a trusted local development certificate with the organization-approved local CA tool, and configure the reverse proxy to forward `X-Forwarded-Proto=https`.

Set, for example:

```dotenv
KEYCLOAK_PUBLIC_URL=https://auth.staging.local
CORS_ORIGINS=https://app.staging.local
```

Do not weaken `KC_HOSTNAME_STRICT` or substitute `start-dev` when the intent is a security rehearsal. If TLS reverse proxy setup is unavailable, treat the run as functional development only, not secured local staging.

### 4. Validate rendered Compose configuration before starting containers

Create the external network expected by the APISIX/open-appsec gateway compose file, then validate the effective base configuration. Explicit `-f` flags prevent developer override auto-merge.

```bash
docker network inspect nexcom-backend >/dev/null 2>&1 || docker network create nexcom-backend

docker compose \
  --env-file .env.local-staging \
  -f docker-compose.yml \
  config --quiet

docker compose \
  --env-file .env.local-staging \
  -f docker-compose.yml \
  -f gateway/docker-compose.gateway.yml \
  config --quiet
```

Resolve any unresolved variable, port collision, or missing-image error before starting workloads. The configuration must not contain an empty Keycloak client secret, APISIX key, or database password.

### 5. Start foundational stateful dependencies

Start stateful services first and observe their health. This isolates storage and control-plane failures from application failures.

```bash
docker compose --env-file .env.local-staging -f docker-compose.yml up -d \
  postgres redis zookeeper kafka tigerbeetle keycloak temporal temporal-setup permify

docker compose --env-file .env.local-staging -f docker-compose.yml ps

docker compose --env-file .env.local-staging -f docker-compose.yml logs --tail=200 \
  postgres kafka tigerbeetle keycloak temporal temporal-setup permify
```

**Required checks:**

```bash
# PostgreSQL
pg_isready -h 127.0.0.1 -p 5432 -U nexcom

# Redis
redis-cli -h 127.0.0.1 -p 6379 ping

# Kafka
docker compose --env-file .env.local-staging -f docker-compose.yml exec kafka \
  kafka-topics --bootstrap-server kafka:9092 --list

# Keycloak discovery
curl --fail --silent --show-error \
  http://127.0.0.1:8080/realms/nexcom/.well-known/openid-configuration | jq '.issuer, .token_endpoint'

# Permify
curl --fail --silent --show-error http://127.0.0.1:3476/healthz

# Temporal namespace
docker compose --env-file .env.local-staging -f docker-compose.yml exec temporal-setup \
  tctl --address temporal:7233 --namespace nexcom namespace describe
```

A fresh PostgreSQL volume is required for the mounted Keycloak schema-init script to execute automatically. If a pre-existing local volume lacks the `keycloak` schema, create it manually with the database owner or remove and recreate the local volume only after confirming no data needs to be retained.

### 6. Initialize authorization and Dapr prerequisites

Permify is not usable for authorization until its schema is installed. Dapr sidecars depend on the mounted `infra/dapr/components/config.yaml`, `statestore.yaml`, and `pubsub.yaml` files.

```bash
# Apply the Permify schema once Permify reports healthy.
docker compose --env-file .env.local-staging -f docker-compose.yml --profile init up --abort-on-container-exit permify-init

# Verify the component directory exists before sidecars start.
find infra/dapr/components -maxdepth 1 -type f -printf '%f\n' | sort
```

For a secure local test, avoid the anonymous object-store configuration in `docker-compose.override.yml`. If MinIO is required, start it with unique credentials and remove the `mc anonymous set download` operation for non-public buckets.

### 7. Start application services and Dapr sidecars

Bring up the dependency consumers after their backing services are healthy. The gateway is configured with explicit Keycloak, Permify, Temporal, Dapr, TigerBeetle, Kafka, Redis, Fluvio, APISIX, and CORS values.

```bash
docker compose --env-file .env.local-staging -f docker-compose.yml up -d \
  matching-engine settlement-engine gateway gateway-dapr portal portal-dapr \
  temporal-worker ingestion-engine analytics ai-ml risk-management

docker compose --env-file .env.local-staging -f docker-compose.yml ps

docker compose --env-file .env.local-staging -f docker-compose.yml logs --tail=250 \
  gateway gateway-dapr portal portal-dapr temporal-worker ai-ml
```

Then start the perimeter stack. The gateway perimeter compose file uses an external `nexcom-backend` network, which was created in step 4.

```bash
docker compose \
  --env-file .env.local-staging \
  -f docker-compose.yml \
  -f gateway/docker-compose.gateway.yml \
  up -d apisix appsec-agent prometheus grafana
```

### 8. Verify connectivity and fail-closed behavior

Use the test harness only with live endpoints and a real non-administrative Keycloak test user. The suite intentionally fails if an endpoint or credential is absent; it does not invent a substitute.

```bash
export STAGING_GATEWAY_URL=http://127.0.0.1:8200
export STAGING_KEYCLOAK_URL=http://127.0.0.1:8080
export STAGING_PERMIFY_URL=http://127.0.0.1:3476
# Run the following two from a temporary diagnostic container on the Compose network,
# or expose a restricted diagnostic endpoint only for local testing.
export STAGING_TEMPORAL_HEALTH_URL=http://temporal-ui:8080
export STAGING_DAPR_HEALTH_URL=http://gateway:3500
export STAGING_TEST_USERNAME=<real-local-test-user>
export STAGING_TEST_PASSWORD=<real-local-test-password>

STAGING_E2E_RESULT_PATH=test-results/local_staging_result.json \
  python3 tests/integration/secured_staging_e2e.py
```

A successful verification must prove all of the following: Keycloak serves OIDC discovery; Permify and Temporal are reachable; the Dapr sidecar responds; the gateway rejects unauthenticated protected requests; real Keycloak login returns a token; authenticated protected access succeeds only with that token; and any stopped external dependency yields an explicit error rather than a fake success.

### 9. Stop and clean up safely

Preserve logs and test results before teardown. Do not use `down -v` unless intentionally discarding all local PostgreSQL, TigerBeetle, Kafka, Redis, and model-registry state.

```bash
mkdir -p test-results/local-staging-logs
docker compose --env-file .env.local-staging -f docker-compose.yml logs > test-results/local-staging-logs/compose.log

docker compose --env-file .env.local-staging -f docker-compose.yml down
# Optional destructive cleanup only after explicit confirmation:
# docker compose --env-file .env.local-staging -f docker-compose.yml down -v
```

## Part II — Helm and Kubernetes Security Audit

### Executive Assessment

The current Helm deployment template has several meaningful baseline protections, including namespaced RBAC, `secretKeyRef` use, non-root workloads, dropped capabilities, read-only filesystems, TLS ingress blocks, pod disruption budgets, and default-deny network-policy intent. However, it is **not ready for a production-equivalent security deployment** without remediation. The primary risks are broad secret-reading RBAC, unbounded port-only egress, no namespace-level Pod Security Admission labels, incomplete container hardening, unpinned images, and a local Compose override that silently replaces hardening with development defaults.

| Security domain | Rating | Summary |
|---|---:|---|
| Secrets management | 2 / 5 | Secrets are referenced rather than embedded in the Helm template, but workloads receive broad secret access through RBAC and the deployment path does not enforce external secret synchronization or rotation. |
| RBAC | 2 / 5 | The Role is namespace-scoped, but the shared service account can list/watch **all** secrets, pods, services, configmaps, deployments, and replicasets. |
| Pod/workload hardening | 3 / 5 | Non-root, capability dropping, no privilege escalation, and read-only root filesystems are present; seccomp, service-account token suppression, resource policy, and image digest enforcement are absent. |
| Network segmentation | 2 / 5 | Default deny is declared, but broad egress is opened by port to any destination and misses several declared dependencies. |
| Ingress/perimeter | 2 / 5 | TLS configuration exists; redirect/HSTS, authenticated admin restrictions, OIDC enforcement confirmation, and restrictive annotations are incomplete. |
| Supply chain | 1 / 5 | Staging uses `imageTag: latest` with `imagePullPolicy: Always`, making deployments non-reproducible. |

### Verified Positive Controls

| Control | Evidence | Assessment |
|---|---|---|
| Secret references | `deployments.yaml` uses `secretKeyRef` for database, JWT, Redis, Kafka, Keycloak client, APISIX, and Dapr credential material. | Good baseline; raw secret literals are not emitted by this chart. |
| Namespaced RBAC | `rbac.yaml` creates a `Role` and `RoleBinding`, not cluster-wide bindings. | Scope is limited to the namespace, though permissions remain too broad. |
| Container hardening | Deployment template sets `runAsNonRoot`, `runAsUser: 1000`, `allowPrivilegeEscalation: false`, `readOnlyRootFilesystem: true`, and drops all Linux capabilities. | Strong baseline for compatible application images. |
| Keycloak hardening | Keycloak values set non-root execution, no privilege escalation, dropped capabilities, external PostgreSQL secret use, strict hostname configuration, and metrics. | Good base. Its writable root filesystem is an explicit exception requiring review. |
| Network-policy intent | The chart declares default-deny ingress/egress and allows in-namespace and ingress-controller traffic. | Good starting point, but rules are insufficiently restricted. |
| Availability controls | PDB, anti-affinity settings in Keycloak production values, health checks, and TLS ingress fields exist. | Useful resilience controls; not a security substitute. |

### Findings and Required Remediation

| ID | Severity | Finding | Evidence | Required remediation |
|---|---|---|---|---|
| K8S-01 | **Critical** | Shared service account may list/watch every Secret in the namespace. | `rbac.yaml` grants `get`, `list`, and `watch` over `secrets`. | Remove secret RBAC entirely unless a specific process demonstrably uses the Kubernetes API. Use pod `secretKeyRef`/CSI mounts and assign one service account per service with zero API permissions by default. |
| K8S-02 | **High** | Network policy permits egress to any IP on listed ports, enabling unintended exfiltration to arbitrary external hosts. | `networkpolicy.yaml` has a ports-only egress rule for `443`, `5432`, `6379`, `9200`, `7233`, `9003`, `3500`, `8080`, and `3000`. | Replace with `namespaceSelector` + `podSelector` rules for each internal dependency; use a dedicated egress gateway/CIDR allowlist for approved third parties. |
| K8S-03 | **High** | Network policy is functionally incomplete: it omits declared Permify `3476/3478`, Kafka `9093`, TigerBeetle `3001`, and APISIX management ports while allowing unrelated `3000`. | Staging values and deployment environment contract reference those services; egress rules do not align. | Build service-specific policies from the declared dependency map; test required traffic and ensure all other flows deny. |
| K8S-04 | **High** | Namespace lacks Pod Security Admission enforce/audit/warn labels. | `namespace.yaml` only renders chart and user labels. | Add `pod-security.kubernetes.io/enforce: restricted`, `audit: restricted`, `warn: restricted`, and a compatible version label. Address exceptions with dedicated namespaces and documented policy. |
| K8S-05 | **High** | Images are not immutable in staging and many repository manifests use `:latest`. | Helm staging has `imageTag: "latest"`; static scan found many `latest` images. | Require registry digests or signed immutable release tags, verify with admission policy, and generate an SBOM/provenance record. |
| K8S-06 | **Medium** | Application workloads do not set `automountServiceAccountToken: false` or a seccomp profile. | `deployments.yaml` defines a shared `serviceAccountName` but no token setting; container/pod contexts omit `seccompProfile`. | Disable token automount for services without Kubernetes API use; set `seccompProfile.type: RuntimeDefault` at pod/container level. |
| K8S-07 | **Medium** | Ingress has TLS but lacks force-HTTPS redirect, HSTS, request-size/body safeguards beyond size, and explicit authenticated admin controls. | Ingress template passes only supplied annotations; base values include timeout/body size/cert issuer. | Add redirect, HSTS, modern TLS, rate-limit, WAF, and strict allowlist annotations/policies. Enforce APISIX OIDC on protected routes and restrict management paths. |
| K8S-08 | **Medium** | Keycloak’s `readOnlyRootFilesystem` is disabled. | `infra/keycloak/values.yaml`. | Confirm Keycloak’s writable paths and mount only those as writable `emptyDir`/PVC volumes; enable read-only root if chart/runtime compatibility allows. |
| CMP-01 | **Critical for local security rehearsal** | `docker-compose.override.yml` auto-merges developer Keycloak `start-dev`, non-strict hostname settings, and default credentials over the hardened base definition. | Docker Compose default override semantics and override file lines 22–60. | Rename/relocate it to an opt-in dev file (for example `compose.dev.yaml`) and require explicit `-f`; never invoke bare `docker compose up` for staging. |
| CMP-02 | **High** | The developer override makes `nexcom-files` MinIO bucket anonymously downloadable and provides default MinIO credentials. | `docker-compose.override.yml` lines 68–69 and 94–99. | Remove anonymous download for non-public data, require generated credentials, and use a separate explicitly opted-in development profile. |
| CMP-03 | **High** | Local APISIX/etcd management configuration includes unauthenticated etcd and exposed administrative ports. | `docker-compose.yml` APISIX/etcd services and gateway compose port mappings. | Bind management ports to loopback only for local development, require APISIX admin key/etcd auth/TLS, and do not expose admin ports in shared staging. |
| CMP-04 | **Medium** | Local Compose Dapr components use non-TLS Redis/Kafka settings by design. | `infra/dapr/components/*.yaml`. | Document these as local-only; the Helm Dapr CRDs use secret-backed credentials and TLS. Do not mount local component files into shared staging. |

### Remediation Sequence

First remove wildcard secret API access and introduce per-service service accounts. Next add Pod Security Admission labels, seccomp profiles, and immutable-image policy. Then replace broad port egress with service-specific network policies and enforce ingress/APISIX authentication and WAF policy. Finally, isolate developer Compose settings from staging and prevent defaults/anonymous storage from appearing in security rehearsals.

The recommended enforcement stack is: **Open Policy Agent/Gatekeeper or Kyverno** for admission checks (no `latest`, required non-root, read-only root, seccomp, signed images, no broad secret RBAC); **open-appsec** for application-layer WAF coverage; **Wazuh** or equivalent SIEM for runtime/audit telemetry; and a cluster-native external-secrets controller for secret synchronization and rotation.

## Evidence Files

This assessment was based on `docker-compose.yml`, `docker-compose.override.yml`, `gateway/docker-compose.gateway.yml`, `.env.staging.example`, `infra/helm/nexcom/values*.yaml`, `infra/helm/nexcom/templates/{deployments,rbac,networkpolicy,namespace,ingress,dapr-components}.yaml`, `infra/keycloak/values.yaml`, and the deployment static-scan output retained as `.security_static_scan.txt`.
