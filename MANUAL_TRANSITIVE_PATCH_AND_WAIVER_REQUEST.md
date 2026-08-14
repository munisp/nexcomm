# Manual Transitive Patch Procedure and Security Waiver Request

**Repository:** `munisp/nexcomm`
**Status:** Operator procedure and approval-request template
**Scope:** Remaining moderate PNPM advisories on the Drizzle and Temporal dependency chains

> **Important:** This procedure does not suppress an advisory. A patch is successful only when the resulting lockfile resolves a fixed version, `pnpm audit --json` reports zero moderate/high/critical findings, and the type check plus production build pass.

## 1. Preconditions

Use a clean branch and the project’s pinned package manager. Preserve the generated patch files and lockfile in source control.

```bash
cd /home/ubuntu/nexcomm
git switch -c security/patch-transitive-npm-advisories
git status --short
pnpm --version
pnpm install --frozen-lockfile
```

Before patching, capture the actual installed dependency paths:

```bash
pnpm why esbuild --depth 6
pnpm why uuid --depth 6
pnpm why protobufjs --depth 6
pnpm audit --json > test-results/npm-audit-before-patches.json || true
```

## 2. Drizzle / Esbuild Manual Patch

The affected path is:

```text
Drizzle Kit → @esbuild-kit/esm-loader → @esbuild-kit/core-utils → esbuild@0.18.20
```

The advisory requires `esbuild >= 0.25.0`. Apply a package patch to the exact parent package reported by `pnpm why`.

```bash
pnpm patch @esbuild-kit/core-utils@3.3.2
```

The command prints an editable directory. In that directory, edit `package.json` so the dependency constraint for `esbuild` is at least the fixed floor:

```json
{
  "dependencies": {
    "esbuild": "^0.25.0"
  }
}
```

Commit the edited package back into PNPM’s reproducible patch registry. Substitute the directory printed by `pnpm patch`.

```bash
pnpm patch-commit /absolute/path/printed/by/pnpm-patch
```

This creates a patch under `patches/` and records it under `patchedDependencies` in the package-manager configuration. Do not edit the virtual store directly without creating this committed patch.

## 3. Temporal / gRPC / Protobuf Manual Patches

The affected Temporal paths are:

```text
@temporalio/client → uuid@11.1.0
@temporalio/client → @grpc/grpc-js → @grpc/proto-loader → protobufjs@7.6.1
@temporalio/client → @temporalio/common → proto3-json-serializer → protobufjs@7.6.1
OpenTelemetry OTLP exporters → @grpc/proto-loader → protobufjs@7.6.1
```

The fixed floors are `uuid >= 11.1.1` and `protobufjs >= 7.6.5`. Patch each parent that retains a vulnerable nested resolution.

### 3.1 Temporal Client UUID

```bash
pnpm patch @temporalio/client@1.20.3
```

In the printed edit directory, change the `uuid` dependency to:

```json
{
  "dependencies": {
    "uuid": "^11.1.1"
  }
}
```

Then commit the patch:

```bash
pnpm patch-commit /absolute/path/printed/by/pnpm-patch
```

### 3.2 gRPC Proto Loader Protobuf

```bash
pnpm patch @grpc/proto-loader@0.8.1
```

In the printed edit directory, change the `protobufjs` dependency to:

```json
{
  "dependencies": {
    "protobufjs": "^7.6.5"
  }
}
```

Commit it:

```bash
pnpm patch-commit /absolute/path/printed/by/pnpm-patch
```

### 3.3 Temporal Serializer Protobuf

```bash
pnpm patch proto3-json-serializer@2.0.2
```

In the printed edit directory, change the `protobufjs` dependency to:

```json
{
  "dependencies": {
    "protobufjs": "^7.6.5"
  }
}
```

Commit it:

```bash
pnpm patch-commit /absolute/path/printed/by/pnpm-patch
```

## 4. Regenerate, Verify, and Commit

Force a clean resolution so stale nested lockfile entries cannot survive the patch set.

```bash
pnpm install --force --no-frozen-lockfile
pnpm why esbuild --depth 6
pnpm why uuid --depth 6
pnpm why protobufjs --depth 6
pnpm audit --json > test-results/npm-audit-after-patches.json || true
jq '.metadata.vulnerabilities' test-results/npm-audit-after-patches.json
pnpm run check
pnpm run build
git diff --check
git add package.json pnpm-workspace.yaml pnpm-lock.yaml patches/
git commit -m "security: patch vulnerable transitive npm dependencies"
```

**Acceptance criteria:** The audit must report zero `critical`, `high`, and `moderate` findings. If any vulnerable nested version remains, stop and either patch the remaining parent package or upgrade/replace the parent dependency. Do not merge a partial result.

---

# Formal Security Risk-Acceptance and Waiver Approval Request

**Document status:** `DRAFT — NOT APPROVED — NOT A RELEASE AUTHORIZATION`

## A. Request Metadata

| Field | Required entry |
|---|---|
| Exception ID | Assigned by the risk-management system |
| Request date | YYYY-MM-DD |
| Requesting engineering owner | Name and team |
| Service / repository | `munisp/nexcomm` |
| Environment requested | Isolated staging namespace only |
| Requested start / expiry | Start date; expiry no later than seven calendar days later |
| Related remediation branch / commit | Immutable commit SHA |
| Linked issue / change request | Required tracking reference |

## B. Exception Scope

This request covers **only** the following local PNPM audit records while manual parent-package patches are completed and verified:

| Leaf package | Moderate advisory IDs | Required fixed version |
|---|---|---:|
| `esbuild` | 1102341 | `>= 0.25.0` |
| `mdast-util-to-hast` | 1113048 | `>= 13.2.1` |
| `mermaid` | 1138099, 1138100, 1138101, 1138113 | `>= 11.16.1` |
| `protocol-buffers-schema` | 1116721 | `>= 3.6.1` |
| `protobufjs` | 1123492, 1123964 | `>= 7.6.5` |
| `uuid` | 1119441 | `>= 11.1.1` |

The associated low Mermaid advisory is not separately exempted; it must be resolved by the same patch.

## C. Explicit Prohibitions

The exception **does not permit** production deployment, production data, customer data, production credentials, real payment initiation, real ledger settlement, production identity federation, public administrative interfaces, or promotion to production.

## D. Required Compensating Controls

| Control | Evidence attachment required |
|---|---|
| Isolated staging only | Namespace, network-policy, and ingress evidence |
| Signed immutable images | CI digest list and signature-verification record |
| No production data or Secrets | Secret provenance attestation |
| TLS and WAF protection | Ingress/TLS and Open-appsec policy evidence |
| Runtime monitoring | Approved SIEM/runtime-monitoring evidence; Wazuh or an equivalent control |
| Authorization isolation | Test-only Keycloak realm/client and low-privilege account evidence |
| Automatic expiry | Pipeline exception-expiry control and UTC timestamp |
| No promotion path | Production-promotion block demonstrated in CI |

## E. Risk Statement

The requestor acknowledges that the current lockfile resolves vulnerable transitive packages despite available fixed versions. The expected exposure depends on execution paths and staging isolation, but the risk is **not eliminated**. The requestor accepts that the exception is invalid if a critical/high finding appears, a compensating control fails, the scope changes, or the expiry is reached.

## F. Remediation Commitment

| Milestone | Due date | Owner | Verification evidence |
|---|---|---|---|
| Patch Drizzle / esbuild path | Required | Engineering owner | Committed PNPM patch and clean audit |
| Patch Temporal / gRPC / protobuf paths | Required | Engineering owner | Committed PNPM patches and clean audit |
| Patch remaining Streamdown / MapLibre paths | Required | Engineering owner | Committed patch or parent upgrade |
| Run type check and production build | Required | CI owner | Immutable CI logs |
| Close exception | Before expiry | Security owner | Audit at zero moderate/high/critical |

## G. Required Approvals

| Approver | Name | Approval reference / signature | Date | Decision |
|---|---|---|---|---|
| Security owner | _Unassigned_ | _Required_ | _Required_ | Approve / Reject |
| Engineering owner | _Unassigned_ | _Required_ | _Required_ | Approve / Reject |
| Platform / SRE owner | _Unassigned_ | _Required_ | _Required_ | Approve / Reject |
| Risk / compliance owner | _Unassigned_ | _Required_ | _Required_ | Approve / Reject |

**Default disposition:** Reject. The exception becomes active only after all four approvals, all compensating-control evidence, and an explicit expiry timestamp are recorded in the organization’s approval system.
