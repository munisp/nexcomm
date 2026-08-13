# Mandatory CI/CD Release Gate

The repository now contains `.github/workflows/mission-critical-assurance.yml` and the deterministic command `pnpm run assurance:gate`. The workflow deliberately **fails closed**. It does not mark a pull request or release as safe until the feature-claim register, compliance matrix, audit-trail evidence, static checks, frozen dependency installation, build, real-dependency setup, and public-interface E2E checks all pass.

> This workflow produces engineering evidence. It does **not** itself establish SOC 2 compliance, GDPR compliance, financial-regulatory compliance, or a legal opinion. The qualified control owners named in `assurance/compliance-control-matrix.json` must determine applicability and approve the required evidence.

## One-time repository configuration

| Configuration item | Required setting | Why it is mandatory |
|---|---|---|
| Protected branches | Protect `main` and every release branch. Require pull requests, require review, disallow force pushes and branch deletion, and require the `Mission-Critical Assurance Gate / Policy, Completeness, Compliance, and Security Gate` and `Mission-Critical Assurance Gate / Build, Real Dependencies, and End-to-End Evidence` status checks before merge. | A workflow file alone can be edited or bypassed unless the repository ruleset requires its successful checks. |
| GitHub environment | Create the `release-assurance` environment and require the organization’s independent release/compliance approvers. Restrict deployment/environment access to the approved branches. | Provides documented separation of duties for the stage that runs production-like evidence. |
| Repository variable | Set `ASSURANCE_BASE_URL` to the isolated non-production endpoint that the E2E test suite must exercise, for example `http://localhost:3000` when the workflow starts the application in its own isolated environment. | E2E tests must target a concrete public interface, not a mock or unstated default. |
| Repository variable | Set `ASSURANCE_E2E_COMMAND` to a reviewed, fail-fast shell command that provisions only non-production resources, applies the required migrations, starts the exact revision under test, verifies readiness, and leaves the service available through `ASSURANCE_BASE_URL`. | The workflow fails by design if it cannot prove a real dependency environment exists. |
| Secrets | Store test/sandbox credentials only in the GitHub environment or repository secrets. Never put credentials in variables, source code, reports, test fixtures, or logs. | Protects external-provider sandboxes and prevents the release evidence from disclosing secrets. |
| Artifact retention | Retain uploaded CI evidence for the period approved in the organization’s records schedule. The workflow currently asks GitHub to retain artifacts for 90 days; change this only through the approved retention policy. | The evidence package is part of the change/audit trail, not a disposable build artifact. |

## Real-dependency setup command

The following is a starting point for `ASSURANCE_E2E_COMMAND` after review against the actual test matrix. It uses local ephemeral containers and the repository’s real database, cache, broker, and ledger dependency definitions. It intentionally uses test values and must not point at a production account or live funds.

```bash
set -euo pipefail
export POSTGRES_PASSWORD=nexcom_assurance_test_only
export DATABASE_URL="postgresql://nexcom:${POSTGRES_PASSWORD}@localhost:5432/nexcom"
export REDIS_URL="redis://localhost:6379"
export KAFKA_BROKERS="localhost:29092"
export TIGERBEETLE_ADDRESSES="localhost:3001"
export NODE_ENV=test
export EMAIL_ENABLED=false

docker compose up -d --wait postgres redis kafka tigerbeetle
pnpm db:push
docker compose up -d --wait portal

for attempt in $(seq 1 60); do
  if curl --fail --silent --show-error "${ASSURANCE_BASE_URL:-http://localhost:3000}" >/dev/null; then
    exit 0
  fi
  sleep 2
done

echo "BLOCKED: the isolated application did not become ready"
exit 1
```

The command is intentionally only a starting point. Before enabling it, verify the exact migration command, health/readiness route, service dependencies, identity-provider configuration, payment-provider sandbox, and funds-flow test fixture for this platform. The command must be extended to start every dependency used by the particular E2E and recovery test. A test that runs while an integration silently falls back to demo data, in-memory storage, a local mock, or an unverified no-op is a blocked release.

## Evidence registers that must be completed

| File | Required release-state condition |
|---|---|
| `assurance/feature-claims.json` | Every checked `todo.md` or other completion claim has a current verified record with implementation trace, real integration, E2E, security, audit, and fault-injection evidence. The intentionally empty file is a release blocker until this work is completed. |
| `assurance/compliance-control-matrix.json` | The responsible legal/compliance owners have determined scope and attached current engineering evidence for each required profile. The present `blocked` controls deliberately prevent a compliance claim. |
| `assurance/audit-trail-policy.json` | The audit design, integrity mechanism, access control, retention, export, and restore evidence are complete and verified. A mutable database table named `audit_log` is not sufficient. |
| `assurance/reports/assurance-gate-report.json` | The machine-readable result is `RELEASEABLE` with no Blocker, Critical, or High finding. This report is generated by the exact commit under review. |

## Operating model

The workflow checks every pull request and push to `main`. Its first job performs a deterministic policy scan and refuses missing evidence. Only if it passes does the second job run the build and release-stage verification. The environmental approval and the branch ruleset must make both jobs required checks. The default repository state is expected to be **BLOCKED** because the feature claims, compliance scope, audit evidence, and complete real-dependency test setup have not yet been independently populated and verified. This is correct fail-closed behavior, not an implementation failure.

The v2 prompt in `assurance/mission-critical-code-assurance-prompt-v2.md` remains the authoritative human and AI review procedure. The CI gate enforces machine-checkable portions of that procedure; it cannot replace threat modelling, code review, legal analysis, provider-sandbox testing, data-reconciliation review, production rollout approval, or independent audit work.

## Control anchors

The SOC 2 Trust Services Criteria are framed around security, availability, processing integrity, confidentiality, and privacy.[1] The European Commission identifies GDPR principles that include lawfulness, fairness, transparency, purpose limitation, data minimisation, storage limitation, accuracy, integrity/confidentiality, and accountability.[2] The SEC’s Rule 17a-4 guidance describes, for covered broker-dealers, an audit-trail alternative that includes time-stamped modification/deletion history and supports recreation of an original record.[3] The applicability of these controls remains a qualified legal/compliance decision.

[1]: https://www.aicpa-cima.com/resources/download/2017-trust-services-criteria-with-revised-points-of-focus-2022 "AICPA: Trust Services Criteria"
[2]: https://commission.europa.eu/law/law-topic/data-protection/data-protection-explained_en "European Commission: Data protection explained"
[3]: https://www.sec.gov/investment/amendments-electronic-recordkeeping-requirements-broker-dealers "SEC: Electronic recordkeeping requirements for broker-dealers"
