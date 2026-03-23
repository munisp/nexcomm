# Loan Process Integration with Core Banking

**NEXCOM Exchange — Technical Architecture Reference**  
*Author: Manus AI | Version: 1.0 | Updated: March 2026*

---

## Overview

NEXCOM's loan origination and servicing pipeline spans four distinct layers: the **user-facing channel** (PWA, USSD, WhatsApp, Telegram), the **tRPC application layer** (Node.js + Express), the **core banking integration service** (Python FastAPI + Go adapters), and the **core banking system** (Temenos T24, Finacle, or Mambu). This document traces every hop a loan request makes from the moment a farmer dials `*384*4#` or clicks "Apply for Loan" in the web app, all the way through to disbursement, repayment, and final settlement via TigerBeetle.

---

## 1. Entry Points

NEXCOM supports four loan entry channels. Each channel normalises its input into the same internal `LoanApplicationPayload` structure before forwarding to the tRPC layer.

| Channel | Entry Point | Auth Method | Loan Types Supported |
|---|---|---|---|
| PWA (Web) | `/banking` → Loan tab → Apply form | Manus OAuth session cookie | All types |
| USSD | `*384*4#` → option 2 (Apply Loan) | 4-digit USSD PIN | Input financing only |
| WhatsApp | `LOAN APPLY <type> <amount>` | Phone number + OTP | Input financing, crop insurance |
| Telegram | `/loan apply <type> <amount>` | Telegram user ID + PIN | Input financing only |

---

## 2. USSD Loan Application Flow

The USSD channel is implemented in the **Rust `ussd-engine`** service (`services/ussd-engine/src/menu.rs`). The 5-step state machine is:

```
LOAN → LOAN_APPLY_TYPE → LOAN_APPLY_AMOUNT → LOAN_APPLY_TENOR
     → LOAN_APPLY_CONFIRM → LOAN_APPLY_PIN → [submit to DB + Kafka]
```

**Step 1 — Type selection (`LOAN_APPLY_TYPE`):** The user selects from a numbered list of input types: Seeds (1), Fertiliser (2), Pesticides (3), Equipment (4), or Working Capital (5). The selection is stored in `session.pending_loan.input_type`.

**Step 2 — Amount entry (`LOAN_APPLY_AMOUNT`):** The user types a numeric amount in NGN. The engine validates that it is a positive number ≤ 5,000,000 NGN (the USSD channel cap). The value is stored in `session.pending_loan.amount_ngn`.

**Step 3 — Tenor selection (`LOAN_APPLY_TENOR`):** The user selects a repayment tenor: 3 months (1), 6 months (2), 9 months (3), or 12 months (4). The selected tenor in months is stored in `session.pending_loan.tenor_months`.

**Step 4 — Confirmation (`LOAN_APPLY_CONFIRM`):** A summary screen is displayed showing type, amount, tenor, and estimated monthly repayment (calculated as `amount / tenor * 1.12` to include a 12% annualised interest estimate). The user confirms with `1` or cancels with `2`.

**Step 5 — PIN verification (`LOAN_APPLY_PIN`):** The user enters their 4-digit USSD PIN. The engine calls `db::verify_pin()` which compares the bcrypt hash stored in `ussd_pins`. On success, `db::apply_loan()` is called to insert the application into the `input_financing_loans` table, and a Kafka event `nexcom.loan.applied` is emitted via the engine's `KafkaProducer`.

---

## 3. Web (PWA) Loan Application Flow

The web interface at `/banking` renders `BankingDashboard.tsx`, which contains a multi-tab layout. The Loans tab hosts a `LoanApplicationForm` component that calls `trpc.banking.applyLoan.useMutation()`.

The tRPC procedure `banking.applyLoan` is defined in `server/routers/banking.ts`:

```typescript
applyLoan: protectedProcedure
  .input(z.object({
    bankName: z.string(),
    loanType: z.enum(['INPUT_FINANCING', 'WAREHOUSE_RECEIPT', 'CROP_INSURANCE', 'WORKING_CAPITAL']),
    requestedAmountNgn: z.number().positive(),
    tenorMonths: z.number().int().min(1).max(24),
    collateralType: z.string().optional(),
    collateralValueNgn: z.number().optional(),
    purposeDescription: z.string().optional(),
  }))
  .mutation(async ({ ctx, input }) => {
    // 1. Insert into bank_financing_applications
    // 2. Emit Kafka event nexcom.loan.applied
    // 3. Call core-banking service to pre-screen
    // 4. Return application ID and status
  })
```

The procedure inserts a record into `bank_financing_applications` with status `APPLIED`, then calls the **core-banking integration service** via HTTP POST to `/api/v1/loans/apply`.

---

## 4. Core Banking Integration Service

The core banking integration service lives at `services/core-banking/agribanking_service.py`. It is a Python FastAPI application running on port `:8090` that acts as a **protocol adapter** between NEXCOM's internal domain model and the external CBS APIs.

### 4.1 Adapter Registry

The service uses a plugin registry pattern (`registry.go` + `generic/adapter.go` in the Go sub-module) to support multiple CBS backends without changing the calling code:

| Adapter | CBS | Protocol | Auth |
|---|---|---|---|
| `temenos` | Temenos T24 | REST/JSON over HTTPS | OAuth2 client credentials |
| `finacle` | Infosys Finacle | SOAP/XML + REST | API key + HMAC signature |
| `mambu` | Mambu Cloud | REST/JSON | Basic auth + API key |

The active adapter is selected at startup via the `CBS_ADAPTER` environment variable. All adapters implement the same `AgribankingAdapter` interface:

```python
class AgribankingAdapter(ABC):
    async def onboard_farmer(self, payload: FarmerOnboardingPayload) -> str: ...
    async def apply_loan(self, payload: LoanApplicationPayload) -> LoanApplicationResult: ...
    async def disburse_loan(self, loan_id: str) -> DisbursementResult: ...
    async def record_repayment(self, payload: RepaymentPayload) -> RepaymentResult: ...
    async def get_account_balance(self, account_id: str) -> AccountBalance: ...
    async def get_loan_status(self, loan_id: str) -> LoanStatus: ...
```

### 4.2 Loan Application to CBS

When the core-banking service receives `POST /api/v1/loans/apply`, it:

1. **Validates the payload** against the `LoanApplicationPayload` Pydantic model.
2. **Resolves the farmer's CBS customer ID** by querying `farmer_profiles.cbs_customer_id`. If the farmer is not yet onboarded in the CBS, it calls `adapter.onboard_farmer()` first, which creates a customer record in T24/Finacle/Mambu and returns the CBS customer ID. This ID is then written back to `farmer_profiles.cbs_customer_id`.
3. **Calls `adapter.apply_loan()`** which translates the NEXCOM payload into the CBS-specific format and submits it. For Temenos T24, this is a `POST /api/v1/AA/InputFinancingLoans` call; for Finacle, it is a SOAP `CreateLoanAccount` envelope; for Mambu, it is `POST /api/v1/loans`.
4. **Receives a CBS loan reference** (e.g., `AA2600123456` for T24) and writes it back to `bank_financing_applications.cbs_loan_reference`.
5. **Updates the application status** to `UNDER_REVIEW` and emits a `nexcom.loan.cbs_submitted` Kafka event.

### 4.3 Loan Approval and Disbursement

Loan approval is an asynchronous process. The CBS sends a webhook callback to `POST /api/v1/webhooks/loan-status` when the loan decision is made. The service handles three outcomes:

- **APPROVED**: Updates `bank_financing_applications.status` to `APPROVED`, sets `approved_amount_ngn` and `repayment_due_date`, emits `nexcom.loan.approved` Kafka event. The Node.js `loanNotificationBroadcaster.ts` picks up this event and sends a real-time WebSocket push to the borrower's browser session.
- **REJECTED**: Updates status to `REJECTED`, stores the rejection reason, emits `nexcom.loan.rejected`.
- **DISBURSED**: Triggers the disbursement flow (see §4.4).

### 4.4 Disbursement via TigerBeetle

Loan disbursement involves two parallel operations:

1. **CBS disbursement**: The CBS adapter calls `adapter.disburse_loan()`, which instructs the CBS to transfer funds from the lending pool account to the borrower's CBS account. The CBS returns a transaction reference.

2. **TigerBeetle settlement**: NEXCOM's settlement engine (`services/settlement-engine/`) creates a double-entry ledger entry in TigerBeetle to record the disbursement on the NEXCOM side. The entry debits the `LOAN_POOL` account and credits the borrower's `CLEARING_ACCOUNT`. TigerBeetle's immutable ledger provides an audit trail independent of the CBS.

The `bank_financing_applications` record is updated with `status = 'DISBURSED'`, `disbursement_date`, and `tigerbeetle_transfer_id`.

---

## 5. Repayment Flow

### 5.1 USSD Repayment

The USSD repayment flow is a 5-step state machine in `menu.rs`:

```
LOAN → LOAN_REPAY_SELECT → LOAN_REPAY_AMOUNT → LOAN_REPAY_PROVIDER
     → LOAN_REPAY_CONFIRM → LOAN_REPAY_PIN → [db::make_repayment + Kafka]
```

The user selects an active loan from a numbered list (fetched via `db::get_active_loans()`), enters the repayment amount, selects a mobile money provider (MTN MoMo, Airtel Money, Opay, or Bank Transfer), confirms, and authenticates with their PIN. The `db::make_repayment()` function inserts a repayment record and emits `nexcom.loan.repayment_initiated`.

### 5.2 Web Repayment

The web repayment form in `BankingDashboard.tsx` calls `trpc.banking.submitRepayment.useMutation()`, which calls the core-banking service at `POST /api/v1/loans/repay`. The adapter calls the CBS repayment API and records the transaction in TigerBeetle.

### 5.3 Repayment Settlement via TigerBeetle

Each repayment creates a TigerBeetle transfer that:
- Debits the borrower's `CLEARING_ACCOUNT` by the repayment amount.
- Credits the `LOAN_POOL` account.
- Records the `nexcom.loan.repaid` Kafka event with the TigerBeetle transfer ID.

When the outstanding balance reaches zero, the loan status transitions to `CLOSED` and the CBS is notified via `adapter.record_repayment()` with `final_payment = true`.

---

## 6. End-to-End Data Flow Diagram

```
Farmer (USSD/Web/WhatsApp/Telegram)
    │
    ▼
[Channel Layer]
  USSD Engine (Rust :8020)
  Channel Gateway (Go :8030)
  tRPC Server (Node.js :3000)
    │
    ▼ HTTP POST /api/v1/loans/apply
[Core Banking Integration Service]
  agribanking_service.py (Python :8090)
  Adapter Registry (Temenos / Finacle / Mambu)
    │
    ├──▶ CBS API (T24 / Finacle / Mambu)
    │         └── Returns CBS loan reference
    │
    ├──▶ PostgreSQL (bank_financing_applications)
    │         └── Stores application + CBS reference
    │
    └──▶ Kafka (nexcom.loan.applied)
              │
              ▼
         [Async Approval Flow]
         CBS Webhook → /api/v1/webhooks/loan-status
              │
              ├── APPROVED → Kafka nexcom.loan.approved
              │              → WebSocket push to browser
              │
              └── DISBURSED → TigerBeetle double-entry
                             → Kafka nexcom.loan.disbursed
                             → USSD/WhatsApp/Telegram notification

[Repayment]
Farmer → USSD/Web → tRPC → Core Banking Service
    → CBS repayment API
    → TigerBeetle debit clearing_account / credit loan_pool
    → Kafka nexcom.loan.repaid
    → Status: REPAYING → CLOSED (when balance = 0)
```

---

## 7. Database Schema

The loan lifecycle is tracked across three primary tables:

| Table | Purpose | Key Columns |
|---|---|---|
| `bank_financing_applications` | Loan applications and status | `user_id`, `bank_name`, `status`, `cbs_loan_reference`, `approved_amount_ngn`, `repayment_due_date` |
| `input_financing_loans` | USSD input financing loans | `farmer_id`, `input_type`, `requested_value_ngn`, `tenor_months`, `status` |
| `notifications` | Loan event notifications | `user_id`, `type`, `title`, `message` |

The `bank_financing_status` enum tracks the full lifecycle: `APPLIED → UNDER_REVIEW → APPROVED → DISBURSED → REPAYING → CLOSED` (with `REJECTED` and `CANCELLED` as terminal states).

---

## 8. Kafka Event Topology

All loan events flow through Kafka, enabling decoupled downstream consumers (notification service, analytics, blockchain audit):

| Topic | Producer | Consumers |
|---|---|---|
| `nexcom.loan.applied` | USSD Engine, tRPC server | Core banking service, notification service |
| `nexcom.loan.cbs_submitted` | Core banking service | Analytics, audit log |
| `nexcom.loan.approved` | Core banking service | Notification broadcaster, WhatsApp/Telegram channel |
| `nexcom.loan.disbursed` | Core banking service | Settlement engine (TigerBeetle), notification broadcaster |
| `nexcom.loan.repayment_initiated` | USSD Engine, tRPC server | Core banking service |
| `nexcom.loan.repaid` | Core banking service | Settlement engine, analytics |

---

## 9. Security and Compliance

All loan data in transit is encrypted via TLS 1.3. The core banking service authenticates to the CBS using OAuth2 client credentials (Temenos), HMAC-signed API keys (Finacle), or Basic auth + API key (Mambu). Sensitive fields (PIN hashes, CBS credentials) are stored encrypted at rest using AES-256-GCM. Access to the `banking.applyLoan` tRPC procedure is gated by `protectedProcedure`, which requires a valid Manus OAuth session. USSD loan submission requires PIN verification via bcrypt comparison. All loan operations are logged to the Permify audit trail with the `loan:apply`, `loan:approve`, and `loan:disburse` action codes.

---

## 10. Configuration Reference

| Environment Variable | Default | Description |
|---|---|---|
| `CBS_ADAPTER` | `temenos` | Active CBS adapter (`temenos`, `finacle`, `mambu`) |
| `CBS_API_URL` | `https://t24.bank.internal/api` | CBS base URL |
| `CBS_CLIENT_ID` | — | OAuth2 client ID for CBS auth |
| `CBS_CLIENT_SECRET` | — | OAuth2 client secret for CBS auth |
| `CORE_BANKING_URL` | `http://localhost:8090` | Core banking service base URL |
| `TIGERBEETLE_ADDRESS` | `localhost:3000` | TigerBeetle cluster address |
| `KAFKA_BROKERS` | `localhost:9092` | Kafka broker list |
| `LOAN_MAX_USSD_AMOUNT` | `5000000` | Maximum loan amount via USSD (NGN) |

---

*This document is maintained alongside the codebase. For implementation details, refer to `services/core-banking/agribanking_service.py`, `server/routers/banking.ts`, and `services/ussd-engine/src/menu.rs`.*
