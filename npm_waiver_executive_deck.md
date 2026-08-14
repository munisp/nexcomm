## Cover

# NEXCOMM NPM Advisory Status

## Manual Patch Plan & Security Waiver Requirements

**Executive review · Draft exception is not approval**

## Slide 1

# The audit remains blocked by 10 moderate advisories

- The audit has no critical or high advisory, but 10 moderate and 1 low remain.
- All ten moderate records reduce to six vulnerable leaf packages.
- Every leaf package has a published fixed version; the lockfile still resolves stale nested versions.

## Slide 2

# Two parent chains drive the highest remediation effort

| Chain | Vulnerable leaf | Fixed floor |
|---|---|---|
| Drizzle Kit → legacy esbuild loader | `esbuild@0.18.20` | `>= 0.25.0` |
| Temporal / gRPC / OpenTelemetry | `uuid@11.1.0`, `protobufjs@7.6.1` | `uuid >= 11.1.1`; `protobufjs >= 7.6.5` |

## Slide 3

# Manual PNPM patches preserve reproducibility

- Patch the parent manifest with `pnpm patch`; do not edit `node_modules` without committing a patch.
- Drizzle: patch `@esbuild-kit/core-utils` to require `esbuild ^0.25.0`.
- Temporal: patch `@temporalio/client`, `@grpc/proto-loader`, and `proto3-json-serializer` to require the fixed UUID/protobuf floors.
- Commit each patch with `pnpm patch-commit` and regenerate `pnpm-lock.yaml`.

## Slide 4

# Verification is the decision gate

1. Force a clean PNPM resolution.
2. Prove fixed leaves with `pnpm why` and inspect the lockfile.
3. Require `pnpm audit --json` to report zero critical, high, and moderate findings.
4. Run TypeScript and production-build validation before merge.

## Slide 5

# The waiver is narrow and time-bound

- It applies only to the enumerated local advisories in one isolated staging namespace.
- It expires after seven calendar days and cannot authorize production promotion.
- No production data, credentials, payments, ledger settlement, or public admin interfaces are permitted.
- Signed images, TLS/WAF, isolated identity, and runtime monitoring remain mandatory.

## Slide 6

# Approval requires named accountable owners

| Required approver | Decision required |
|---|---|
| Security owner | Risk acceptance or rejection |
| Engineering owner | Patch plan and completion date |
| Platform / SRE owner | Isolation and monitoring evidence |
| Risk / compliance owner | Scope and expiry confirmation |

## Slide 7

# Exit evidence closes the waiver

- Patched lockfile proves all fixed nested versions.
- Audit is zero for critical, high, and moderate severity.
- Type check and production build pass.
- Isolated staging smoke test passes without mock substitution.
- Signatories formally close the exception record.

## Closing

# No approval by default

## Remediate first. Waive only with evidence, names, scope, and expiry.
