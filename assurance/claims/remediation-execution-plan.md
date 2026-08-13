# Remediation Execution Plan for 1,218 Unverified Completion Claims

## Decision and evidence boundary

The platform has **1,218 checkmarked completion claims**, and the claim register contains **zero verified claims** because no current, revision-pinned evidence has yet been attached to those assertions. This is not a statement that every claimed feature is absent; it is a statement that no claim is yet entitled to a production-complete status under the assurance policy. The detailed source-level inventory is available in [`unverified-completion-claims.csv`](./unverified-completion-claims.csv) and [`unverified-completion-claims.json`](./unverified-completion-claims.json). Each row contains the original TODO line, section, risk classification, equivalent components to discover, required evidence, and remediation action.

> The remediation program must **fix and prove** behavior. It must not make the CSV green by deleting TODO lines, rewording claims, marking items “not applicable” without trace evidence, suppressing tests, or accepting mocks as integration evidence.

## Current remediation inventory

| Measure | Count | Interpretation |
|---|---:|---|
| Total completion claims requiring proof | 1,218 | Every checked TODO/backlog claim is blocked until complete current evidence exists. |
| Critical-priority claims | 282 | Claims affecting financial integrity, identity/authorization, security/privacy, or compliance-sensitive behavior. |
| High-priority claims | 319 | Claims affecting data, workflows, integrations, reliability, deployment, or operational control. |
| Medium-priority claims | 617 | Claims primarily concerning client delivery, non-critical platform functions, or general features; they remain release-relevant. |
| Current verified claims | 0 | No claim may be relied upon for release approval yet. |

The categories below intentionally overlap because one claim can be, for example, both a financial workflow and an API integration. The overlap enables shared remediation rather than double-counting the claim total.

| Equivalent capability group | Tagged claims | Shared remediation workstream |
|---|---:|---|
| General platform capability | 464 | Build the baseline claim manifest, ownership map, component discovery index, and revision-pinned evidence workflow. |
| Client experience and channels | 281 | Prove each page, mobile screen, CLI, batch, or message channel is registered, authorized, wired to live behavior, error-aware, accessible where applicable, and covered by E2E. |
| API and external/internal integrations | 245 | Trace handlers, contracts, authorization, input validation, consumers, retries, provider sandbox behavior, and observability. |
| Data and schema | 146 | Validate migrations, constraints, durable state, cache/fallback policy, backups/restores, data lifecycle, and production-shaped seed fixtures. |
| Funds, ledger, and regulated transactions | 128 | Verify conservation, exact amount representation, idempotency, atomicity, reconciliation, auditability, concurrency, crash recovery, and provider uncertainty. |
| Identity and authorization | 123 | Prove deny-by-default controls, tenant boundaries, role/attribute decisions, session/revocation behavior, privileged-operation review, and audit events. |
| Deployment and operations | 94 | Validate build provenance, runtime hardening, health/telemetry, capacity, alerts, canary/rollback, recovery, and incident runbooks. |
| Security and privacy | 65 | Complete threat modelling, secret handling, supply-chain controls, adversarial testing, data classification, retention/rights flows, and compliance evidence. |
| Workflows and resilience | 63 | Demonstrate durable state machines, compensation, outbox/inbox/replay, dead-letter handling, fault injection, reconciliation, and recovery procedures. |

## Remediation sequence

### Wave 0 — Freeze unsupported release claims and create traceability

The first workstream is not a code cleanup; it is an evidence and safety control. Generate the claim inventory from every TODO/backlog/roadmap/release-note source, assign a business and engineering owner, and create a `feature-claims.json` record for every claim. No record may be `verified` until it references an exact commit, complete implementation locations, test identifiers, raw execution artifacts, and evidence for security/audit/recovery appropriate to the claim. The CI policy gate remains blocking during this work.

| Completion condition | Required evidence |
|---|---|
| One record per asserted capability | Claim ID, authoritative source, owner, component/service, channels, risk tier, data classification, and status. |
| Architecture/equivalence map exists | Entry points, business logic, stores, dependencies, event paths, authorization, deployment units, and tests are mapped by behavior. |
| Acceptance criteria are not invented | Product, risk, compliance, and engineering owners approve requirements for ambiguous or conflicted claims. |
| Baseline blockers remain visible | The existing report and all unresolved potential secret, mock, unsafe-money, fail-open, and incomplete-path findings are retained and triaged. |

### Wave 1 — Critical financial, identity, security, and compliance paths

Remediate the 282 Critical claims first. For a financial or ledger flow, the minimum proof includes exact amounts, authorized state transitions, durable idempotency, database or workflow atomicity, recovery after unknown remote outcomes, reconciliation, immutable/auditable history, concurrent duplicate prevention, and real-dependency end-to-end execution. For identity/security claims, the proof includes server-side authorization, tenant-isolation negative tests, revocation/session behavior, secure configuration, secret handling, audit events, and adversarial tests. For privacy/compliance claims, scope must be determined by qualified owners; engineering evidence alone does not establish legal compliance.

Each critical claim is only ready for reclassification after a regression test fails against the prior defect and after its real integration, E2E, security, and audit evidence execute at the candidate release revision. A shared remediation, such as a corrected authorization middleware or idempotency library, must be re-tested for every claim that consumes it.

### Wave 2 — High-risk workflows, integrations, durable data, and operations

Remediate the 319 High claims through domain workstreams. The integration workstream verifies routing/registration, contract compatibility, input validation, retry classification, provider sandbox behavior, event ordering, duplicate handling, operational telemetry, and failure recovery. The data workstream proves migration safety, constraints, indexes, backfill behavior, old/new compatibility, backup/restore, retention, and safely reproducible seed data. The workflow workstream establishes durable operation IDs, outbox/inbox or equivalent delivery guarantees, compensation/reconciliation, dead-letter/replay, and fault-injection evidence. The operations workstream validates hardening, health/readiness, capacity budgets, alerts, deployment, rollback, and incident response.

### Wave 3 — Medium-priority channel parity and completeness

The 617 Medium claims are not cosmetic. Every claimed screen, page, endpoint, command, report, or background job must be demonstrated through its actual client/interface. The workstream verifies registration, navigation/discoverability, authentication/authorization, live back-end wiring, durable outcome, error and loading states, accessibility where relevant, and E2E behavior. A page that renders a static state, invokes a mock, or shows a success message without persisted state remains blocked.

## Claim-level execution loop

The following loop applies to every one of the CSV/JSON rows.

| Step | Required action | Verification gate |
|---|---|---|
| 1. Establish authority | Confirm the business requirement and expected behavior. Resolve conflicts rather than inferring rules. | Named product/risk/compliance owner and approved acceptance criteria. |
| 2. Discover equivalents | Trace the actual entry point, authorization, rule, persistence, event/side effect, audit record, client, deployment, and test components. | Complete component/equivalence map with no unexplained gap. |
| 3. Implement the fix | Deliver the smallest complete production-safe change, including migrations/configuration/registration when needed. | No reachable stub, TODO, simulation, swallowed error, or incomplete implementation remains. |
| 4. Add regression coverage | Add meaningful local tests and the necessary contract, real integration, E2E, concurrency, property/fuzz, or fault tests. | Controlled defect or mutation causes the relevant test to fail. |
| 5. Run evidence | Execute on the exact candidate revision using isolated real dependencies and safe test/sandbox credentials. | Command, environment, artifact, exit code, timing, and durable expected state are recorded. |
| 6. Reassess risk | Review compatibility, privacy/security impact, audit records, data migration/rollback, operational/alerting impact, and residual risk. | Critical/High issues are fixed; no policy gate is bypassed. |
| 7. Register verification | Update the feature manifest and attach immutable or protected evidence. | `status=verified`, exact revision, all required evidence links, owner sign-off. |

## Treatment of the copied insurance-platform instructions

The pasted insurance-platform instructions are not automatically imported as platform requirements. They are treated as examples of capability classes to discover only after an owner endorses them. If endorsed, their generic equivalents map as follows: a WAF/gateway becomes an edge-control component; Permify/Keycloak becomes identity/authorization; Temporal becomes workflow orchestration; TigerBeetle becomes an authoritative ledger; Redis/PostgreSQL become cache/system-of-record or fallback components; Grafana/Prometheus become observability; Kubernetes/GitOps becomes runtime/delivery; and NFIU/NAICOM reporting becomes regulated integration/compliance reporting. Intrusive scans, load tests, chaos exercises, external-system interaction, or deployment require explicit authorization, isolated non-production targets, safety limits, and an approved runbook.

## Program exit criteria

The program may end only when the claim manifest has one current evidence-backed disposition for every asserted claim; all Critical and High defects are fixed and re-tested; all Medium gaps are fixed or formally accepted through an authorized risk process; no strict no-mocks or partial-production-path blocker remains; the compliance and audit-trail matrices are complete for applicable profiles; real-dependency integration/E2E/recovery tests pass; and the CI gate reports `RELEASEABLE`. Until then, the correct decision remains **BLOCKED**.
