# Data Retention & Erasure Policy

NEXCOM Exchange handles both personal data (PII) and regulated financial
records. These have opposing obligations: GDPR/NDPR-style rights to access and
erasure, and financial-market rules requiring multi-year record retention.
This document defines how the platform reconciles them.

## Data subject rights (implemented)

`server/routers/privacyRouter.ts` (tRPC namespace `privacy`):

| Endpoint | Behaviour |
|---|---|
| `privacy.exportMyData` | Returns the caller's rows across `users`, `profiles`, `farmer_profiles`, `trader_profiles`, `orders`, `watchlist`, `price_alerts`, `notifications`, `warehouse_receipts`, `settlements`, `settlement_disputes`, `audit_log` as JSON. Logged to `privacy_requests`. |
| `privacy.requestErasure` | Anonymizes PII (see below) inside a single DB transaction and records the request in `privacy_requests`. Requires confirmation phrase `ERASE MY DATA`. |
| `privacy.myRequests` | Lists the caller's export/erasure request history. |

## Erasure model: hash-tombstone anonymization

Erasure **anonymizes** rather than deletes, because order/settlement rows must
remain attributable to a (now pseudonymous) principal for audit and dispute
purposes:

- A deterministic tombstone `sha256("nexcom-erasure:" + user_id)[:24]` replaces
  direct identifiers.
- Anonymized fields: name, email, phone, BVN, NIN, address, bank account
  details, KYC document references (`id_document_url`, `proof_of_address_url`,
  `bank_statement_url`), mobile-money details.
- `users.login_method` is set to `ERASED`, breaking login identity while
  preserving referential integrity.
- The erasure is logged in `audit_log` with the tombstone for regulator
  traceability.

## Retention schedule

| Data class | Tables | Retention | Rationale |
|---|---|---|---|
| Financial ledger | TigerBeetle transfers, `settlements`, `ledger_entries` | 7 years after settlement | Financial regulation / audit |
| Order & trade history | `orders`, `trades` | 7 years | Market-conduct record-keeping |
| Audit trail | `audit_log`, `privacy_requests`, `kyc_audit_log` | 7 years | Non-repudiation; proofs of erasure |
| Warehouse receipts | `warehouse_receipts` | Life of receipt + 7 years | Collateral/dispute evidence |
| PII (active users) | `users`, `profiles`, `farmer_profiles`, `trader_profiles` | Until erasure request | Data-minimization principle |
| Notifications | `notifications` | 24 months rolling | Operational |
| Webhook dead letters | `webhook_dead_letters` | 12 months | Incident investigation |
| USSD sessions | Redis `ussd:*` keys | 300 s TTL | Session-scoped |
| Telegram dedup keys | Redis `nexcom:telegram:update:*` | 24 h TTL | Provider redelivery window |
| KYC liveness sessions | `liveness_sessions` | Session + 24 h | Anti-fraud review window |
| Analytics lakehouse (bronze/silver/gold) | Delta Lake tables | Bronze 90 d / Silver 2 y / Gold 7 y | Aggregates support reporting obligations |

## Operational notes

- Erasure requests are **self-service and immediate**; there is no undo.
- Financial records are never rewritten during erasure. Regulators can link a
  tombstone to a former identity only via the (retained) audit log entry.
- Requests in `privacy_requests` are the system of record for demonstrating
  GDPR/NDPR compliance.
