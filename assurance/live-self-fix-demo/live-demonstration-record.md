# Live Self-Fixing Assurance Demonstration Record

## Scope and safety boundary

This demonstration used an isolated local sample repository at `assurance/live-self-fix-demo`. It contained only synthetic identifiers and deliberately unsafe source/test content. No production account, provider, database, credential, personal data, remote service, deployment, or funds-transfer operation was accessed. The sample was designed to show the assurance loop’s mechanics; its final `RELEASEABLE` result applies only to the limited local sample and is not a production-payment or compliance certification.

## Initial assurance scan

The initial source contained a hard-coded secret-like value logged under an authorization label and a test built with a test double. The strict policy also required feature-claim and audit-policy evidence, which were intentionally absent. The original detector was executed and its report preserved at `baseline/initial-assurance-gate-report.json`.

| Initial finding | Severity | Why it blocked release | Remediation performed |
|---|---|---|---|
| `FEATURE-CLAIM-MANIFEST-MISSING` | Blocker | Checkmarked completion claims had no implementation/evidence trace. | Added `assurance/feature-claims.json` with two source-linked verified claims and execution evidence. |
| `AUDIT-TRAIL-POLICY-MISSING` | Blocker | Strict policy required scoped audit evidence. | Added a scope-limited audit policy that explicitly avoids any production compliance claim. |
| `SENSITIVE-LOGGING` | Critical | Secret-like configuration was logged as authorization data. | Removed hard-coded secret-like content and sensitive logging; added validation and file-backed durable state. |
| `MOCKED-RELEASE-EVIDENCE` at two source locations | High | A test double simulated payment success instead of verifying behavior. | Replaced it with four Node-native real filesystem integration tests. |

The initial result was `BLOCKED` with five findings: two Blockers, one Critical, and two High findings.

## Fix-until-verified remediation loop

The remediation ledger at `assurance/remediation-ledger.json` preserved one record for each initial finding. Each record identifies the detector ID, severity, root cause, exact correction, regression evidence, and verification revision. The corrected implementation now requires an account identifier, positive bigint minor-unit amount, and mandatory idempotency key; it persists an operation keyed to a request fingerprint, replays an identical retry without a duplicate operation, rejects conflicting key reuse, and serializes concurrent duplicate requests through a real temporary filesystem store.

| Validation step | Executed result |
|---|---|
| Native behavioral tests | Four tests passed: identical retry, conflicting key reuse, invalid input before persistence, and twelve concurrent duplicate requests. |
| Original assurance detector re-run | `RELEASEABLE`; zero Blocker, Critical, High, Medium, and Low findings. |
| Ledger closure test | Five total initial records; five `VERIFIED_FIXED`; zero unresolved. |
| Dry-run runner safety check | Ran detector/output in a temporary directory and left the sample Git worktree clean. |

## Exact dry-run-protected local command

Run this from the root of the repository that contains the supplied assurance assets. The command is safe by default: it writes its temporary detector report under the operating-system temporary directory, does not install dependencies, run tests, change files, commit, push, deploy, contact a database, or invoke remote services.

```bash
chmod 0755 assurance/run-self-fixing-assurance-loop.sh
./assurance/run-self-fixing-assurance-loop.sh --root "$(pwd)" --dry-run
```

For the standalone demonstration subrepository, the detector script sits two directories above the sample, so the executed command was:

```bash
cd assurance/live-self-fix-demo
ASSURANCE_GATE_COMMAND='node ../../scripts/assurance-gate.mjs --root .' \
  ../run-self-fixing-assurance-loop.sh --dry-run
```

The runner only permits local verification after explicit acknowledgement and refuses `main`, `master`, and `release/*` branches. Use a dedicated remediation branch; do not copy the acknowledgement into automated production/deployment tooling.

```bash
# First create a dedicated non-protected branch.
git switch -c assurance/fix-all-$(date +%Y%m%d)

# Then, only after reviewing the commands configured for this repository:
ALLOW_SELF_FIXING_ASSURANCE=I_UNDERSTAND_THIS_RUNS_LOCAL_VERIFICATION \
ASSURANCE_CHECK_COMMAND='pnpm run check' \
ASSURANCE_TEST_COMMAND='pnpm run test' \
ASSURANCE_BUILD_COMMAND='pnpm run build' \
./assurance/run-self-fixing-assurance-loop.sh --root "$(pwd)" --verify
```

`--verify` runs configured local checks and can create ordinary build/test/report artifacts; it still does not edit source, commit, push, merge, deploy, or configure remote/cloud services. The coding agent applies fixes interactively using the Generic Codebase Assurance Prompt between runner invocations.

## Enterprise integration boundary

For an enterprise implementation, do not use the demonstration audit policy as a production control. Implement the dedicated PostgreSQL remediation ledger, transition API, transactional outbox, append-only/tamper-evident audit stream, hash-addressed evidence store, role separation, retention/hold process, data-minimised audit schema, backup/restore procedure, and final merge-candidate CI validation in `enterprise-remediation-ledger-and-audit-log-guidance.md`.

The design supports engineering evidence for objectives associated with SOC 2 and GDPR but does not establish compliance on its own. Compliance/legal/security owners must decide scope, lawful basis, retention, records/rights handling, control applicability, and independent assessment requirements. [1] [2]

## References

[1]: https://www.aicpa-cima.com/resources/download/2017-trust-services-criteria-with-revised-points-of-focus-2022 "AICPA: 2017 Trust Services Criteria"
[2]: https://commission.europa.eu/law/law-topic/data-protection/data-protection-explained_en "European Commission: Data protection explained"
