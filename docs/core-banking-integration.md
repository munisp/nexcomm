# NEXCOM Exchange — Core Banking & Agricultural Banking Integration Architecture

**Version:** 1.0.0 | **Date:** March 2026 | **Author:** Manus AI

---

## Executive Summary

NEXCOM Exchange is a commodity trading platform purpose-built for agricultural markets in sub-Saharan Africa. Its integration with core banking systems (CBS) and agricultural banking modules transforms it from a pure exchange into a **full-stack agri-finance ecosystem**: farmers can obtain input loans, pledge warehouse receipts as collateral, trade their commodities, and have loan repayments automatically deducted from settlement proceeds — all within a single platform.

This document describes the integration architecture, data flows, API contracts, and operational patterns that connect NEXCOM to external CBS platforms (Temenos Transact, Infosys Finacle, Mambu) and to the Mojaloop interoperability layer for real-time payments.

---

## 1. Integration Topology

The NEXCOM platform integrates with core banking through a dedicated **Core Banking Integration Service** (`services/core-banking`) that acts as an anti-corruption layer. No other service in the platform calls a CBS API directly; all banking operations flow through this service.

```
┌─────────────────────────────────────────────────────────────────────┐
│                        NEXCOM Exchange Platform                      │
│                                                                      │
│  ┌──────────────┐   tRPC    ┌──────────────────────────────────────┐│
│  │  Web PWA /   │ ◄────────►│         Node.js API Server           ││
│  │  Mobile Apps │           │  (server/routers/bankingRouter.ts)   ││
│  └──────────────┘           └──────────────┬─────────────────────┘ ││
│                                             │ HTTP REST              │
│  ┌──────────────┐           ┌──────────────▼─────────────────────┐ ││
│  │  Settlement  │ ─────────►│   Core Banking Integration Service  │ ││
│  │   Engine     │ events    │   (Go, :8090)                       │ ││
│  └──────────────┘           │                                     │ ││
│                              │  ┌──────────┐  ┌──────────────┐   │ ││
│  ┌──────────────┐           │  │ Temenos  │  │   Finacle    │   │ ││
│  │  Middleware  │ ◄─────────│  │ Adapter  │  │   Adapter    │   │ ││
│  │  Hub (Kafka) │  events   │  └──────────┘  └──────────────┘   │ ││
│  └──────────────┘           │  ┌──────────┐  ┌──────────────┐   │ ││
│                              │  │  Mambu   │  │  Mojaloop    │   │ ││
│                              │  │ Adapter  │  │  Adapter     │   │ ││
│                              │  └──────────┘  └──────────────┘   │ ││
│                              └─────────────────────────────────────┘ ││
└─────────────────────────────────────────────────────────────────────┘
                                      │
              ┌───────────────────────┼───────────────────────┐
              ▼                       ▼                       ▼
    ┌──────────────────┐   ┌──────────────────┐   ┌──────────────────┐
    │  Temenos T24 /   │   │  Infosys Finacle │   │  Mambu Cloud     │
    │  Transact CBS    │   │  CBS             │   │  Banking         │
    └──────────────────┘   └──────────────────┘   └──────────────────┘
```

The active CBS adapter is selected at runtime via the `CBS_PROVIDER` environment variable (`temenos` | `finacle` | `mambu` | `mock`). All adapters implement the same `CBSAdapter` interface, making it trivial to switch CBS providers without changing any upstream code.

---

## 2. Core Banking Adapter Interface

All CBS adapters implement the following Go interface, defined in `services/core-banking/internal/models/models.go`:

| Method | Description |
|---|---|
| `GetAccount(ctx, ref)` | Retrieve account balance and status |
| `GetAccountsByOwner(ctx, ownerID)` | List all accounts for a customer |
| `GetTransactions(ctx, ref, from, to)` | Fetch transaction history |
| `CreateEscrowAccount(ctx, ownerID, currency)` | Open a trade escrow account |
| `InitiatePayment(ctx, instruction)` | Submit a payment instruction |
| `GetPaymentStatus(ctx, instructionID)` | Poll payment settlement status |
| `GetLoan(ctx, loanRef)` | Retrieve loan details and balance |
| `GetLoansByBorrower(ctx, borrowerID)` | List all loans for a borrower |
| `DisburseInputLoan(ctx, loan)` | Create and disburse an agri input loan |
| `RecordRepayment(ctx, loanRef, amount)` | Post a repayment to a loan account |
| `Ping(ctx)` | Health check the CBS connection |

This interface pattern ensures that the NEXCOM platform is **CBS-agnostic**: the same business logic works whether the underlying system is Temenos, Finacle, Mambu, or a future provider.

---

## 3. Supported CBS Platforms

### 3.1 Temenos Transact (T24)

The Temenos adapter (`services/core-banking/internal/adapters/temenos/`) communicates with Temenos Transact via its **IRIS REST API** (formerly the T24 OFS/BrowserWeb interface). Authentication uses OAuth 2.0 client credentials flow. Key configuration:

| Parameter | Environment Variable | Description |
|---|---|---|
| Base URL | `TEMENOS_BASE_URL` | Temenos IRIS API base (e.g., `https://t24.bank.com/irf-provider-container`) |
| Token URL | `TEMENOS_TOKEN_URL` | OAuth token endpoint |
| Client ID | `TEMENOS_CLIENT_ID` | OAuth client identifier |
| Client Secret | `TEMENOS_CLIENT_SECRET` | OAuth client secret |
| Company ID | `TEMENOS_COMPANY_ID` | T24 company/branch code (e.g., `BNK`) |

Temenos-specific mappings: NEXCOM `AgriLoan` maps to T24 `AA` (Arrangement Architecture) product; escrow accounts map to T24 `ACCOUNT` records with category `ESCROW`; payments map to T24 `FUNDS.TRANSFER` records.

### 3.2 Infosys Finacle

The Finacle adapter (`services/core-banking/internal/adapters/finacle/`) uses the **Finacle Connect API** (REST/JSON). It supports Finacle 10.x and 11.x. Authentication uses OAuth 2.0 with a bank-specific `bankCode` header on every request.

| Parameter | Environment Variable | Description |
|---|---|---|
| Base URL | `FINACLE_BASE_URL` | Finacle Connect API base |
| Token URL | `FINACLE_TOKEN_URL` | OAuth token endpoint |
| Bank Code | `FINACLE_BANK_CODE` | 3-digit bank identifier |

Finacle-specific mappings: loans map to Finacle `LOAN_ACCOUNT`; payments map to Finacle `FUND_TRANSFER`; escrow accounts use Finacle `CASA` accounts with scheme code `ESC`.

### 3.3 Mambu

The Mambu adapter (`services/core-banking/internal/adapters/mambu/`) uses the **Mambu REST API v2**. Mambu is a cloud-native CBS particularly well-suited for microfinance and agricultural lending institutions. Authentication uses an API key in the `apiKey` header.

| Parameter | Environment Variable | Description |
|---|---|---|
| Base URL | `MAMBU_BASE_URL` | Mambu tenant API base (e.g., `https://nexcom.mambu.com/api`) |
| API Key | `MAMBU_API_KEY` | Mambu API key |

Mambu-specific mappings: loans map to Mambu `LoanAccount`; savings/escrow map to Mambu `SavingsAccount`; repayments map to Mambu `Repayment` transactions.

### 3.4 Mojaloop (Interoperability Layer)

The existing `services/mojaloop-adapter` handles real-time interbank payment routing via the **Mojaloop** open-source interoperability platform. NEXCOM is registered as a **DFSP** (Digital Financial Services Provider) and uses the Mojaloop APIs for:

- **Account lookup** — resolving MSISDN/NIN to DFSP account via the ALS (Account Lookup Service)
- **Quote requests** — obtaining fee quotes before initiating transfers
- **Transfers** — executing real-time settlement across DFSPs

The Mojaloop adapter is already wired into the settlement engine and is triggered automatically when a trade settles and the counterparty is on a different DFSP.

---

## 4. Agricultural Banking Module

The Agricultural Banking Module (`services/core-banking/internal/agribanking/`) orchestrates the complete agri-finance lifecycle. It sits above the CBS adapter layer and coordinates banking operations with NEXCOM-specific business logic.

### 4.1 Lifecycle Overview

The agri-finance lifecycle follows this sequence:

```
1. KYC Approval
       │
       ▼
2. Farmer Onboarding → Create escrow account in CBS
       │
       ▼
3. Crop Cycle Registration → Record planting season, farm size, crop type
       │
       ▼
4. Input Loan Disbursement → CBS creates loan, disburses to farmer account
       │                      Optionally collateralized by warehouse receipt
       ▼
5. Harvest → Warehouse Receipt Generation (NEXCOM WMS)
       │
       ▼
6. WR-Backed Financing → CBS creates loan at LTV × market value of WR
       │                   WR is locked in NEXCOM WMS until repaid
       ▼
7. Commodity Sale on Exchange → Trade matched, settlement initiated
       │
       ▼
8. Settlement → Gross proceeds → Repay loan → Deduct fees → Net to farmer
       │
       ▼
9. Loan Closure → CBS marks loan as CLOSED, WR released if pledged
       │
       ▼
10. Insurance Claim (if applicable) → Payout credited, loan balance reduced
```

### 4.2 Warehouse Receipt Financing

Warehouse Receipt (WR) financing is the flagship product of the NEXCOM agri-banking module. It enables farmers to access liquidity against stored commodities without selling at harvest-time (when prices are typically lowest).

The financing flow:

1. Farmer deposits commodity at a certified warehouse. The NEXCOM WMS generates a digital WR.
2. Farmer requests WR-backed financing via the NEXCOM mobile app or PWA.
3. The `IssueWRFinancing` procedure calls the CBS adapter to create a loan at **LTV × current market value** of the commodity (default LTV: 70%).
4. The WR is flagged as `PLEDGED` in the NEXCOM database, preventing it from being traded until the loan is repaid.
5. On trade settlement, `ProcessSettlementRepayment` automatically repays the outstanding loan balance from the gross proceeds, releases the WR pledge, and credits the net amount to the farmer's account.

| Parameter | Default | Description |
|---|---|---|
| LTV Ratio | 70% | Loan-to-value ratio against commodity market price |
| Interest Rate | 12% p.a. | Annual interest rate on WR-backed loans |
| Maximum Tenor | 12 months | Maximum loan duration (aligned to crop cycle) |
| Eligible Commodities | All NEXCOM-listed | Any commodity with a certified warehouse |

### 4.3 Insurance Integration

The module supports **area-yield-index insurance** (AYII), where payouts are triggered by objective weather or yield data rather than individual farm assessments, eliminating moral hazard and reducing claims processing costs.

Insurance policies are created via `CreateInsurancePolicy`, which:
1. Debits the premium from the farmer's account via the CBS.
2. Records the policy linked to the crop cycle.
3. Publishes `agri.insurance.policy_created` to Kafka for the risk and analytics services.

Claims are processed via `ProcessInsuranceClaim`, which credits the payout to the farmer's account and reduces any outstanding loan balance.

---

## 5. Event-Driven Integration via Kafka

All banking operations publish events to Kafka topics under the `agri.*` namespace. This enables downstream services (risk, analytics, notifications, audit) to react to banking events without tight coupling.

| Kafka Topic | Published By | Consumed By | Description |
|---|---|---|---|
| `agri.farmer.onboarded` | Agribanking | Notifications, Analytics | New farmer account created |
| `agri.crop_cycle.registered` | Agribanking | Risk, Analytics | New planting season started |
| `agri.loan.disbursed` | Agribanking | Risk, Notifications, Audit | Input loan disbursed |
| `agri.wr_financing.issued` | Agribanking | Risk, Notifications, WMS | WR-backed loan created |
| `agri.loan.repayment_processed` | Agribanking | Notifications, Analytics | Loan repayment from settlement |
| `agri.insurance.policy_created` | Agribanking | Notifications, Risk | Insurance policy activated |
| `agri.insurance.claim_processed` | Agribanking | Notifications, Analytics | Insurance claim paid |
| `settlement.completed` | Settlement Engine | Agribanking | Triggers loan repayment |
| `kyc.approved` | KYC Service | Agribanking | Triggers farmer onboarding |

The middleware hub (`services/middleware-hub`) bridges these Kafka topics to Dapr pub/sub, Fluvio streaming, and Temporal workflows as needed.

---

## 6. tRPC Integration (Node.js ↔ Core Banking Service)

The Node.js API server exposes banking operations to the frontend via tRPC procedures in `server/routers/bankingRouter.ts`. These procedures call the Core Banking Integration Service over HTTP REST.

Key procedures:

| tRPC Procedure | HTTP Endpoint | Description |
|---|---|---|
| `banking.getAccounts` | `GET /accounts/owner/:id` | List farmer's bank accounts |
| `banking.getTransactions` | `GET /accounts/:ref/transactions` | Transaction history |
| `banking.requestWRFinancing` | `POST /loans/wr-finance` | Request WR-backed loan |
| `banking.getLoanStatus` | `GET /loans/:ref` | Check loan balance and status |
| `banking.initiatePayment` | `POST /payments` | Initiate a payment instruction |
| `banking.getPaymentStatus` | `GET /payments/:id/status` | Poll payment status |

All procedures are `protectedProcedure` — they require an authenticated NEXCOM session. The Core Banking Integration Service performs an additional authorization check using the `X-Nexcom-User-ID` header to ensure users can only access their own accounts.

---

## 7. Database Schema Extensions

The following tables were added to `drizzle/schema.ts` to support banking integration:

| Table | Purpose |
|---|---|
| `bank_accounts` | Mirrors CBS account references for fast lookup without CBS round-trips |
| `agri_loans` | Tracks loan state (disbursed, outstanding balance, collateral) |
| `crop_cycles` | Records planting seasons linked to farmers and loans |
| `insurance_policies` | Tracks crop insurance policies and claims |
| `payment_instructions` | Audit trail of all payment instructions sent to CBS |
| `wr_pledges` | Records warehouse receipts pledged as loan collateral |

These tables serve as a **read model** — the CBS remains the system of record for financial data, but NEXCOM caches key fields to avoid latency on every page load.

---

## 8. Security and Compliance

The core banking integration layer implements the following security controls:

**Authentication.** All CBS API calls use OAuth 2.0 client credentials. Tokens are cached in Redis with a 5-minute buffer before expiry to prevent clock-skew issues.

**Encryption.** All CBS communication uses TLS 1.3. Sensitive fields (account numbers, BVN, NIN) are encrypted at rest using AES-256-GCM before storage in the NEXCOM database.

**Audit Trail.** Every payment instruction, loan disbursement, and repayment is recorded in the `payment_instructions` table with a full request/response payload (sensitive fields redacted) for regulatory audit.

**Rate Limiting.** The Core Banking Integration Service enforces per-user rate limits via Redis to prevent abuse: 10 payment initiations per minute, 100 account lookups per minute.

**Permify Authorization.** The Permify service (`server/_core/permify.ts`) enforces fine-grained authorization: farmers can only access their own accounts; brokers can view account summaries for their clients; administrators have full access.

---

## 9. Deployment Configuration

The Core Banking Integration Service is included in `docker-compose.yml` and the Kubernetes manifests under `deployment/k8s/`:

```yaml
# docker-compose.yml (excerpt)
core-banking:
  build: ./services/core-banking
  ports:
    - "8090:8090"
  environment:
    CBS_PROVIDER: ${CBS_PROVIDER:-mock}
    TEMENOS_BASE_URL: ${TEMENOS_BASE_URL:-}
    TEMENOS_CLIENT_ID: ${TEMENOS_CLIENT_ID:-}
    TEMENOS_CLIENT_SECRET: ${TEMENOS_CLIENT_SECRET:-}
    KAFKA_BROKERS: kafka:9092
    REDIS_URL: redis://redis:6379
  depends_on:
    - kafka
    - redis
  healthcheck:
    test: ["CMD", "wget", "-qO-", "http://localhost:8090/health"]
    interval: 30s
    timeout: 10s
    retries: 3
```

For production Kubernetes deployment, the CBS credentials are stored as Kubernetes Secrets and injected via environment variables. The service runs with a non-root user and a read-only filesystem.

---

## 10. Testing Strategy

| Test Type | Location | Coverage |
|---|---|---|
| Unit tests | `services/core-banking/internal/*/` | Adapter logic, model validation |
| Integration tests | `services/core-banking/tests/integration/` | Mock CBS server, full request/response cycle |
| Contract tests | `services/core-banking/tests/contract/` | Pact consumer-driven contracts for each CBS adapter |
| End-to-end tests | `tests/e2e/agri-banking.spec.ts` | Full farmer lifecycle via Playwright |

The mock CBS adapter (`mockAdapter` in `cmd/server/main.go`) enables full end-to-end testing without a live CBS connection, returning realistic demo data for all operations.

---

## References

[1] Temenos Transact IRIS API Documentation — https://developer.temenos.com/apis

[2] Infosys Finacle Connect API Reference — https://developer.infosys.com/finacle

[3] Mambu REST API v2 Documentation — https://api.mambu.com

[4] Mojaloop DFSP Integration Guide — https://docs.mojaloop.io/api

[5] ISO 20022 Payment Message Standards — https://www.iso20022.org/catalogue-messages

[6] Warehouse Receipt Financing in Africa — UNCTAD Trust Fund for Trade — https://unctad.org/system/files/official-document/ditccom2009d19_en.pdf

[7] Area-Yield Index Insurance for Smallholder Farmers — World Bank — https://documents.worldbank.org/en/publication/documents-reports/documentdetail/agriculture-insurance
