# NPM Advisory Deep Dive and Emergency Exception Draft

**Repository:** `munisp/nexcomm`
**Audited dependency state:** latest local PNPM audit after commit `aaa2944f`
**Document status:** **DRAFT — NOT APPROVED — DOES NOT AUTHORIZE RELEASE**

## Executive Finding

The current PNPM audit reports **10 moderate** and **1 low** advisory records. The ten moderate records resolve to **six vulnerable leaf packages** across **32 unique transitive paths**. Each package has a published fixed version, but the current lockfile still resolves the vulnerable nested versions despite the declared policy in `pnpm-workspace.yaml`.

> This is a **dependency-resolution defect**, not evidence that the advisories have been remediated. The release pipeline must continue to fail until the resolved lockfile and `pnpm audit` prove the fixed versions.

## Root-Cause Graph

| Vulnerable leaf package | Moderate advisory IDs | Fixed version | Unique dependency paths | Root cause and accountable dependency edge |
|---|---|---:|---:|---|
| `esbuild@0.18.20` | 1102341 | `>= 0.25.0` | 1 | `drizzle-kit@0.31.10 → @esbuild-kit/esm-loader@2.6.5 → @esbuild-kit/core-utils@3.3.2 → esbuild@0.18.20` |
| `mdast-util-to-hast@13.2.0` | 1113048 | `>= 13.2.1` | 2 | `streamdown@2.5.0 → rehype-raw@7.0.0 → hast-util-raw@9.1.0 → mdast-util-to-hast@13.2.0`; also direct `remark-rehype` chain within Streamdown |
| `mermaid@11.16.0` | 1138099, 1138100, 1138101, 1138113 | `>= 11.16.1` | 1 | `streamdown@2.5.0 → mermaid@11.16.0` |
| `protocol-buffers-schema@3.6.0` | 1116721 | `>= 3.6.1` | 8 | `maplibre-gl@5.24.0 → pbf@4.0.1 → resolve-protobuf-schema@2.1.0 → protocol-buffers-schema@3.6.0` through MapLibre and Terra Draw paths |
| `protobufjs@7.6.1` | 1123492, 1123964 | `>= 7.6.5` | 18 | `@grpc/proto-loader@0.8.1` and `proto3-json-serializer@2.0.2`, reached by gRPC, OpenTelemetry OTLP exporters, and Temporal client chains |
| `uuid@11.1.0` | 1119441 | `>= 11.1.1` | 2 | `@temporalio/client@1.20.3 → uuid@11.1.0`; also Streamdown/Mermaid path |

The remaining **low** advisory is also Mermaid-related and is resolved by the same `mermaid >= 11.16.1` target. It is not independently waived by this draft.

## Exact Remediation Procedure

The target-version policy is already represented in `pnpm-workspace.yaml`. The current package-manager operation leaves stale nested resolutions in `pnpm-lock.yaml`, so remediation must be treated as incomplete until one of the following controlled approaches changes the actual dependency tree.

| Order | Required action | Evidence required |
|---:|---|---|
| 1 | Run `bash scripts/remediate-npm-advisories.sh`. | Generated audit JSON and build/type-check logs. |
| 2 | If stale nested versions remain, update/replace the parent edges: Drizzle legacy loader, Streamdown, MapLibre/Terra Draw, gRPC proto loader/serializer, and Temporal client. | Updated `package.json`, `pnpm-workspace.yaml`, and `pnpm-lock.yaml`. |
| 3 | Where the parent’s semver range is unnecessarily exact, create a PNPM package patch for the parent manifest and commit it under `patches/`, registered in `patchedDependencies`. | Patch file, clean install, affected service tests. |
| 4 | Run `pnpm audit --json`; require `critical = 0`, `high = 0`, and `moderate = 0`. | Immutable CI artifact. |
| 5 | Run `pnpm run check` and `pnpm run build`; if a dependency compatibility regression occurs, resolve it before release. | Immutable CI artifact. |

The current script is deliberately fail-closed. It exits nonzero whenever a moderate, high, or critical audit finding remains. It must not be changed to suppress an advisory.

## Emergency Staging Exception — Draft Only

### Purpose

This draft permits an **exception request**, not a release approval, for a short-lived isolated staging deployment while dependency parent-edge patches are completed and verified.

### Proposed Scope

| Field | Draft value |
|---|---|
| Environment | One dedicated isolated staging namespace only. |
| Allowed workload | Non-production functional validation with synthetic/non-sensitive test data only. |
| Forbidden activities | Production deployment, production credentials, customer data, real payment initiation, real ledger settlement, internet-exposed admin interfaces, and release promotion. |
| Advisory scope | Exactly the ten moderate and one low PNPM audit records listed above; no other advisory, scan finding, or live-assurance gate is waived. |
| Maximum validity | **7 calendar days** from written approval, with automatic expiry at 23:59 UTC on the named expiry date. |
| Extension | Requires a new review with updated audit output and named signatories. |

### Mandatory Compensating Controls

1. The staging namespace must use signed immutable images and the existing digest enforcement policy.
2. Ingress must enforce TLS and the existing Open-appsec/WAF path; administrative interfaces remain loopback-only or deny-listed.
3. No production Secret, customer dataset, real financial credential, or production identity federation may enter the namespace.
4. A dedicated low-privilege test account and test-only Keycloak realm/client must be used.
5. The CI job must attach the raw `pnpm audit --json`, dependency graph, source assurance result, and deployment digest list to the exception record.
6. Security monitoring must include the organization’s approved runtime logging/SIEM workflow. If Wazuh, OpenCTI, or comparable monitoring is not available, the exception cannot be approved.
7. The release pipeline must continue to block production promotion and automatically expire this exception at the specified deadline.
8. Discovery of a critical/high advisory, external exposure of an affected development service, or any exploitation indicator immediately revokes the exception.

### Approval Record

| Required approver | Name | Signature / approval reference | Date | Decision |
|---|---|---|---|---|
| Security owner | _Unassigned_ | _Required_ | _Required_ | Approve / Reject |
| Engineering owner | _Unassigned_ | _Required_ | _Required_ | Approve / Reject |
| Platform/SRE owner | _Unassigned_ | _Required_ | _Required_ | Approve / Reject |
| Risk/compliance owner | _Unassigned_ | _Required_ | _Required_ | Approve / Reject |

**Default decision:** Reject until all fields above are completed and attached evidence is reviewed.

### Exit Criteria

The exception automatically closes only when all of the following are true:

- The actual resolved lockfile contains the listed patched versions or newer compatible versions.
- `pnpm audit --json` reports zero critical, high, and moderate findings.
- The type check and production build pass on the remediated graph.
- The isolated staging smoke suite passes without a mock substitution.
- The named approvers record closure in the exception system.

## References

The package versions, advisory IDs, fixed-version bounds, and paths in this document are extracted from the repository’s `pnpm audit --json` output and the generated root-cause graph. The source files `test-results/npm_moderate_advisory_graph.json` and `test-results/npm_moderate_root_causes.json` are the supporting evidence.
