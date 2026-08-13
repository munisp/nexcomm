# Concurrent Remediation-Ledger Controls

## The core rule

Multiple agents or engineers may fix different findings concurrently, but they must not independently declare the combined branch releaseable. A `VERIFIED_FIXED` record is valid only for the exact commit and dependency graph on which its evidence ran. Any later change to a shared component, contract, schema, migration, configuration, dependency lockfile, or relevant test fixture can invalidate that verification and requires re-testing before release.

> The ledger prevents **unaddressed discovered findings** from being lost during concurrent work. The final merge-candidate gate prevents a locally valid fix from being relied on after another branch changes its assumptions.

## 1. Use stable identifiers, versions, and immutable baseline evidence

Create the ledger from the initial assurance report and preserve that report. Every record must have a stable finding ID; a source path/line alone is insufficient because code moves. The ledger must also identify the initial report hash, baseline commit, current record version, dependencies, affected paths, evidence commit, and state.

```json
{
  "schemaVersion": 1,
  "baseline": {
    "commit": "<initial-commit-sha>",
    "assuranceReportSha256": "<hash-of-baseline-report>",
    "generatedAtUtc": "<timestamp>"
  },
  "findings": [
    {
      "id": "ASSURANCE-0001",
      "state": "TRIAGED",
      "severity": "HIGH",
      "rootCauseGroup": "idempotency-contract",
      "baselineFingerprint": "<detector-rule-and-affected-path-hash>",
      "ledgerVersion": 3,
      "dependsOn": [],
      "blocks": ["ASSURANCE-0007", "ASSURANCE-0019"],
      "affectedPaths": ["server/payments/transfer.ts", "tests/transfer.integration.ts"],
      "verification": null,
      "owner": "remediation-lane-payments"
    }
  ]
}
```

The initial report is the completeness denominator. The ledger verifier compares all finding IDs in the current and baseline reports to the ledger. A finding may not disappear merely because a source line changed, a scanner was modified, a file was excluded, or a report was overwritten. A renamed/superseded finding must retain a `supersedes`/`supersededBy` chain and proof that the same behavior was re-evaluated.

## 2. Partition by root cause and interface boundary, not by arbitrary file list

Assign concurrent work by **root cause group** and system boundary. The owner of a shared authorization middleware, schema migration, ledger invariant, generated contract, workflow definition, lockfile, or deployment configuration must be identified before dependent feature lanes begin their final verification.

| Work type | Concurrency policy | Reason |
|---|---|---|
| Independent leaf feature with no shared contract/state | May proceed in parallel in separate branches/worktrees. | The blast radius can be contained and independently tested. |
| Shared library, authorization layer, data model, API/event schema, workflow, migration, dependency lockfile, runtime/deployment configuration | Serialize the change or designate one integration owner. | Independent edits can create semantic conflicts despite a clean textual merge. |
| Database migrations/backfills/rollback plans | Serialize in migration order and test the combined migration chain. | Migration ordering and mixed-version compatibility are global constraints. |
| Funds/ledger, reconciliation, idempotency, pricing, access-control policy | Serialize root-cause changes; allow dependent test additions in parallel only after the invariant owner publishes a reviewed interface. | A local fix can violate global conservation, ordering, or authorization invariants. |
| Documentation/claim evidence | Update through a protected integration branch or generate the canonical ledger from per-finding records. | A single editable ledger file otherwise becomes a merge-conflict and evidence-loss hotspot. |

## 3. Avoid concurrent writes to one ledger file

Use one of the following patterns. Do not allow multiple agents to hand-edit the same monolithic table and resolve merge conflicts by choosing one side.

| Pattern | Implementation | Best use |
|---|---|---|
| Per-finding records | Store `assurance/remediation-ledger/ASSURANCE-0001.json`, one file per ID; generate `remediation-ledger.json` deterministically in CI. | Recommended for large remediation programs. |
| Single ledger with ownership lock | Give one designated ledger integrator responsibility for merges; agents submit evidence updates as reviewed patches. | Small teams or short-lived programs. |
| External tracked system | Use an immutable change-controlled issue/evidence system and export a signed/versioned ledger snapshot to the repository. | Regulated programs with a mature evidence platform. |

For local parallel work, use separate worktrees to prevent uncommitted changes from crossing lanes.

```bash
git worktree add ../repo-payments assurance/fix-payments
git worktree add ../repo-auth assurance/fix-auth
# Each lane creates commits only in its own worktree and never force-pushes shared history.
```

## 4. Enforce state-transition and evidence invariants

The ledger validator must reject invalid state changes. At a minimum it must enforce the following rules.

| Rule | Enforcement |
|---|---|
| Stable completeness denominator | Every baseline/current detector finding has exactly one ledger record or an explicit, reviewed supersession mapping. |
| No duplicate ownership | A finding has one active remediation owner/lane; transfers record who transferred it and why. |
| Legal transitions only | `DISCOVERED → TRIAGED → IMPLEMENTING → REGRESSION_PROVEN → RETESTING → VERIFIED_FIXED`; an invalidated entry returns to `TRIAGED` or `RETESTING`. |
| No unverifiable closure | `VERIFIED_FIXED` must contain the exact verified commit, detector command/output hash, regression test ID/result, and affected-suite evidence. |
| No hidden dependency | A record cannot close while its declared prerequisite/root-cause record is unresolved. |
| No stale verification | If `verification.commit` is not an ancestor of the merge candidate, or a listed affected path/dependency changed after verification, the record is automatically reopened. |
| No unresolved release | Any record not `VERIFIED_FIXED`, including `EXTERNAL_BLOCKED`, causes the CI release blocker to fail. |

A practical transition record is append-only: store the prior state, new state, actor, UTC timestamp, reason, commit SHA, evidence hashes, and reviewer. Append-only history makes it possible to investigate who closed a finding and whether a later change invalidated the closure.

## 5. Rebase, re-test, and re-open after every shared change

A local test run only validates one branch snapshot. Before a lane’s finding may be closed, rebase or merge the current integration branch, inspect the diff, and re-run the original detector and all affected tests. After integration, the merge queue or protected integration branch must execute the full assurance gate again on the **combined merge candidate**.

```bash
# In a remediation lane, before requesting closure:
git fetch origin
git rebase origin/assurance/integration
pnpm run assurance:gate
pnpm run check
pnpm run test
# Run required real-dependency/E2E evidence for the affected flow.
```

If a shared patch changes an affected path, API/event contract, schema, migration, dependency, test fixture, or invariant, automatically re-open all records whose `affectedPaths`, `dependsOn`, or `rootCauseGroup` intersects that change. The re-open is not a failure of the prior agent; it is the correct acknowledgement that its evidence was executed against an older system state.

## 6. Final merge-candidate closure is the only release decision

Each remediation pull request should run targeted evidence, but neither an individual PR nor a single agent may certify the aggregate. The protected branch must require the assurance workflow on the final merge candidate. That workflow must perform all of the following:

1. Regenerate or validate the canonical ledger from per-finding records.
2. Verify the baseline/current report-to-ledger mapping and stable IDs.
3. Reject all ledger records outside `VERIFIED_FIXED`.
4. Run the assurance detector against the combined commit and reject any non-zero finding count.
5. Run affected static, unit, contract, integration, E2E, concurrency, recovery, migration, and security evidence against the combined environment.
6. Recompute evidence freshness and re-open stale records before evaluating release status.

This combined-candidate requirement is what prevents a payments fix and an authorization fix, each locally correct, from merging into a state where an authorization contract, schema, test fixture, or error behavior no longer matches the other fix.

## 7. Concurrency example

Assume `ASSURANCE-0001` fixes a mandatory idempotency key and `ASSURANCE-0002` fixes tenant authorization on the same payment endpoint. The payments lane changes the request contract and the authentication lane changes middleware. Neither lane may close its record solely on its own branch because both touch the public request and the same funds flow.

The integration owner first publishes the approved contract and migration order. Each lane adds its implementation and regression tests. The combined branch then runs duplicate-request, cross-tenant, concurrent-request, recovery, audit, and E2E tests. Only after the original detector is clean and the combined evidence passes can both IDs move to `VERIFIED_FIXED`. A later schema/contract change reopens both records automatically.

## Guarantee boundary

The system guarantees that every **discovered in-scope finding** is accounted for: fixed with evidence, or explicitly external-blocked and release-blocking. It does not guarantee the absence of undiscovered defects. Continuous detector improvement, code review, threat modelling, real-dependency tests, fuzz/property tests, chaos/recovery tests, load tests, and final merge-candidate verification are the controls that reduce that residual risk.
