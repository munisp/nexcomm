# Security Remediation and Compliance Report

**Scope:** Critical Kubernetes and Docker Compose security remediation, rendered Helm/Kubernetes compliance scan, and repository-wide search for active silent-mockware.
**Author:** Manus AI

## Executive Result

The three critical deployment findings have been remediated in source. The resulting configuration removes the namespace-wide Secret-reading role, prevents automatic loading of the unsafe Compose override, requires explicit local credentials, and blocks secured staging Helm renders unless every workload is supplied as an immutable image digest. An OPA Gatekeeper constraint provides the corresponding admission-time control.

A new focused scan also found and removed three additional silent-success paths: generated commodity price histories, unconfirmed WhatsApp-delivery success, and trading-engine order admission during ledger outages. The final focused active-source scan passed.

| Area | Result | Evidence |
|---|---|---|
| Namespace-wide Secret RBAC | **Remediated** | Workload service account only; no Role or RoleBinding grants Secret list/watch/get. |
| Compose override/default credentials | **Remediated** | `docker-compose.override.yml` removed; opt-in `compose.dev.yml` requires explicit credentials and no longer makes buckets public. |
| Immutable images | **Remediated / deployment gated** | Staging values enable `requireImageDigest`; Helm rejects tag-only image references; Gatekeeper constraint rejects non-digest images. |
| Active silent-mockware scan | **Pass** | No focused mock-token, allow-all, fail-open, local-ledger/workflow, seeded-financial-data, or generated-price markers in active application/deployment paths. |
| Portal type check | **Pass** | `pnpm run check` exited 0 after no-mock commodity API contract changes. |
| Go verification | **Pass** | Gateway store and trading engine compiled after removal of demo seed path and ledger fail-closed change. |
| Rendered Checkov scan | **Findings remain** | 2,529 checks passed; 87 failed; 0 skipped; 0 parsing errors; 100 resources scanned. |

## Applied Remediation Patches

### 1. Least-privilege Kubernetes service account

`infra/helm/nexcom/templates/rbac.yaml` now creates only a named service account with `automountServiceAccountToken: false`. The previous shared Role allowed `get`, `list`, and `watch` on **all pods, services, configmaps, and secrets** in the namespace. That Role and RoleBinding were removed because application pods receive only named Secret keys through their pod specifications and do not require Kubernetes API access at runtime.

`infra/helm/nexcom/templates/deployments.yaml` now also applies `automountServiceAccountToken: false` to every pod and sets `seccompProfile.type: RuntimeDefault`. This prevents an accidental future service-account default from mounting a bearer token into application containers.

### 2. Secure Compose separation and explicit credentials

The automatically merged `docker-compose.override.yml` was renamed to `compose.dev.yml`. Docker Compose no longer imports development Keycloak settings when the base staging-like configuration is started.

`compose.dev.yml` is now opt-in and requires `KEYCLOAK_ADMIN_USERNAME`, `KEYCLOAK_ADMIN_PASSWORD`, `POSTGRES_PASSWORD`, `MINIO_ROOT_USER`, `MINIO_ROOT_PASSWORD`, and `KEYCLOAK_CLIENT_SECRET`. Its MinIO initialization no longer makes `nexcom-files` anonymously downloadable, and it targets the real `portal` service rather than the stale `nexcom-app` name.

The base `docker-compose.yml` no longer has fallback PostgreSQL or JWT secrets. The deployment aborts with an explicit missing-variable error if `POSTGRES_PASSWORD` or `JWT_SECRET` is not supplied. The APISIX/open-appsec configuration now requires `APISIX_ADMIN_KEY` and sets `fail_open: false`.

### 3. Immutable-image enforcement

`values.yaml` no longer uses `latest`; it defaults to a release label. `values-staging.yaml` sets `requireImageDigest: true` and `imagePullPolicy: Always`.

The deployment template accepts a full `service.image.name` only when it includes `@sha256:` for secured environments. If no digest is supplied, Helm stops before creating a manifest. The verified Helm guard produced:

```text
service nexcom-exchange requires image.name to be a full immutable @sha256 reference
```

`infra/policies/gatekeeper/require-image-digests.yaml` adds a Gatekeeper ConstraintTemplate and constraint for the `nexcom-staging` and `nexcom` namespaces. It denies Deployments, StatefulSets, DaemonSets, Jobs, and CronJobs whose regular or init containers do not specify image digests.

> CI/CD must replace each service’s `image.name` with the signed full digest reference before it invokes the secured staging Helm release. This is intentionally a deployment gate, not a documentation-only recommendation.

## Silent-Mockware Remediation

| Finding | Prior behavior | Secure behavior now implemented |
|---|---|---|
| Commodity price history | Generated deterministic OHLCV bars and grade-spread values when durable historical data was absent. Those results resembled market prices. | `server/routers/commodities.ts` returns an empty bar set with `historyStatus: "UNAVAILABLE"` and a clear message. It exposes only a live price returned from the authoritative `livePrices` table. Grade-history responses are empty/unavailable. |
| Static catalogue reference price | Returned `basePrice` as a public instrument value. | Removed from public list and instrument responses so it cannot be presented as a live quote. |
| Gateway in-memory demo financial state | Retained an unreachable but complete `seedData` routine that generated demo user, orders, trades, positions, alerts, notifications, and prices. | Removed the whole `seedData` and `seedCommodities` implementations from the gateway store. |
| WhatsApp receipt | Returned `true` when the WhatsApp credential was absent, causing receipt metadata to claim delivery. | Missing `WHATSAPP_ACCESS_TOKEN` returns `false` and logs explicit non-delivery. The receipt response reports `whatsappSent: false`. |
| Trading pre-trade margin check | Ledger errors/sentinel balance and reservation errors could allow a buy limit order to reach the book. | `services/trading-engine/internal/matching/engine.go` rejects the order unless balance verification and a non-empty durable reserve confirmation both succeed. |
| open-appsec WAF | APISIX configuration allowed traffic if its open-appsec agent was unavailable. | `fail_open: false`; the APISIX admin key is also explicitly required. |
| Comprehensive fixture generator | Generated realistic-looking finance, identity, credit, lending, and price data on invocation. | It now fails unless a deliberate development acknowledgement is supplied and refuses `production` or `staging` environments. |

## Automated Compliance Scan — Checkov

Checkov `3.3.10` scanned the Helm chart after rendering **100** concrete Kubernetes resources. The rendering used `global.requireImageDigest=false` only so the scanner could inspect the chart; the committed staging values keep the guard enabled and block tag-only deploys.

| Checkov result | Count |
|---|---:|
| Passed | 2,529 |
| Failed | 87 |
| Skipped | 0 |
| Parsing errors | 0 |
| Resources | 100 |

| Check ID | Finding | Occurrences | Status / required action |
|---|---|---:|---|
| `CKV_K8S_35` | Prefer Secret files over Secret environment variables | 29 | **Open.** The chart uses `secretKeyRef`, which avoids embedded secret literals, but Checkov requires file/CSI delivery. Migrate sensitive credentials to projected Secret volumes or External Secrets CSI and update services to read file paths. |
| `CKV_K8S_40` | Containers should run as a high UID | 29 | **Open.** Pods run as non-root UID `1000`; Checkov recommends a high, non-host-colliding UID. Rebuild images and deploy with a high non-root UID (for example `10001`) after verifying filesystem ownership. |
| `CKV_K8S_43` | Image should use a digest | 29 | **Expected in analysis render; gated in secured staging.** The static analysis render disabled the committed digest guard because real CI-provided digests are not available in the repository. Normal secured staging render fails without them, and Gatekeeper denies them at admission. |

The raw Checkov JSON is retained as an attachment. The scanner’s 87 failures are reported rather than suppressed. No compliance pass claim is made until the file-based-secret and high-UID findings are resolved and CI supplies actual signed image digests.

## Verification Commands and Results

| Verification | Result |
|---|---|
| `pnpm run check` | Pass (`TYPECHECK_EXIT_CODE=0`) |
| `go test ./internal/store -run '^$'` | Pass |
| `go test ./... -run '^$'` in trading engine | Pass |
| Demo seed guard without acknowledgement | Pass; process stopped with the expected development-only error |
| Secured Helm render without digests | Pass; render stopped with expected immutable-image error |
| Focused active-source silent-mockware search | Pass |
| Targeted security-control checks | Pass |
| `git diff --check` | Pass |

## Remaining Security Work

The remaining Checkov findings are real remediation work, not exclusions. The highest next priority is moving Kubernetes secret delivery to a CSI/External Secrets file mount and making all services consume file-path configuration. Next, rebuild the images for a high UID and set matching ownership for writable volumes. Finally, inject signed full image digests in CI before Helm deployment, then rerun Checkov on the real rendered release.

## Evidence Files

| File | Contents |
|---|---|
| `test-results/checkov/rendered_manifest/results_json.json` | Full Checkov JSON report. |
| `test-results/checkov/rendered_manifest/summary.json` | Grouped Checkov summary. |
| `test-results/checkov/rendered_manifest_console.log` | Checkov console output and exit code. |
| `test-results/focused_silent_mockware_scan.txt` | Final active-source silent-mockware scan result. |
| `test-results/final_security_control_validation.log` | Targeted remediation control results. |
| `test-results/helm_digest_guard.log` | Helm immutable-image guard execution log. |
| `test-results/demo_seed_guard.log` | Development-only fixture guard execution log. |
| `test-results/post_remediation_typecheck.log` | Final TypeScript check execution log. |
