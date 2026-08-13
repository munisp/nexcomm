# Offline OWASP-Aligned Security Simulation and Checkov Remediation Plan

**Scope:** This assessment substitutes offline security simulation for a live staging penetration test because this workspace has no authorized reachable staging URL, Kubernetes context, Docker runtime, or scanner runtime. It combines static analysis, dependency analysis, rendered-manifest review, configuration inspection, and targeted source validation.
**Author:** Manus AI
**Status:** **Not a live penetration test.** No HTTP traffic, crawl, authentication flow, exploit attempt, or active scan was sent to a staging system.

> A live OWASP ZAP baseline or authenticated scan remains required after an authorized staging URL and dedicated low-privilege test account are supplied. The evidence in this report must not be interpreted as proof of live runtime security.

## Executive Summary

The offline simulation verified several security controls and uncovered two additional high-risk implementation gaps: a gateway WebSocket endpoint generated plausible market prices in-process, and the APISIX management configuration exposed static credentials with an unrestricted allowlist. Both have been remediated in source. A focused Semgrep rescan of the highest-risk application paths returned **zero findings** after the remediation.

The rendered Helm chart Checkov assessment remains at **87 open findings**, all in three repeated controls across the same 29 workloads. The chart’s production/staging digest policy blocks an actual secure deployment without immutable references; the 29 `CKV_K8S_43` results arise because the chart had to be rendered with its digest guard disabled to permit static inspection.

| Assessment area | Result | Interpretation |
|---|---:|---|
| Live staging reachability | **Blocked** | No staging endpoint variables, cluster access, Docker runtime, or ZAP installation were available. |
| OWASP Semgrep scan, high-risk code scope | **Pass after remediation** | 142 files, 116 rules, 0 remaining findings after targeted fixes. |
| JavaScript dependency audit | **Open** | 54 advisory records: 21 high, 31 moderate, 2 low; no critical advisories. |
| Rendered Checkov scan | **Open** | 2,529 passed, 87 failed, 0 skipped, 0 parsing errors over 100 resources. |
| Focused silent-mockware scan | **Pass** | No defined mock token, allow-all, fail-open, local-ledger/workflow, or synthetic-price marker remains in active paths. |
| Gateway API package compile check | **Pass** | Modified Go API package compiled after WebSocket and proxy hardening. |

## Offline Simulation Method

| OWASP-aligned area | Offline method | Evidence and limitation |
|---|---|---|
| Broken access control | Reviewed Keycloak, Permify, protected procedure, rate-limit, and APISIX configuration paths. | Existing fail-closed changes were verified statically; no real identity provider or authorization policy was exercised. |
| Cryptographic failures | Examined cookie/CSRF/header middleware and Semgrep crypto findings. | The only SHA-1 finding was RFC 6455 WebSocket handshake derivation, not a signature/hash for security decisions. |
| Injection and unsafe parsing | Semgrep scanned gateway, router, authorization, and trading paths. | Two proxy deserialization warnings were fixed with validated `json.RawMessage` forwarding. |
| Insecure design / mockware | Targeted scan for generated market data and success-like fallback paths. | A synthetic WebSocket ticker broadcaster was removed; it had produced plausible tickers every two seconds. |
| Security misconfiguration | Reviewed Compose ports, APISIX/open-appsec, dashboard, ingress, Helm security contexts, and Checkov output. | No live listener or TLS behavior could be validated. |
| Vulnerable components | `pnpm audit --json` against the installed lockfile. | Covers JavaScript dependencies only; Go/Rust/Python image and OS package SBOM scanning remains required. |
| Identification and authentication failures | Reviewed session/cookie/CSRF/rate-limit middleware and APISIX management access. | No actual OIDC login/session-flow test was possible. |

## Remediated Findings Discovered During the Simulation

### 1. Synthetic WebSocket market-data stream — remediated

`gateway-service/internal/api/proxy_handlers.go` contained `startMarketDataTicker`, which emitted random-looking prices and volumes for GOLD, CRUDE, COCOA, COFFEE, and COTTON every two seconds. The endpoint could therefore appear connected to live market data despite no authoritative source.

The generator, shared client map, and WebSocket registration flow were removed. `wsMarketData` now returns **HTTP 503** with `authoritative market-data stream unavailable` until an authoritative Fluvio-backed stream is connected. This is fail-closed behavior: it cannot be confused with a successful data feed.

### 2. Gateway proxy unsafe generic JSON parsing — remediated

`proxyGet` and `proxyPost` decoded upstream JSON into `interface{}` before returning it. The implementation now checks JSON validity and forwards it as `json.RawMessage`; non-JSON responses remain raw. This removes the Semgrep unsafe-deserialization finding while preserving upstream payload semantics.

### 3. APISIX management/dashboard exposure — remediated in source

The gateway Compose configuration previously exposed the APISIX Admin API and Prometheus port on all host interfaces, exposed the dashboard port on all interfaces, allowed `0.0.0.0/0`, and committed dashboard JWT/user credentials.

The applied patch binds APISIX Admin API (`9180`), APISIX metrics (`9091`), dashboard (`9000`), and Grafana (`3001`) to `127.0.0.1`. The dashboard is now behind an explicit `management` profile. Its global allowlist is local-only and its credentials are replaced by required runtime variables; Grafana also requires an explicitly provided administrator password.

APISIX configuration supports environment-derived configuration with its documented `$\{\{VARIABLE:=\}\}` form.[1] The dashboard deployment is disabled by default because the project uses the legacy Dashboard image; validate the runtime interpolation behavior in an isolated management environment before enabling it. If that legacy image does not resolve environment variables in mounted configuration, generate the configuration file from a Kubernetes Secret or a local untracked configuration file at startup—do not restore committed credentials.

### 4. Semgrep findings after remediation — zero remaining

The initial high-risk Semgrep run found three warnings:

| Initial rule | Location | Disposition |
|---|---|---|
| `use-of-sha1` | WebSocket handshake | Documented RFC 6455 compatibility exception. SHA-1 derives only `Sec-WebSocket-Accept`; it is not used for signing, passwords, or authorization. |
| Unsafe interface deserialization | `proxyGet` | Replaced with JSON validation and raw JSON forwarding. |
| Unsafe interface deserialization | `proxyPost` | Replaced with JSON validation and raw JSON forwarding. |

The post-remediation rescan returned **0 errors and 0 findings**. The SHA-1 exception is scoped in source and documents the protocol requirement rather than suppressing a general cryptographic concern.

## Detailed Breakdown of the 87 Open Checkov Findings

All 87 records affect the same 29 Deployments. The checks are not hidden or skipped.

| Check ID | Control | Count | Affected workloads | Risk and required remediation |
|---|---|---:|---|---|
| `CKV_K8S_35` | Prefer secrets as files over environment variables | 29 | All workloads below | Environment variables can leak through process inspection, crash diagnostics, debug endpoints, and misconfigured telemetry. Migrate sensitive inputs to projected Secret volumes or a Secrets Store CSI driver and expose only file paths in env. |
| `CKV_K8S_40` | Containers should run as a high UID | 29 | All workloads below | The current non-root UID `1000` is safer than root but can collide with host or mounted-volume identities. Rebuild images with a high dedicated UID, such as `10001`, and set ownership for required writable paths. |
| `CKV_K8S_43` | Images should use digests | 29 | All workloads below | The analysis render used a temporary digest-guard override because the repository does not contain real CI-built digest references. Secured staging normally fails to render without full `@sha256:` references and Gatekeeper denies tag-only workloads. Supply signed digest references in CI, render normally, and rerun Checkov. |

### Affected Workloads (29 per Check)

| Workload | `CKV_K8S_35` | `CKV_K8S_40` | `CKV_K8S_43` |
|---|:---:|:---:|:---:|
| ai-ml | Yes | Yes | Yes |
| aml-alert-subscriber | Yes | Yes | Yes |
| analytics | Yes | Yes | Yes |
| analytics-engine | Yes | Yes | Yes |
| blockchain | Yes | Yes | Yes |
| bot-logic | Yes | Yes | Yes |
| channel-gateway | Yes | Yes | Yes |
| core-banking | Yes | Yes | Yes |
| credit-scoring | Yes | Yes | Yes |
| crypto-guard | Yes | Yes | Yes |
| ddos-guard | Yes | Yes | Yes |
| fluvio-sidecar | Yes | Yes | Yes |
| fraud-engine | Yes | Yes | Yes |
| indices | Yes | Yes | Yes |
| ingestion-engine | Yes | Yes | Yes |
| kyc-service | Yes | Yes | Yes |
| market-data | Yes | Yes | Yes |
| matching-engine | Yes | Yes | Yes |
| middleware-hub | Yes | Yes | Yes |
| mojaloop-adapter | Yes | Yes | Yes |
| nexcom-exchange | Yes | Yes | Yes |
| notification | Yes | Yes | Yes |
| opensearch-sync | Yes | Yes | Yes |
| pbac | Yes | Yes | Yes |
| risk-management | Yes | Yes | Yes |
| temporal-workers | Yes | Yes | Yes |
| trading-engine | Yes | Yes | Yes |
| user-management | Yes | Yes | Yes |
| ussd-engine | Yes | Yes | Yes |

## Recommended Remediation Timeline

The timeline below assumes a dedicated platform/security engineer, service owners available for configuration-file migration, and a CI registry capable of producing signed images. It is a recommended sequencing plan, not a claim of completed work.

| Window | Workstream | Deliverable and exit criteria | Findings closed |
|---|---|---|---:|
| **Day 0–1** | Registry and release controls | CI emits SBOMs and signed image digests; deployment values are populated with the 29 real `@sha256:` references; normal secured Helm render succeeds; Gatekeeper rejection test for a tag-only image passes. | 29 `CKV_K8S_43` |
| **Day 0–2** | Dependency incident triage | Resolve the 21 high and 31 moderate JavaScript advisories by upgrading direct dependencies, applying tested PNPM overrides for transitive chains, and regenerating the lockfile. Prioritize `axios`/`follow-redirects`, `form-data`, `protobufjs`, `ip-address`, and `path-to-regexp` paths. | Dependency audit backlog |
| **Days 2–5** | Secret-file migration foundation | Deploy External Secrets or Secrets Store CSI, define one secret-volume contract per workload, and add file-path configuration support to the platform library. Validate no secret value appears in `env`, logs, or `/proc/<pid>/environ`. | Foundation for 29 `CKV_K8S_35` |
| **Days 5–8** | Service secret migration | Migrate the 29 workload definitions and their runtime loaders to projected files. Rotate every migrated secret after rollout. Checkov must report zero `CKV_K8S_35` records. | 29 `CKV_K8S_35` |
| **Days 5–9** | High-UID image hardening | Change Dockerfiles/images to a high non-root UID/GID, update writable `emptyDir`/PVC ownership and `fsGroup`, and perform smoke tests for data writes, certificates, caches, and sidecars. | 29 `CKV_K8S_40` |
| **Day 10** | Compliance gate | Render with actual CI digests, run Checkov, manifest schema validation, and policy tests. Required result: zero 87 original findings and zero parsing errors. | All 87 |
| **Days 10–12** | Authorized live DAST | Run OWASP ZAP baseline then authenticated scan against staging with a dedicated low-privilege account, documented rate limits, WAF monitoring, and a rollback plan. | Runtime validation |

## Dependency-Audit Remediation Priorities

The JavaScript audit found no critical advisories but **21 high**, **31 moderate**, and **2 low** advisory records. The high-severity set includes advisories in `axios`, `follow-redirects`, `form-data`, `protobufjs`, `brace-expansion`, `ip-address`, and `nanoid` dependency paths. `axios` and redirect handling should be prioritized because the platform uses outbound service integrations and custom authentication headers are especially sensitive on redirect boundaries.

Do not apply bulk `--force` upgrades to a financial platform. Upgrade direct packages first, use exact PNPM overrides only after compatibility tests, then rerun `pnpm run check`, the gateway/trading compilations, integration tests, and `pnpm audit`.

## Live-Staging OWASP ZAP Workaround and Gate

The only sound workaround for the unavailable staging target was the offline simulation above. It does **not** test response headers, TLS negotiation, CORS behavior, WAF detection, redirect behavior, authentication sessions, CSRF enforcement, or authorization controls at runtime.

When staging is available, use a low-impact ZAP baseline first: passive crawl and passive rule checks only, rate-limited to a dedicated test window. Then use an authenticated scan with a non-administrative account and explicit exclusions for payment/settlement, destructive mutations, load generation, database reset routes, third-party callbacks, and production-like credentials. Capture APISIX/open-appsec/Wazuh logs during the test. APISIX recommends restricting Admin API access using an allowlist and managing admin keys securely.[2]

## Evidence Files

| File | Contents |
|---|---|
| `test-results/staging_pen_test_preflight.log` | Absence of reachable staging/configuration access. |
| `test-results/semgrep_owasp_top_ten.json` | Initial high-risk OWASP Semgrep findings. |
| `test-results/semgrep_owasp_top_ten_post_remediation.json` | Post-remediation Semgrep output. |
| `test-results/semgrep_owasp_post_remediation_summary.json` | Zero-finding post-remediation summary. |
| `test-results/pnpm_audit.json` | Raw dependency vulnerability audit. |
| `test-results/pnpm_audit_summary.json` | Dependency audit severity and path summary. |
| `test-results/checkov/rendered_manifest/summary.json` | Checkov aggregate result. |
| `test-results/checkov/rendered_manifest/failed_resources_detail.txt` | Every workload/check combination in the 87 records. |
| `test-results/gateway_market_data_and_proxy_validation.log` | Gateway source and compile validation. |
| `test-results/focused_silent_mockware_scan.txt` | Focused active-source silent-mockware pass. |

## References

[1] [Apache APISIX — Configuration based on environments](https://apisix.apache.org/docs/apisix/profile/)

[2] [Apache APISIX — Dashboard administration and access restriction](https://apisix.apache.org/docs/apisix/dashboard/)
