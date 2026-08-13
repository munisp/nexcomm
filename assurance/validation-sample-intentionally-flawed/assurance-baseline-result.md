# Assurance Prompt Validation — Intentional Flaw Sample

## Release decision

**Status: BLOCKED.** The validation sample is intentionally constructed to make unsupported funds-flow, security, and test claims. The baseline scan identified a production TODO, a mocked test, a hard-coded secret, floating-point currency input, an optional rather than enforced idempotency key, and logging that exposes a secret. No implementation evidence supports the two checkmarked production-completion claims in `todo.md`.

| Finding ID | Severity | Evidence | Why the enhanced prompt blocks release |
|---|---|---|---|
| SAMPLE-001 | Critical | `todo.md:3` asserts an atomic, idempotent, authorized, fully audited transfer, while `src/transfer.ts` only logs and returns acceptance. | A checked capability claim has no feature manifest, durable ledger, authorization, atomic debit/credit, idempotency, audit event, reconciliation, or E2E evidence. |
| SAMPLE-002 | Critical | `src/transfer.ts:8` embeds `JWT_SECRET`; `src/transfer.ts:17` logs it. | A hard-coded credential and credential disclosure are absolute security blockers. |
| SAMPLE-003 | Critical | `src/transfer.ts:4` represents a money amount as JavaScript `number`. | The flow lacks an approved exact amount representation and therefore cannot establish currency/rounding correctness. |
| SAMPLE-004 | Critical | `src/transfer.ts:5` makes `idempotencyKey` optional, and the function does not store or check it. | Retry/duplicate requests can produce duplicate funds effects; the asserted idempotency claim is unimplemented. |
| SAMPLE-005 | High | `src/transfer.ts:10` contains a production TODO and the implementation comments admit it only “pretends” to persist. | A partial/demo critical path is a mandatory release blocker. |
| SAMPLE-006 | High | `tests/transfer.test.ts:3-4` replaces the production function with `vi.mock`. | The test does not execute the funds implementation and is prohibited as release evidence under the strict no-mocks gate. |
| SAMPLE-007 | High | `todo.md:4` claims real-dependency E2E security testing but no configuration, dependency, test, audit, or evidence exists. | The required real integration and end-to-end evidence is missing. |

## Prompt performance conclusion

The enhanced prompt correctly reaches **BLOCKED** without relying on a test-suite result. The implemented deterministic gate was executed against the fixture and returned the expected non-zero result with **seven findings**: one Blocker, two Critical findings, and four High findings. It detected the missing feature manifest, hard-coded secret, sensitive logging, floating-point money representation, production TODO, and mocked release evidence. The sample remains intentionally unfixed so it can serve as a negative regression fixture for the automated release gate; it must never be deployed or promoted as a valid implementation.

## Required remediation before a hypothetical release

A compliant implementation would require a real durable double-entry or approved authoritative ledger; exact money representation; server-side authorization; mandatory, payload-bound idempotency stored durably; database-transaction or distributed-recovery design; append-only protected audit events; secret-manager integration; no secret-bearing logs; real-dependency integration tests; E2E tests; concurrency and crash/fault injection; reconciliation; and verified feature-claim records. These are deliberately absent from the sample.
