# Checkov Closure and NPM Security Remediation Report

**Author:** Manus AI
**Scope:** Helm chart, portal runtime configuration, PNPM dependency graph, and focused validation
**Result:** **58 of the original 87 Checkov findings are closed in the rendered analysis manifest.** The remaining 29 `CKV_K8S_43` findings are intentionally blocked on real, CI-produced image digests; no placeholder digest was invented.

> The secured staging chart now fails before rendering when an image is provided by mutable tag. This is the correct fail-closed outcome until CI supplies real signed `@sha256:` image references for all 29 services.

## Verified Closure Summary

| Original control | Initial count | Current rendered-analysis count | Status | Implemented patch |
|---|---:|---:|---|---|
| `CKV_K8S_35` — prefer secret files over secret environment variables | 29 | **0** | Closed in generic chart | Replaced `secretKeyRef` environment injection with `_FILE` variables plus an itemized, read-only Secret volume. |
| `CKV_K8S_40` — run containers as a high UID | 29 | **0** | Closed in generic chart | Set pod security context to UID/GID/FSGroup `10001`; retained non-root, default seccomp, dropped capabilities, and non-escalation. |
| `CKV_K8S_43` — use image digests | 29 | **29** | Awaiting real CI artifacts | Existing chart guard and Gatekeeper policy reject tags. Actual image digests cannot be guessed or safely fabricated. |
| High-severity `pnpm audit` advisories | 21 | **0** | Closed | Updated direct dependencies and a maintained Workbox build chain; lockfile and workspace policy were regenerated. |

## Exact Code Patches

### Secret files (`CKV_K8S_35`)

The reusable generic deployment template now mounts the named Kubernetes Secret as a read-only projected volume and exposes file paths rather than secret values:

```yaml
# infra/helm/nexcom/templates/deployments.yaml
- name: DATABASE_URL_FILE
  value: {{ printf "%s/DATABASE_URL" $g.secretFiles.mountPath | quote }}
...
volumeMounts:
  - name: service-secrets
    mountPath: {{ $g.secretFiles.mountPath | quote }}
    readOnly: true
volumes:
  - name: service-secrets
    secret:
      secretName: {{ $g.secretName }}
      defaultMode: {{ $g.secretFiles.defaultMode }}
      items:
        {{- range $g.secretFiles.keys }}
        - key: {{ . }}
          path: {{ . }}
        {{- end }}
```

The global values contract declares the projected key set and mount mode:

```yaml
# infra/helm/nexcom/values.yaml
global:
  secretFiles:
    mountPath: /var/run/secrets/nexcom
    defaultMode: 0400
    keys:
      - DATABASE_URL
      - POSTGRES_URL
      - JWT_SECRET
      - REDIS_URL
      - KAFKA_BROKERS
      - KEYCLOAK_CLIENT_SECRET
      - KEYCLOAK_ADMIN_CLIENT_ID
      - KEYCLOAK_ADMIN_CLIENT_SECRET
      - APISIX_ADMIN_KEY
```

The primary Node service now resolves `NAME_FILE` before `NAME` through `valueFromEnvironmentOrFile` in `server/_core/env.ts`. It supports mounted database, JWT, Redis, Keycloak client, OpenAI/LLM, AWS, internal, and PostgreSQL settings without fallback when a requested secret file cannot be read.

> **Runtime completion condition:** Every non-Node service image must adopt the same `NAME_FILE` convention before its staging deployment is updated to this chart version. The Helm manifest is secure and passes Checkov; service owners must not retain assumptions that the raw secret-valued variables still exist.

### High UID (`CKV_K8S_40`)

```yaml
# infra/helm/nexcom/values.yaml
global:
  securityContext:
    runAsUser: 10001
    runAsGroup: 10001
    fsGroup: 10001

# infra/helm/nexcom/templates/deployments.yaml
securityContext:
  runAsNonRoot: true
  runAsUser: {{ $g.securityContext.runAsUser }}
  runAsGroup: {{ $g.securityContext.runAsGroup }}
  fsGroup: {{ $g.securityContext.fsGroup }}
  seccompProfile:
    type: RuntimeDefault
```

The container retains the existing `allowPrivilegeEscalation: false`, `readOnlyRootFilesystem: true`, and `capabilities.drop: ["ALL"]` controls. Before staging rollout, each image must verify ownership of its writable `emptyDir`/PVC paths under UID/GID `10001`.

### Immutable images (`CKV_K8S_43`)

The existing chart guard remains the authoritative deployment policy:

```gotemplate
{{- if contains "@sha256:" $svc.image.name }}
image: {{ $svc.image.name }}
{{- else }}
{{- if $g.requireImageDigest }}
{{- fail (printf "service %s requires image.name to be a full immutable @sha256 reference" $name) }}
{{- end }}
image: {{ $g.imageRegistry }}/{{ $svc.image.name }}:{{ $g.imageTag }}
{{- end }}
```

`infra/policies/gatekeeper/require-image-digests.yaml` supplies a complementary admission control. Secure staging currently refuses to render because the values do not contain 29 real digests. This was verified with:

```text
Error: service nexcom-exchange requires image.name to be a full immutable @sha256 reference
HELM_DIGEST_GATE_EXIT_CODE=1
```

To close the remaining 29 findings, CI must replace each `image.name` with a real immutable value, for example:

```yaml
nexcomExchange:
  image:
    name: registry.example/nexcom/nexcom-exchange@sha256:<CI_PRODUCED_DIGEST>
```

No release may use `<CI_PRODUCED_DIGEST>` literally. It must be the digest emitted by the build-and-sign job for that exact image.

## Focused NPM Security Fix

The package graph was updated with a direct Axios upgrade, maintained PWA build dependencies, and PNPM workspace overrides for advisory-affected transitive paths.

| Package or chain | Remediation |
|---|---|
| `axios` | Raised direct dependency to `^1.18.0`. |
| `vite-plugin-pwa` and Workbox | Updated to `^1.3.0`, added `workbox-build@^7.4.1` as an explicit development dependency, replacing the old Rollup terser chain. |
| `follow-redirects`, `form-data`, `protobufjs`, `brace-expansion`, `ip-address`, `nanoid`, `path-to-regexp`, `serialize-javascript` | Added targeted PNPM overrides in `pnpm-workspace.yaml`. |
| PNPM policy location | Moved overrides and the existing Wouter patch declaration from the ignored `package.json` `pnpm` field into `pnpm-workspace.yaml`. |

The final dependency audit reports **0 critical, 0 high, 11 moderate, and 1 low** advisory records. The moderate and low findings remain visible and were not suppressed.

## Day-by-Day Completion Plan

| Day | Owner | Exact work | Exit criterion |
|---|---|---|---|
| **Day 0 — completed** | Platform / application | Apply the generic secret-file template, high UID values, and Node `_FILE` loader. | Rendered chart has 0 failed `CKV_K8S_35` and 0 failed `CKV_K8S_40`. |
| **Day 0 — completed** | Application | Update PNPM policy, Axios, PWA, and Workbox build chain. | `pnpm audit` has 0 high and 0 critical advisories; type check and production build pass. |
| **Day 1** | CI / registry | Build every service image under UID/GID `10001`; run smoke tests for `/tmp`, application caches, mounted certificate paths, and any PVC write locations. | Each image can run with read-only root FS and UID `10001`. |
| **Day 1–2** | CI / release engineering | Generate SBOM, vulnerability scan, signature, and digest for all 29 images. Publish immutable `registry/image@sha256:…` references to a protected release manifest. | A signed digest manifest contains one real digest per workload. |
| **Day 2** | Platform | Substitute the 29 digest references into secured staging values; do not use `--set global.requireImageDigest=false`. | Normal secured Helm render succeeds; deliberate tag-only render fails. |
| **Day 2–3** | Service owners | Add `NAME_FILE` configuration support to each Go, Rust, Python, and worker image still reading raw variables. Remove raw secret variables from their deployment docs and tests. | Each service starts from mounted files; no secret is exposed in container environment inspection. |
| **Day 3** | Security engineering | Render with real digests and run Checkov plus Gatekeeper negative admission tests. | `CKV_K8S_43` falls from 29 to 0; all 87 original findings are closed. |
| **Day 4** | Staging operations | Deploy to staging, rotate migrated secrets, validate Keycloak, Permify, Temporal, Dapr, Redis, Kafka, TigerBeetle, and Fluvio connection paths. | Live health and authorization checks pass without fallback behavior. |
| **Day 5** | Security engineering | Run authorized low-impact ZAP baseline and authenticated tests with WAF/SIEM monitoring. | Staging runtime security findings are triaged with evidence; no destructive tests are run. |

## Verification Evidence

| Check | Result |
|---|---|
| Portal TypeScript check after dependency fix | **Pass** (`TYPECHECK_EXIT_CODE=0`) |
| Portal production build after dependency fix | **Pass** (`BUILD_EXIT_CODE=0`) |
| Final `pnpm audit` high/critical | **0 high; 0 critical** |
| Rendered Checkov `CKV_K8S_35` | **0 failed** |
| Rendered Checkov `CKV_K8S_40` | **0 failed** |
| Rendered Checkov `CKV_K8S_43` | **29 failed** — real digests not yet supplied |
| Secure staging Helm tag rejection | **Pass** — expected fail-closed render rejection |

## Attached Evidence Paths

- `test-results/pnpm_audit_high_closed_summary.json`
- `test-results/final_dependency_build_summary.txt`
- `test-results/checkov_post_closure_actual_summary.txt`
- `test-results/staging_digest_gate.log`
- `test-results/rendered_checkov_control_inspection.txt`
- `pnpm-workspace.yaml`
- `infra/helm/nexcom/templates/deployments.yaml`
- `infra/helm/nexcom/values.yaml`
- `server/_core/env.ts`
