# Interactive Self-Fixing Assurance Workflow for a Local Branch

## Purpose and operating boundary

Use this workflow when an AI coding agent is authorized to **change and test** a local checkout. The updated prompt is not a request for a findings report: its default mode is `FIX_ALL_IN_SCOPE_FINDINGS`. The agent must remediate each safely actionable finding, prove the correction, re-run the original detection mechanism, and continue until all in-scope findings are `VERIFIED_FIXED` or an external dependency objectively prevents safe progress.

> The workflow makes unaddressed findings visible and release-blocking. It does **not** prove that no undiscovered defect exists, and it does not grant permission to alter production systems, spend funds, access personal data, use production credentials, or make releases. Use an isolated branch, non-production services, synthetic data, and approved test/sandbox accounts.

## 1. Create an isolated branch and capture the baseline

Start from a clean local checkout. Do not run remediation directly on `main` or on an unrelated feature branch.

```bash
cd /path/to/your/repository

git fetch origin
git switch main
git pull --ff-only
git switch -c assurance/fix-all-$(date +%Y%m%d)

git status --short
git rev-parse HEAD
git log -1 --oneline
```

Record the commit SHA in the remediation ledger before any change. Install exactly the dependencies declared by the repository. A lockfile failure is itself a remediation item; do not use a non-frozen install merely to make the assurance evidence appear green.

```bash
pnpm install --frozen-lockfile

# For repositories using another build tool, run its lockfile-enforcing equivalent:
# npm ci
# yarn install --immutable
# poetry install --sync
# uv sync --frozen
# go mod verify
# cargo build --locked
```

Run the initial local gate and preserve its output. In this repository the command is `pnpm run assurance:gate`; in another repository substitute the assurance command configured by its policy/workflow.

```bash
mkdir -p assurance/baseline
pnpm run assurance:gate > assurance/baseline/assurance-gate.stdout.log 2>&1 || true
cp assurance/reports/assurance-gate-report.json assurance/baseline/assurance-gate-report.json 2>/dev/null || true

git status --short
```

The `|| true` preserves the shell session after the expected non-zero blocked result. It does **not** make the result pass. The agent must read the report and create ledger entries for every finding.

## 2. Start the interactive self-fixing session

Open the repository root in an AI coding agent that has permission to edit the branch and execute safe local tests. Attach or paste [`generic-codebase-assurance-prompt.md`](./generic-codebase-assurance-prompt.md) into that session, then give the agent the following execution instruction.

```text
Target: the currently checked-out local branch only.
Mode: FIX_ALL_IN_SCOPE_FINDINGS.

Execute the attached Generic Codebase Assurance Prompt as an implementation task, not a review. First inspect the existing repository and create/continue assurance/remediation-ledger.md from the initial gate report. Then repeatedly select the highest-severity safely remediable root cause, implement the complete fix, add a regression test, run the original detector and all affected tests, and update the ledger with revision-pinned evidence.

Do not stop after reporting findings. Do not suppress, delete, downgrade, skip, mock, quarantine, or relabel findings to obtain a pass. Do not alter production systems or use production data/credentials. Continue until every in-scope finding is VERIFIED_FIXED. If an item truly requires missing authority, an approved requirement, an inaccessible sandbox, a third-party change, a legal decision, or my action, record it as EXTERNAL_BLOCKED, keep fixing unrelated items, and return BLOCKED with the exact minimal unblock request.

Before any final response, show the remediation-ledger counts by state and rerun the local assurance gate. A final RELEASEABLE result requires zero in-scope entries outside VERIFIED_FIXED.
```

Do not instruct the agent merely to “review,” “assess,” “audit,” “summarize,” or “list fixes.” Those formulations commonly yield detection without implementation. The verbs **implement**, **test**, **re-run**, **continue**, and **do not stop** are essential.

## 3. Maintain the remediation ledger

Create `assurance/remediation-ledger.md` or a structured JSON/YAML equivalent. The ledger is not a backlog; it is the controlled state machine that demonstrates every discovered item has been addressed.

```markdown
# Remediation Ledger

| Finding ID | Source / command | Severity | Affected flow and root cause | State | Fix revision | Regression test / evidence | Re-run result | External block / next action |
|---|---|---|---|---|---|---|---|---|
| ASSURANCE-0001 | assurance-gate-report.json | HIGH | `src/...`: optional idempotency key permits duplicate effect | TRIAGED | — | — | Baseline reproduced | — |
| ASSURANCE-0002 | assurance-gate-report.json | CRITICAL | `server/...`: authorization policy missing tenant check | IMPLEMENTING | — | — | Baseline reproduced | — |
```

| Ledger state | Meaning | What the agent must do next |
|---|---|---|
| `DISCOVERED` | The report identified the item but it has not been reproduced/understood. | Preserve output, reproduce it, and map the affected path. |
| `TRIAGED` | Root cause, requirement, impact, and safe boundary are known. | Implement the complete correction. |
| `IMPLEMENTING` | A code/configuration/migration/test change is under way. | Finish all affected path wiring, documentation, and tests. |
| `REGRESSION_PROVEN` | The new test detects the former defect. | Execute complete affected test matrix and original detector. |
| `RETESTING` | Evidence execution is in progress. | Resolve every regression/new finding and repeat. |
| `VERIFIED_FIXED` | Original detector is clean, all affected evidence passes, and traceability is updated. | No further action unless later change reopens the finding. |
| `EXTERNAL_BLOCKED` | A specifically identified dependency outside the agent’s authority stops a safe fix/proof. | Continue independent fixes; request the minimal named action; keep release BLOCKED. |

## 4. Execute the correction loop

The agent repeats the following loop, maintaining a focused working tree and evidence after every meaningful change.

```bash
# 1. Inspect the current ledger and pick the highest-risk safe root cause.
sed -n '1,220p' assurance/remediation-ledger.md

# 2. Implement the complete fix, including migrations/configuration/wiring where needed.
#    Add a regression test that fails against the former defect.

# 3. Run targeted evidence first.
pnpm run check
pnpm run test

# 4. Run the original detector. A non-zero result remains a blocker.
pnpm run assurance:gate

# 5. For changed public or durable behavior, run the necessary real-dependency/E2E evidence.
# ASSURANCE_E2E_COMMAND='your reviewed non-production setup command' bash -lc "$ASSURANCE_E2E_COMMAND"
# pnpm run test:e2e

# 6. Review exact changes before moving an item to VERIFIED_FIXED.
git diff --check
git diff --stat
git diff
```

For TypeScript projects, `pnpm run check`, `pnpm run test`, and `pnpm run build` are usually required. For Go, execute `go test ./...`, `go vet ./...`, and relevant race/fuzz/integration tests. For Rust, execute `cargo fmt --check`, `cargo clippy -- -D warnings`, `cargo test`, and applicable integration/fuzz tests. For Python, execute the project’s formatter/linter/type checker, `pytest`, security checks, and integration/E2E suite. The assurance prompt determines the full language and architecture-specific matrix after discovery; these commands are only examples.

Do not move a ledger record to `VERIFIED_FIXED` merely because a targeted unit test passes. The agent must re-run the detector that reported it and all applicable dependent tests. For authorization, funds, durable state, distributed effects, migration, recovery, and external integrations, the evidence must include the required non-production real-dependency and end-to-end path.

## 5. Close the branch only when the ledger and gate agree

At the end of each iteration, calculate the ledger counts. The local release decision is strict:

| Condition | Required local decision |
|---|---|
| Any item is `DISCOVERED`, `TRIAGED`, `IMPLEMENTING`, `REGRESSION_PROVEN`, or `RETESTING` | **BLOCKED**; continue remediation. |
| One or more `EXTERNAL_BLOCKED` items exist | **BLOCKED**; continue independent remediation and request the precise external action. |
| The gate reports any Blocker, Critical, High, Medium, or Low finding | **BLOCKED**; reconcile the report to ledger records and continue remediation. |
| Every in-scope ledger entry is `VERIFIED_FIXED`, the gate is `RELEASEABLE`, and all required real-dependency evidence passes | Eligible for independent review and protected-branch CI; not an automatic production deployment. |

Before opening a pull request, preserve the evidence and run the full local suite required by the repository.

```bash
pnpm run assurance:gate
pnpm run ci

git status --short
git diff --check
git add assurance/remediation-ledger.md assurance/feature-claims.json \
  assurance/reports/assurance-gate-report.json
# Add the actual implemented source, tests, migrations, configuration, and documentation after review.
git add <reviewed-paths>
git commit -m "fix(assurance): remediate and verify in-scope findings"
git push -u origin HEAD
```

Do not include secrets, production data, tokens, test-sandbox credentials, or unrestricted logs in the ledger, commit, or CI artifacts.

## Why the ledger and loop leave zero findings unaddressed

The process makes **zero unaddressed discovered findings** enforceable through three independent controls. First, the initial detector output is preserved and each finding receives an ID and a lifecycle state; the work cannot disappear into a narrative summary. Second, a finding cannot enter `VERIFIED_FIXED` without proof that the original detector no longer reports it and that the applicable regression/affected-path evidence passes. Third, the final decision cross-checks the ledger against the release-gate report: any untracked report finding, non-fixed ledger record, or non-zero gate finding forces `BLOCKED`.

The guarantee has a precise boundary. It guarantees that every finding **discovered within the approved scope and by the executed checks** is either fixed and verified or recorded as an explicit external blocker. It does not claim that static scanners, tests, or humans can discover every possible bug. The assurance prompt therefore also requires threat modelling, real-dependency tests, fault injection, review, regression suites, and lifecycle testing to continuously expand discovery coverage.

`EXTERNAL_BLOCKED` is what makes the process honest. It prevents an agent from pretending a missing sandbox, unresolved requirement, legal interpretation, or third-party provider change is fixed. At the same time, the mandatory loop forbids using that block as an excuse to leave independent code findings untouched. The branch remains blocked until the external condition is resolved and the same verification loop closes the affected ledger entries.
