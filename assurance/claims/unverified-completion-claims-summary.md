# Unverified Completion Claims — Detailed Remediation Breakdown

Generated at **2026-08-13T10:22:08.085Z** for revision **HEAD** from todo.md. Every checked item is treated as a **BLOCKED** assertion until its implementation and all required evidence are recorded and re-executed.

## Overall inventory

The inventory contains **1218** unverified completion claims. The CSV and JSON companion files contain one fully traceable remediation record per claim, including source line, heading/phase, risk tier, equivalent components to discover in any codebase, required evidence, and an explicit remediation sequence.

| Risk tier | Claims |
|---|---:|
| critical | 282 |
| high | 319 |
| medium | 617 |
| low | 0 |

## Functional risk categories

| Equivalent component category | Claims tagged |
|---|---:|
| general-platform | 464 |
| client-experience | 281 |
| api-and-integration | 245 |
| data-and-schema | 146 |
| funds-and-ledger | 128 |
| identity-and-authorization | 123 |
| deployment-and-operations | 94 |
| security-and-privacy | 65 |
| workflow-and-resilience | 63 |

## Source phases and workstreams

| TODO section | Claims |
|---|---:|
| NEXCOM Exchange — Full Platform TODO > Round 61 — K8s Manifests, Grafana Dashboards, Router Test Coverage > Phase 1 — Kubernetes Manifests (25 microservices) | 27 |
| NEXCOM Exchange — Full Platform TODO > Round v52 — Final TS Error Elimination | 24 |
| NEXCOM Exchange — Full Platform TODO > Round 25 — Comprehensive Audit & Production Readiness (2026-04-12) | 23 |
| NEXCOM Exchange — Full Platform TODO > Fund-Flow Hardening — All 20 Scenarios (2026-06-21) | 21 |
| NEXCOM Exchange — Full Platform TODO > Round v40 — Comprehensive Audit & Full Implementation (Apr 26 2026) > Mobile Parity (React Native — 19 → 39 screens) | 20 |
| NEXCOM Exchange — Full Platform TODO > Round v40 — Comprehensive Audit & Full Implementation (Apr 26 2026) > Mobile Parity (Flutter — 21 → 41 screens) | 20 |
| NEXCOM Exchange — Full Platform TODO > Production Readiness Fixes (Jun 2026 Audit) > P0 — Critical: In-memory → PostgreSQL migrations | 20 |
| NEXCOM Exchange — Full Platform TODO > Round 28 — Final Production Finalization (All Features Complete) | 19 |
| NEXCOM Exchange — Full Platform TODO > React Native Mobile App (nexcom-mobile/) | 18 |
| NEXCOM Exchange — Full Platform TODO > Round 26 — Production Finalization (All Features) | 18 |
| NEXCOM Exchange — Full Platform TODO > Round 61 — K8s Manifests, Grafana Dashboards, Router Test Coverage > Phase 3 — Vitest Router Tests (18 untested routers) | 18 |
| NEXCOM Exchange — Full Platform TODO > Round 30 — PWA UI Render & Final Hardening | 17 |
| NEXCOM Exchange — Full Platform TODO > Round v44 — Schema Fixes & Production Readiness | 17 |
| NEXCOM Exchange — Full Platform TODO > Round 31 — Production Hardening & Comprehensive Implementation [COMPLETED] | 15 |
| NEXCOM Exchange — Full Platform TODO > Round 38 — Comprehensive Audit & Final Finalization (COMPLETED) | 15 |
| NEXCOM Exchange — Full Platform TODO > Round v60 — Production-Readiness Sprint (16-Point Audit) — COMPLETED | 15 |
| NEXCOM Exchange — Full Platform TODO > Round 56 — FundFlow Router Wiring + Infrastructure Hardening (Jun 21 2026) | 15 |
| NEXCOM Exchange — Full Platform TODO > Round 59 — Fund-Flow Guarantees: Idempotency, tradeFill Wiring, Test Mocks (Jun 25 2026) | 14 |
| NEXCOM Exchange — Full Platform TODO > Round 70 | 14 |
| NEXCOM Exchange — Full Platform TODO > Round 29 — Final Production Completion | 13 |
| NEXCOM Exchange — Full Platform TODO > Round 63 — Full Middleware Integration + Schema Audit (Jul 11 2026) > Middleware Integration (13 routers × 8 systems) — COMPLETE | 13 |
| NEXCOM Exchange — Full Platform TODO > Round 24 — Final Production Hardening (2026-03-31) | 12 |
| NEXCOM Exchange — Full Platform TODO > Round 39 — Multi-Language Security Hardening | 12 |
| NEXCOM Exchange — Full Platform TODO > Liveness Gaps Closed (v56) | 12 |
| NEXCOM Exchange — Full Platform TODO > Round v59 — Permify RBAC Router + Temporal Worker Workflows — COMPLETED | 12 |
| NEXCOM Exchange — Full Platform TODO > Round 60 — Remaining Gaps Closed | 12 |
| NEXCOM Exchange — Full Platform TODO > Round 62 — TigerBeetle Full Coverage + Schema Audit (Jul 2026) > TigerBeetle Integration Audit | 12 |
| NEXCOM Exchange — Full Platform TODO > Round 19 — Security Hardening (TOTP/WebAuthn/KYC gaps) | 11 |
| NEXCOM Exchange — Full Platform TODO > Round 34 — Ledger Page Wiring & Router Hardening | 11 |
| NEXCOM Exchange — Full Platform TODO > Round 35 — UX Polish & Production Documentation | 11 |
| NEXCOM Exchange — Full Platform TODO > Round v53 — Final Server-Level TS Error Elimination | 11 |
| NEXCOM Exchange — Full Platform TODO > Round N — UX Enhancements (Jun 2026) | 11 |
| NEXCOM Exchange — Full Platform TODO > Fund-Flow Guarantee Audit — Round 2 (2026-06-21) > Phase 2 — Go Temporal Saga Hardening | 11 |
| NEXCOM Exchange — Full Platform TODO > Fund-Flow Guarantee Audit — Round 2 (2026-06-21) > Phase 5 — TypeScript Router Hardening | 11 |
| NEXCOM Exchange — Full Platform TODO > Round 72 — AI Market Assistant, PDF/CSV Export, Dark Mode & Skeletons | 11 |
| NEXCOM Exchange — Full Platform TODO > Production Readiness & Comprehensive Audit (In Progress) | 10 |
| NEXCOM Exchange — Full Platform TODO > Round 11 — Channel Secrets + USSD Loan Flow + Telegram Alerts | 10 |
| NEXCOM Exchange — Full Platform TODO > Round 16 — Comprehensive Production Audit — COMPLETED | 10 |
| NEXCOM Exchange — Full Platform TODO > Round 20 — Passkey Login + Admin KYC Review + OpenSanctions | 10 |
| NEXCOM Exchange — Full Platform TODO > Round 21 — TigerBeetle/Mojaloop/PostgreSQL Hardening + Email + Passkeys | 10 |
| NEXCOM Exchange — Full Platform TODO > Round 36 — Skeleton Loaders (All Pages) + ErrorBoundary | 10 |
| NEXCOM Exchange — Full Platform TODO > Round 37 — Production Finalization (Security Hardening + Smoke Tests) | 10 |
| NEXCOM Exchange — Full Platform TODO > Round 40 — open-appsec + APISIX Integration | 10 |
| NEXCOM Exchange — Full Platform TODO > UX Enhancements (Jun 2026) | 10 |
| NEXCOM Exchange — Full Platform TODO > Critical Production Gaps — Completion Status (Jun 21 2026) | 10 |
| NEXCOM Exchange — Full Platform TODO > Round 63 — Full Middleware Integration + Schema Audit (Jul 11 2026) > Schema Audit — 9 New Middleware Tracking Tables — COMPLETE | 10 |
| NEXCOM Exchange — Full Platform TODO > Round 68 — SpotFx Web UI, CrossBorderFx tRPC, Temporal tRPC, 10 Vitest Tests, Mobile/Flutter Cross-Border, Rust cross_currency (Jul 12 2026) > Vitest Unit Tests (10 new files, 146 tests) | 10 |
| NEXCOM Exchange — Full Platform TODO > Round 10 — USSD / WhatsApp / Telegram (Go + Python + Rust) — COMPLETED | 9 |
| NEXCOM Exchange — Full Platform TODO > Round v49 — CRUD Gap Closure + Table Name Fixes + Env Var Documentation | 9 |
| NEXCOM Exchange — Full Platform TODO > Round v54 — Final Cleanup | 9 |
| NEXCOM Exchange — Full Platform TODO > Round v58 — Security Hardening + WebSocket Resilience — COMPLETED | 9 |
| NEXCOM Exchange — Full Platform TODO > Critical Production Gaps (Jun 2026 — Final Sprint) > P3 — TigerBeetle Ledger (double-entry accounting) | 9 |
| NEXCOM Exchange — Full Platform TODO > Round 71 — Comprehensive Stakeholder Workflow Smoke Test | 9 |
| NEXCOM Exchange — Full Platform TODO > Go Microservices | 8 |
| NEXCOM Exchange — Full Platform TODO > Round v40 — Comprehensive Audit & Full Implementation (Apr 26 2026) > Security Hardening | 8 |
| NEXCOM Exchange — Full Platform TODO > Round v58 — Full Test Suite Fix (946/946) — COMPLETED | 8 |
| NEXCOM Exchange — Full Platform TODO > Sprint — May 2026 (UX Improvements) | 8 |
| NEXCOM Exchange — Full Platform TODO > Audit Remediation — P0 to P4 (June 2026) > P0 — Must Fix Before Live Money | 8 |
| NEXCOM Exchange — Full Platform TODO > Critical Production Gaps (Jun 2026 — Final Sprint) > P2 — OpenSearch Integration (full-text indexing) | 8 |
| NEXCOM Exchange — Full Platform TODO > Fund-Flow Guarantee Audit — Round 2 (2026-06-21) > Phase 4 — Python AML/Analytics Hardening | 8 |
| NEXCOM Exchange — Full Platform TODO > Round 62 — TigerBeetle Full Coverage + Schema Audit (Jul 2026) > Schema Audit — Missing Shadow-Ledger Tables (8 new tables) | 8 |
| NEXCOM Exchange — Full Platform TODO > Phase 4 — Physical Operations | 7 |
| NEXCOM Exchange — Full Platform TODO > Web Platform Pages (116 total) | 7 |
| NEXCOM Exchange — Full Platform TODO > Round 19 — Full Security Gap Closure | 7 |
| NEXCOM Exchange — Full Platform TODO > Round 22 — PostgreSQL Read Replica + Admin DB Health + Email Service | 7 |
| NEXCOM Exchange — Full Platform TODO > Round 38 — Comprehensive Audit & Final Finalization | 7 |
| NEXCOM Exchange — Full Platform TODO > Round v50 — Final CRUD Closure + Flutter API Wiring | 7 |
| NEXCOM Exchange — Full Platform TODO > Round v58 — Production Finalization (All Gaps) > Security Hardening | 7 |
| NEXCOM Exchange — Full Platform TODO > Production Readiness Fixes (Jun 2026 Audit) > P2 — Medium: UX completeness | 7 |
| NEXCOM Exchange — Full Platform TODO > Critical Production Gaps (Jun 2026 — Final Sprint) > P1 — Redis Integration (rate limiting + session + cache) | 7 |
| NEXCOM Exchange — Full Platform TODO > Critical Production Gaps (Jun 2026 — Final Sprint) > P4 — Keycloak Auth (enterprise SSO) | 7 |
| NEXCOM Exchange — Full Platform TODO > Fund-Flow Guarantee Audit — Round 2 (2026-06-21) > Phase 3 — Rust Matching Engine Hardening | 7 |
| NEXCOM Exchange — Full Platform TODO > Fund-Flow Guarantee Audit — Round 2 (2026-06-21) > Phase 6 — Infrastructure Hardening | 7 |
| NEXCOM Exchange — Full Platform TODO > Production Readiness | 6 |
| NEXCOM Exchange — Full Platform TODO > Next Steps (Round 7) | 6 |
| NEXCOM Exchange — Full Platform TODO > Next Steps (Round 8) | 6 |
| NEXCOM Exchange — Full Platform TODO > Next Steps (Round 8) — COMPLETED | 6 |
| NEXCOM Exchange — Full Platform TODO > Next Steps (Round 9) — Production Readiness Final | 6 |
| NEXCOM Exchange — Full Platform TODO > Round 17 — Final Production Hardening — COMPLETED | 6 |
| NEXCOM Exchange — Full Platform TODO > Round v51 — Final TS Error Fixes | 6 |
| NEXCOM Exchange — Full Platform TODO > Round v55 — Final Production-Ready Checkpoint | 6 |
| NEXCOM Exchange — Full Platform TODO > Liveness Production Gaps (v56) | 6 |
| NEXCOM Exchange — Full Platform TODO > Round v57 — Liveness Test Fixes + Final Checkpoint | 6 |
| NEXCOM Exchange — Full Platform TODO > Round v61 — Final Production-Readiness Sprint (all suggestions resolved) | 6 |
| NEXCOM Exchange — Full Platform TODO > Critical Production Gaps (Jun 2026 — Final Sprint) > P0 — JWT Session Security | 6 |
| NEXCOM Exchange — Full Platform TODO > Critical Production Gaps (Jun 2026 — Final Sprint) > P6 — E2E Tests (Playwright) | 6 |
| NEXCOM Exchange — Full Platform TODO > Round 64 — Health Dashboard, Helm, Playwright, Prometheus (Jul 11 2026) > Helm Chart Packaging — COMPLETE | 6 |
| NEXCOM Exchange — Full Platform TODO > Infrastructure (Completed) | 5 |
| NEXCOM Exchange — Full Platform TODO > Phase 1 — Core Exchange Parity | 5 |
| NEXCOM Exchange — Full Platform TODO > Phase 3 — Capital Markets | 5 |
| NEXCOM Exchange — Full Platform TODO > PWA Enhancements | 5 |
| NEXCOM Exchange — Full Platform TODO > Next Steps (Round 5) | 5 |
| NEXCOM Exchange — Full Platform TODO > Round 11 — COMPLETED | 5 |
| NEXCOM Exchange — Full Platform TODO > Round 12 — COMPLETED | 5 |
| NEXCOM Exchange — Full Platform TODO > Round 13 — COMPLETED | 5 |
| NEXCOM Exchange — Full Platform TODO > Round 14 — COMPLETED | 5 |
| NEXCOM Exchange — Full Platform TODO > Round 15 — COMPLETED | 5 |
| NEXCOM Exchange — Full Platform TODO > Round v40 — Comprehensive Audit & Full Implementation (Apr 26 2026) > Backend Completeness | 5 |
| NEXCOM Exchange — Full Platform TODO > Round v58 — Production Finalization (All Gaps) > UI/UX CRUD Completion | 5 |
| NEXCOM Exchange — Full Platform TODO > Sprint — May 2026 (Round B — Production Loop) | 5 |
| NEXCOM Exchange — Full Platform TODO > Sprint — May 2026 (Round C — Production Loop) | 5 |
| NEXCOM Exchange — Full Platform TODO > Audit Remediation — P0 to P4 (June 2026) > P1 — Must Fix Before Public Launch | 5 |
| NEXCOM Exchange — Full Platform TODO > Audit Remediation — P0 to P4 (June 2026) > P2 — Must Fix Before Scale | 5 |
| NEXCOM Exchange — Full Platform TODO > Fund-Flow Guarantee Audit — Round 2 (2026-06-21) > Phase 7 — Testing & Coverage Matrix | 5 |
| NEXCOM Exchange — Full Platform TODO > Round 64 — Health Dashboard, Helm, Playwright, Prometheus (Jul 11 2026) > Prometheus AlertManager Rules — COMPLETE | 5 |
| NEXCOM Exchange — Full Platform TODO > Round 66 — Distributed Tracing UI, Regulatory Reporting, Multi-tenancy (Jul 11 2026) > Regulatory Reporting Module | 5 |
| NEXCOM Exchange — Full Platform TODO > Round 66 — Distributed Tracing UI, Regulatory Reporting, Multi-tenancy (Jul 11 2026) > Multi-tenancy Exchange Operator Onboarding | 5 |
| NEXCOM Exchange — Full Platform TODO > Round 67 — Spot FX Engine, Vitest Tests, Mobile/Flutter Screens, CrossBorderFxWorkflow (Jul 12 2026) > Expo Mobile Screens (5 new) | 5 |
| NEXCOM Exchange — Full Platform TODO > Round 67 — Spot FX Engine, Vitest Tests, Mobile/Flutter Screens, CrossBorderFxWorkflow (Jul 12 2026) > Flutter Screens (5 new) | 5 |
| NEXCOM Exchange — Full Platform TODO > Phase 2 — Ecosystem Expansion | 4 |
| NEXCOM Exchange — Full Platform TODO > Next Steps (Round 6) | 4 |
| NEXCOM Exchange — Full Platform TODO > Round 18 — Production Readiness & Complete Archive | 4 |
| NEXCOM Exchange — Full Platform TODO > Round v58 — Production Finalization (All Gaps) > WebSocket Resilience (Rural Africa / Low Bandwidth) | 4 |
| NEXCOM Exchange — Full Platform TODO > Round v58 — Production Finalization (All Gaps) > Middleware Integration | 4 |
| NEXCOM Exchange — Full Platform TODO > Production Readiness Fixes (Jun 2026 Audit) > P1 — High: Security hardening | 4 |
| NEXCOM Exchange — Full Platform TODO > Critical Production Gaps (Jun 2026 — Final Sprint) > P5 — PWA Service Worker (offline caching) | 4 |
| NEXCOM Exchange — Full Platform TODO > Round 61 — K8s Manifests, Grafana Dashboards, Router Test Coverage > Phase 2 — Grafana Dashboards | 4 |
| NEXCOM Exchange — Full Platform TODO > Round 64 — Health Dashboard, Helm, Playwright, Prometheus (Jul 11 2026) > Playwright Smoke Tests — COMPLETE | 4 |
| NEXCOM Exchange — Full Platform TODO > Round 65 — Grafana, CI/CD, OpenTelemetry, APISIX (Jul 11 2026) > OpenTelemetry Instrumentation — COMPLETE | 4 |
| NEXCOM Exchange — Full Platform TODO > Round 66 — Distributed Tracing UI, Regulatory Reporting, Multi-tenancy (Jul 11 2026) > Distributed Tracing UI | 4 |
| NEXCOM Exchange — Full Platform TODO > Round 68 — SpotFx Web UI, CrossBorderFx tRPC, Temporal tRPC, 10 Vitest Tests, Mobile/Flutter Cross-Border, Rust cross_currency (Jul 12 2026) > Delivery | 4 |
| NEXCOM Exchange — Full Platform TODO > Round 69 — Drizzle ORM Improvements, CrossBorderFx/TemporalWorkflows Pages, Vitest Coverage, Flutter Routes, Rust multi_currency (Jul 12 2026) > Drizzle ORM Improvements | 4 |
| NEXCOM Exchange — Full Platform TODO > Round 69 — Drizzle ORM Improvements, CrossBorderFx/TemporalWorkflows Pages, Vitest Coverage, Flutter Routes, Rust multi_currency (Jul 12 2026) > Web Pages | 4 |
| NEXCOM Exchange — Full Platform TODO > Round 69 — Drizzle ORM Improvements, CrossBorderFx/TemporalWorkflows Pages, Vitest Coverage, Flutter Routes, Rust multi_currency (Jul 12 2026) > Delivery | 4 |
| NEXCOM Exchange — Full Platform TODO > Database | 3 |
| NEXCOM Exchange — Full Platform TODO > Suggested Next Steps (Completed) | 3 |
| NEXCOM Exchange — Full Platform TODO > Next Steps (Round 3) | 3 |
| NEXCOM Exchange — Full Platform TODO > Next Steps (Round 4) | 3 |
| NEXCOM Exchange — Full Platform TODO > Round 20 — Admin KYC Review UI + Passkey Login + Email Suppression | 3 |
| NEXCOM Exchange — Full Platform TODO > Round 22 — SMTP Secrets + PG Read Replica + Platform Health UI | 3 |
| NEXCOM Exchange — Full Platform TODO > Round v40 — Comprehensive Audit & Full Implementation (Apr 26 2026) > Microservice Smoke Tests | 3 |
| NEXCOM Exchange — Full Platform TODO > Round v40 — Comprehensive Audit & Full Implementation (Apr 26 2026) > Archive & Slides | 3 |
| NEXCOM Exchange — Full Platform TODO > Round v58 — Production Finalization (All Gaps) > Telegram Alert Commands | 3 |
| NEXCOM Exchange — Full Platform TODO > Round v58 — Production Finalization (All Gaps) > Tests & Archive | 3 |
| NEXCOM Exchange — Full Platform TODO > Sprint — May 2026 (Round 2 UX Improvements) | 3 |
| NEXCOM Exchange — Full Platform TODO > Sprint — May 2026 (Round A — Production Loop) | 3 |
| NEXCOM Exchange — Full Platform TODO > Audit Remediation — P0 to P4 (June 2026) > P3 — Enterprise Readiness | 3 |
| NEXCOM Exchange — Full Platform TODO > Audit Remediation — P0 to P4 (June 2026) > P4 — Nice to Have | 3 |
| NEXCOM Exchange — Full Platform TODO > Suggested Next Steps — COMPLETED (2026-06-21) | 3 |
| NEXCOM Exchange — Full Platform TODO > Fund-Flow Guarantee Audit — Round 2 (2026-06-21) > Phase 1 — Deep Audit | 3 |
| NEXCOM Exchange — Full Platform TODO > Round 63 — Full Middleware Integration + Schema Audit (Jul 11 2026) > Client Library Extensions — COMPLETE | 3 |
| NEXCOM Exchange — Full Platform TODO > Round 63 — Full Middleware Integration + Schema Audit (Jul 11 2026) > Delivery | 3 |
| NEXCOM Exchange — Full Platform TODO > Round 64 — Health Dashboard, Helm, Playwright, Prometheus (Jul 11 2026) > Middleware Health Dashboard — COMPLETE | 3 |
| NEXCOM Exchange — Full Platform TODO > Round 64 — Health Dashboard, Helm, Playwright, Prometheus (Jul 11 2026) > Delivery | 3 |
| NEXCOM Exchange — Full Platform TODO > Round 65 — Grafana, CI/CD, OpenTelemetry, APISIX (Jul 11 2026) > Grafana Dashboards — COMPLETE | 3 |
| NEXCOM Exchange — Full Platform TODO > Round 65 — Grafana, CI/CD, OpenTelemetry, APISIX (Jul 11 2026) > CI/CD GitHub Actions — COMPLETE | 3 |
| NEXCOM Exchange — Full Platform TODO > Round 65 — Grafana, CI/CD, OpenTelemetry, APISIX (Jul 11 2026) > APISIX Rate Limiting — COMPLETE | 3 |
| NEXCOM Exchange — Full Platform TODO > Round 65 — Grafana, CI/CD, OpenTelemetry, APISIX (Jul 11 2026) > Delivery | 3 |
| NEXCOM Exchange — Full Platform TODO > Round 66 — Distributed Tracing UI, Regulatory Reporting, Multi-tenancy (Jul 11 2026) > Delivery | 3 |
| NEXCOM Exchange — Full Platform TODO > Round 67 — Spot FX Engine, Vitest Tests, Mobile/Flutter Screens, CrossBorderFxWorkflow (Jul 12 2026) > Delivery | 3 |
| NEXCOM Exchange — Full Platform TODO > Round 62 — TigerBeetle Full Coverage + Schema Audit (Jul 2026) > Schema Audit — Missing Columns | 2 |
| NEXCOM Exchange — Full Platform TODO > Round 62 — TigerBeetle Full Coverage + Schema Audit (Jul 2026) > Pending (requires production PostgreSQL) | 2 |
| NEXCOM Exchange — Full Platform TODO > Round 67 — Spot FX Engine, Vitest Tests, Mobile/Flutter Screens, CrossBorderFxWorkflow (Jul 12 2026) > Rust Spot FX Matching Engine | 2 |
| NEXCOM Exchange — Full Platform TODO > Round 67 — Spot FX Engine, Vitest Tests, Mobile/Flutter Screens, CrossBorderFxWorkflow (Jul 12 2026) > Vitest Unit Tests | 2 |
| NEXCOM Exchange — Full Platform TODO > Round 68 — SpotFx Web UI, CrossBorderFx tRPC, Temporal tRPC, 10 Vitest Tests, Mobile/Flutter Cross-Border, Rust cross_currency (Jul 12 2026) > SpotFx Web Page | 2 |
| NEXCOM Exchange — Full Platform TODO > Round 68 — SpotFx Web UI, CrossBorderFx tRPC, Temporal tRPC, 10 Vitest Tests, Mobile/Flutter Cross-Border, Rust cross_currency (Jul 12 2026) > CrossBorderFx tRPC Router | 2 |
| NEXCOM Exchange — Full Platform TODO > Round 68 — SpotFx Web UI, CrossBorderFx tRPC, Temporal tRPC, 10 Vitest Tests, Mobile/Flutter Cross-Border, Rust cross_currency (Jul 12 2026) > Temporal tRPC Router | 2 |
| NEXCOM Exchange — Full Platform TODO > Round 68 — SpotFx Web UI, CrossBorderFx tRPC, Temporal tRPC, 10 Vitest Tests, Mobile/Flutter Cross-Border, Rust cross_currency (Jul 12 2026) > Mobile Screens | 2 |
| NEXCOM Exchange — Full Platform TODO > Round 68 — SpotFx Web UI, CrossBorderFx tRPC, Temporal tRPC, 10 Vitest Tests, Mobile/Flutter Cross-Border, Rust cross_currency (Jul 12 2026) > Rust cross_currency Module | 2 |
| NEXCOM Exchange — Full Platform TODO > Round 69 — Drizzle ORM Improvements, CrossBorderFx/TemporalWorkflows Pages, Vitest Coverage, Flutter Routes, Rust multi_currency (Jul 12 2026) > Vitest Tests | 2 |
| NEXCOM Exchange — Full Platform TODO > Round 69 — Drizzle ORM Improvements, CrossBorderFx/TemporalWorkflows Pages, Vitest Coverage, Flutter Routes, Rust multi_currency (Jul 12 2026) > Rust multi_currency Module | 2 |
| NEXCOM Exchange — Full Platform TODO > Rust Microservices | 1 |
| NEXCOM Exchange — Full Platform TODO > Python Microservices | 1 |
| NEXCOM Exchange — Full Platform TODO > Round 62 — TigerBeetle Full Coverage + Schema Audit (Jul 2026) > TypeScript | 1 |
| NEXCOM Exchange — Full Platform TODO > Round 63 — Full Middleware Integration + Schema Audit (Jul 11 2026) > Pending (requires production PostgreSQL) | 1 |
| NEXCOM Exchange — Full Platform TODO > Round 67 — Spot FX Engine, Vitest Tests, Mobile/Flutter Screens, CrossBorderFxWorkflow (Jul 12 2026) > Temporal Workflow | 1 |
| NEXCOM Exchange — Full Platform TODO > Round 69 — Drizzle ORM Improvements, CrossBorderFx/TemporalWorkflows Pages, Vitest Coverage, Flutter Routes, Rust multi_currency (Jul 12 2026) > Flutter Route Registration | 1 |

## Remediation protocol applied to every claim

For each individual CSV/JSON record, the plan requires: define acceptance criteria and ownership; discover and trace equivalent entry points, authorization, business logic, persistence, events, audit, client wiring, recovery, and operations components; implement the missing behavior; add a regression test; validate through real dependencies and public-interface E2E testing; and record revision-pinned evidence. A claim cannot be marked verified by documentation, test names, mocked responses, code appearance, or a green partial suite.

## Prioritization rule

Remediate Critical claims first, especially financial integrity, authorization, privacy, security, and compliance flows. Next address High claims that affect workflows, integrations, data stores, or deployment operations. Then resolve Medium client-experience and general platform claims. Where a single shared component supports many claims, repair and verify the shared component first, then execute each claim’s individual evidence path; shared implementation does not automatically verify every consumer journey.

## Detailed claim records

Use `unverified-completion-claims.csv` for spreadsheet filtering and `unverified-completion-claims.json` for programmatic remediation tracking. They enumerate every claim individually rather than hiding the 1,218 assertions behind an aggregate score.
