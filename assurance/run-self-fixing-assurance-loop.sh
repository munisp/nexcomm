#!/usr/bin/env bash
# Local orchestration for the Generic Codebase Assurance Prompt.
# This script does NOT edit source code or call an autonomous code agent. It preserves
# a safe dry-run default, runs evidence checks when explicitly authorized, and reports
# whether the remediation ledger is eligible for release-gate verification.
set -Eeuo pipefail

usage() {
  cat <<'USAGE'
Usage:
  assurance/run-self-fixing-assurance-loop.sh [--root PATH] [--dry-run | --verify]

Modes:
  --dry-run  Default. Runs the assurance detector with all report output in a temporary
              directory. It does not write to the repository, run tests, install packages,
              create commits, change branches, contact remote services, or change databases.
  --verify   Runs configured local static/unit/build commands and the repository assurance
              gate. It may write ordinary local test/build/report artifacts, but never commits,
              pushes, deploys, or contacts a remote environment by itself. It requires an
              explicit acknowledgement and refuses main/master/release branches by default.

Environment variables for --verify:
  ALLOW_SELF_FIXING_ASSURANCE=I_UNDERSTAND_THIS_RUNS_LOCAL_VERIFICATION
  ASSURANCE_CHECK_COMMAND='pnpm run check'        (optional)
  ASSURANCE_TEST_COMMAND='pnpm run test'          (optional)
  ASSURANCE_BUILD_COMMAND='pnpm run build'        (optional; empty string skips build)
  ASSURANCE_GATE_COMMAND='node scripts/assurance-gate.mjs'
  ASSURANCE_LEDGER_FILE='assurance/remediation-ledger.json'

The remediation implementation loop is interactive:
  1. Run --dry-run and give generic-codebase-assurance-prompt.md plus the report to a
     coding agent on a non-protected local branch.
  2. The coding agent fixes one or more findings and updates the ledger with evidence.
  3. Run --verify. If BLOCKED, continue fixing. If RELEASEABLE and every ledger entry is
     VERIFIED_FIXED, request independent review; do not auto-deploy.
USAGE
}

ROOT="."
MODE="dry-run"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --root) ROOT="${2:?--root requires a path}"; shift 2 ;;
    --dry-run) MODE="dry-run"; shift ;;
    --verify) MODE="verify"; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "ERROR: unknown argument: $1" >&2; usage >&2; exit 2 ;;
  esac
done

ROOT="$(cd "$ROOT" && pwd)"
cd "$ROOT"
if ! git rev-parse --show-toplevel >/dev/null 2>&1; then
  echo "BLOCKED: --root must be inside a Git working tree." >&2
  exit 2
fi

REPO_ROOT="$(git rev-parse --show-toplevel)"
if [[ "$ROOT" != "$REPO_ROOT" ]]; then
  echo "BLOCKED: run from the repository root ($REPO_ROOT), not a subdirectory ($ROOT)." >&2
  exit 2
fi

BRANCH="$(git branch --show-current)"
COMMIT="$(git rev-parse HEAD)"
GATE_COMMAND="${ASSURANCE_GATE_COMMAND:-node scripts/assurance-gate.mjs}"
LEDGER_FILE="${ASSURANCE_LEDGER_FILE:-assurance/remediation-ledger.json}"

validate_ledger() {
  local ledger_path="$1"
  node - "$ledger_path" <<'NODE'
const fs = require("node:fs");
const ledgerPath = process.argv[2];
if (!fs.existsSync(ledgerPath)) {
  console.error(`BLOCKED: missing remediation ledger: ${ledgerPath}`);
  process.exit(1);
}
let ledger;
try { ledger = JSON.parse(fs.readFileSync(ledgerPath, "utf8")); }
catch (error) { console.error(`BLOCKED: invalid ledger JSON: ${error.message}`); process.exit(1); }
const findings = Array.isArray(ledger) ? ledger : ledger?.findings;
if (!Array.isArray(findings)) {
  console.error("BLOCKED: ledger must be an array or contain a findings array.");
  process.exit(1);
}
const valid = new Set(["DISCOVERED", "TRIAGED", "IMPLEMENTING", "REGRESSION_PROVEN", "RETESTING", "VERIFIED_FIXED", "EXTERNAL_BLOCKED"]);
const invalid = findings.filter((finding) => !finding?.id || !valid.has(finding?.state));
const unresolved = findings.filter((finding) => finding?.state !== "VERIFIED_FIXED");
console.log(JSON.stringify({
  ledger: ledgerPath,
  total: findings.length,
  verified_fixed: findings.length - unresolved.length,
  unresolved: unresolved.map((finding) => ({ id: finding.id, state: finding.state })),
  invalid: invalid.map((finding) => finding?.id ?? "<missing-id>")
}, null, 2));
if (invalid.length || unresolved.length) process.exit(1);
NODE
}

printf 'Self-fixing assurance loop\n  repository: %s\n  branch: %s\n  commit: %s\n  mode: %s\n' "$REPO_ROOT" "${BRANCH:-DETACHED}" "$COMMIT" "$MODE"

if [[ "$MODE" == "dry-run" ]]; then
  TEMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/assurance-dry-run.XXXXXX")"
  trap 'rm -rf "$TEMP_DIR"' EXIT
  REPORT="$TEMP_DIR/assurance-gate-report.json"
  echo "DRY RUN: no repository file, branch, commit, database, service, or remote action will be changed."
  echo "DRY RUN: executing detector with temporary report: $REPORT"
  set +e
  bash -euo pipefail -c "$GATE_COMMAND --output '$REPORT'"
  gate_status=$?
  set -e
  echo "DRY RUN detector exit status: $gate_status (1 means BLOCKED; this does not mutate the repository)."
  if [[ -f "$REPORT" ]]; then
    node -e 'const r=require(process.argv[1]); console.log(JSON.stringify({decision:r.decision,summary:r.summary,checkedTodoClaims:r.checkedTodoClaims,verifiedClaims:r.verifiedClaims},null,2))' "$REPORT"
  fi
  if [[ -f "$LEDGER_FILE" ]]; then
    echo "DRY RUN: validating the existing ledger without modifying it."
    set +e
    validate_ledger "$LEDGER_FILE"
    ledger_status=$?
    set -e
    echo "DRY RUN ledger exit status: $ledger_status (non-zero means remediation remains required)."
  else
    echo "DRY RUN: no ledger exists yet. Create it from this detector report before remediation."
  fi
  echo "NEXT: Provide assurance/generic-codebase-assurance-prompt.md and this output to an authorized coding agent on this non-protected branch."
  exit 0
fi

if [[ "${ALLOW_SELF_FIXING_ASSURANCE:-}" != "I_UNDERSTAND_THIS_RUNS_LOCAL_VERIFICATION" ]]; then
  echo "BLOCKED: --verify requires ALLOW_SELF_FIXING_ASSURANCE=I_UNDERSTAND_THIS_RUNS_LOCAL_VERIFICATION." >&2
  exit 2
fi
if [[ -z "$BRANCH" || "$BRANCH" == "main" || "$BRANCH" == "master" || "$BRANCH" == release/* ]]; then
  echo "BLOCKED: --verify refuses protected branch '$BRANCH'. Create a dedicated remediation branch." >&2
  exit 2
fi
if [[ ! -f "$LEDGER_FILE" ]]; then
  echo "BLOCKED: missing remediation ledger: $LEDGER_FILE" >&2
  exit 1
fi

CHECK_COMMAND="${ASSURANCE_CHECK_COMMAND:-pnpm run check}"
TEST_COMMAND="${ASSURANCE_TEST_COMMAND:-pnpm run test}"
BUILD_COMMAND="${ASSURANCE_BUILD_COMMAND:-pnpm run build}"
REPORT_PATH="assurance/reports/assurance-gate-report.json"

run_required() {
  local label="$1"; shift
  local command="$*"
  [[ -z "$command" ]] && return 0
  echo "VERIFY: $label"
  bash -euo pipefail -c "$command"
}

run_required "static checks" "$CHECK_COMMAND"
run_required "tests" "$TEST_COMMAND"
run_required "build" "$BUILD_COMMAND"
run_required "assurance detector" "$GATE_COMMAND --output '$REPORT_PATH'"

if [[ ! -f "$REPORT_PATH" ]]; then
  echo "BLOCKED: expected assurance report was not produced: $REPORT_PATH" >&2
  exit 1
fi
node -e 'const r=require(process.argv[1]); if(r.decision!=="RELEASEABLE" || Number(r.summary?.total||0)!==0) { console.error(JSON.stringify({decision:r.decision,summary:r.summary},null,2)); process.exit(1); }' "$REPORT_PATH"
validate_ledger "$LEDGER_FILE"

echo "LOCAL VERIFICATION PASSED: assurance report is RELEASEABLE and all ledger entries are VERIFIED_FIXED."
echo "This does not deploy, commit, push, merge, change cloud resources, or authorize production release. Obtain independent review and protected-branch CI evidence."
