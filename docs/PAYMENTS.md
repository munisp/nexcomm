# NEXCOM Payment Collection Rails (PAY-RAILS)

Pluggable payment-collection framework covering Nigerian domestic rails
(Paystack, Flutterwave, Monnify, Interswitch/NIBSS) plus international
(Stripe) and a deterministic Mock sandbox rail. This is the platform's direct
collection layer: deposits, fees and subscriptions flow through one
provider-agnostic API.

## Architecture

```
                         ┌───────────────────────────────┐
                         │  Client (React portal)         │
                         │  DepositPaymentSheet.tsx       │
                         │  PaymentCallback.tsx           │
                         └──────────────┬────────────────┘
                                        │ tRPC: payments.*
                                        ▼
┌─────────────────────────────────────────────────────────────────┐
│ server/routers/paymentsRouter.ts                                │
│   listProviders · initializeDeposit · verifyPayment ·           │
│   paymentStatus · myPayments                                    │
└───────┬───────────────────────────────────────────┬─────────────┘
        │                                           │
        ▼                                           ▼
┌───────────────────────┐               ┌───────────────────────────┐
│ services/payments/    │               │ drizzle tables:           │
│   registry.ts         │               │   payment_transactions    │
│   (config-driven      │               │   payment_webhook_events  │
│    provider picker)   │               └───────────────────────────┘
└───────┬───────────────┘
        │ PaymentProvider interface
 ┌──────┼──────┬─────────┬────────────┬──────────┬────────┐
 ▼      ▼      ▼         ▼            ▼          ▼        ▼
paystack flutterwave monnify interswitch   stripe    mock
 (NG)   (NG/intl)  (NG)     (NG/NIBSS NIP) (intl)  (sandbox)
        │                                            ▲
        ▼                                            │
 Providers' webhook endpoints ──► server/routes/paymentWebhooks.ts
                                  POST /api/payments/:provider/webhook
                                  (raw body, timing-safe HMAC verify,
                                   dedupe, 200-fast, async settle)
        │
        ▼ exactly once (guarded status transition)
┌───────────────────────────┐     ┌──────────────────────────────┐
│ TigerBeetle ledger credit │     │ Lakehouse ingestDeposit      │
│ (createLedgerTransfer,    │     │ (Bronze layer, fire & forget)│
│  code=6 deposit)          │     └──────────────────────────────┘
└───────────────────────────┘
```

## Conventions

- **Amounts are ALWAYS minor units** — kobo for NGN, cents for USD — as
  `number` (`amountMinor`). Maximum single collection is ₦10,000,000.00
  (enforced in `initializeDeposit`); far below `Number.MAX_SAFE_INTEGER`.
- Rails that speak **major units on the wire** (Flutterwave v3, Monnify)
  convert in one place (`toMajor`/`fromMajor` in the provider file).
  Interswitch and Paystack are natively minor-units (kobo).
- **Currencies** are ISO-4217 uppercase (`NGN`, `USD`, `GHS`, ...).
- **Statuses are normalised**: `pending | processing | success | failed |
  abandoned | refunded`. Provider-specific states map inside each provider.
- **Never log secrets or full PANs.** Instrument summaries are masked
  (`visa ****4081`). All webhook signature compares are timing-safe.
- All provider HTTP calls use axios with a **10s timeout and one retry**
  on 5xx/network errors (`server/services/payments/http.ts`).

## Configuration

| Variable | Default | Notes |
|---|---|---|
| `PAYMENT_PROVIDERS` | `mock` | Comma list of enabled rails, e.g. `paystack,flutterwave,stripe` |
| `PAYMENT_PROVIDER_PRIORITY` | (declaration order) | Comma list giving selection order for `resolveProvider` |
| `PAYMENT_CALLBACK_BASE_URL` | — | Base for `/payment/callback` redirects (else client `origin`) |
| `PAYMENT_WEBHOOK_BASE_URL` | — | Public base for webhook URLs advertised to providers |
| `PAYSTACK_SECRET_KEY` / `PAYSTACK_PUBLIC_KEY` | — | sk_test_/pk_test_ for sandbox |
| `PAYSTACK_WEBHOOK_SECRET` | (uses secret key) | Paystack signs webhooks with the **secret key**; set this only if your dashboard uses a separate HMAC key |
| `FLUTTERWAVE_SECRET_KEY` / `FLUTTERWAVE_PUBLIC_KEY` | — | FLWSECK_TEST- for sandbox |
| `FLUTTERWAVE_WEBHOOK_HASH` | — | Dashboard "secret hash" (sent verbatim in `verif-hash`) |
| `MONNIFY_API_KEY` / `MONNIFY_SECRET_KEY` / `MONNIFY_CONTRACT_CODE` | — | Secret key doubles as webhook HMAC key |
| `MONNIFY_BASE_URL` | `https://api.monnify.com` | Sandbox: `https://sandbox.monnify.com` |
| `INTERSWITCH_CLIENT_ID` / `INTERSWITCH_CLIENT_SECRET` / `INTERSWITCH_MERCHANT_CODE` | — | Client secret doubles as webhook HMAC key |
| `INTERSWITCH_BASE_URL` | `https://api-d.interswitchng.com` | QA: `https://qa.interswitchng.com` |
| `INTERSWITCH_PASSPORT_URL` | `https://passport.interswitchng.com` | QA: `https://passport.qa.interswitchng.com` |
| `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` | — | Shared with the legacy stripeRouter |
| `MOCK_SETTLE_SECONDS` | `5` | Sandbox auto-settle delay |
| `MOCK_WEBHOOK_SECRET` | `mock-webhook-dev-secret` | Sandbox webhook HMAC key |

**Production guard:** the mock rail is never resolvable when
`NODE_ENV=production` unless `PAYMENT_PROVIDERS` explicitly contains `mock`.

## Provider selection & failover

`resolveProvider({currency, channel, amountMinor})` walks enabled providers
in `PAYMENT_PROVIDER_PRIORITY` order and returns the first that (a) is
configured (credentials present), (b) supports the currency, (c) supports the
channel. The client can also pin a rail explicitly (`provider` input). For
failover, order `PAYMENT_PROVIDER_PRIORITY` as e.g. `paystack,flutterwave,
monnify` — if Paystack credentials are absent/misconfigured it drops out of
resolution automatically. Mid-flow failover (initialize on A, verify on B)
is deliberately NOT supported: a payment is bound to its rail by
`provider`+`providerRef`.

## Idempotency & exactly-once ledger credit

1. **Client idempotency:** `initializeDeposit` requires a client-generated
   `idempotencyKey` (nanoid). The unique index on
   `payment_transactions.idempotency_key` makes retries safe — a re-submit
   returns the existing payment instead of double-charging.
2. **Webhook idempotency:** every inbound webhook is inserted into
   `payment_webhook_events` with `unique(provider, event_id)`. A unique
   violation = "already seen" → immediate 200, no reprocessing. The route
   acknowledges within 200ms and processes async via `setImmediate`.
3. **Exactly-once settlement:** both the interactive verify path and the
   webhook path settle through `settlePaymentSuccess()`, which performs a
   guarded transition — `UPDATE payment_transactions SET status='success'
   WHERE id=? AND status IN ('pending','processing') RETURNING`. Only the
   first caller gets a row back, so the TigerBeetle credit
   (`createLedgerTransfer`, code=6 deposit, minor units) runs exactly once
   even under concurrent verify + webhook + provider retries.
4. **Ledger SLA:** the interactive verify awaits the credit for up to 3s;
   if the SLA is missed the credit continues in the background
   (`settle: "settled-queued"`). A failed credit logs
   `LEDGER CREDIT FAILED` loudly for the reconciliation job — it is never
   silently dropped and never rolled back (the payment IS successful).
5. **Amount sanity:** verify/webhook paths compare collected vs authorized
   minor units and refuse to settle on mismatch (manual review).

## Adding a new rail in 5 steps

1. Create `server/services/payments/providers/myrail.ts` implementing the
   `PaymentProvider` interface from `services/payments/types.ts`
   (`initializePayment`, `verifyPayment`, `refund`,
   `verifyWebhookSignature` with `crypto.timingSafeEqual`, `parseWebhook`).
2. Register it in `server/services/payments/registry.ts` — add to
   `ALL_PROVIDERS`.
3. Add its env vars (`MYRAIL_SECRET_KEY`, ...) to `server/_core/env.ts` and
   your deployment manifests.
4. Configure the webhook URL in the rail's dashboard:
   `https://<host>/api/payments/myrail/webhook`.
5. Enable it: `PAYMENT_PROVIDERS=paystack,myrail,mock` (and optionally
   `PAYMENT_PROVIDER_PRIORITY`). Done — the tRPC API, webhook route, client
   picker, dedupe and ledger settlement all work unchanged.

## Per-provider dashboard setup

### Paystack (sandbox)
- Dashboard → Settings → API Keys & Webhooks: copy **test** secret/public
  keys into `PAYSTACK_SECRET_KEY`/`PAYSTACK_PUBLIC_KEY`.
- Webhook URL: `https://<host>/api/payments/paystack/webhook`. Paystack signs
  with your secret key (HMAC-SHA512, `x-paystack-signature`).
- Test cards: 4084 0840 8408 4081 (success), any future expiry/CVV.

### Flutterwave v3 (sandbox)
- Dashboard → Settings → APIs: `FLWSECK_TEST-...` into `FLUTTERWAVE_SECRET_KEY`.
- Settings → Webhooks: URL `https://<host>/api/payments/flutterwave/webhook`
  and set a **secret hash** → `FLUTTERWAVE_WEBHOOK_HASH` (verified against the
  `verif-hash` header).

### Monnify (sandbox)
- Base URL `https://sandbox.monnify.com` → `MONNIFY_BASE_URL`.
- Portal → API keys: `MONNIFY_API_KEY`, `MONNIFY_SECRET_KEY`; contract code
  from your wallet → `MONNIFY_CONTRACT_CODE`.
- Webhook URL `https://<host>/api/payments/monnify/webhook` (HMAC-SHA512 with
  the secret key, `monnify-signature`).
- Optional: enable **reserved accounts** for dedicated per-user virtual
  account numbers (auto-reconciling NIP transfers).

### Interswitch (QA)
- Get `client_id`/`client_secret`/`merchant_code` from the Interswitch
  developer console; QA passport `https://passport.qa.interswitchng.com`.
- We use the **hosted collections API** (no PANs touch our servers —
  preserves PCI SAQ-A posture). Webhook: HMAC-SHA512 with the client secret.

### Stripe
- Reuses the existing `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET`. The legacy
  `/api/stripe/webhook` route (stripeRouter) keeps working; the framework
  route `/api/payments/stripe/webhook` handles framework-initiated sessions
  (`metadata.framework = "pay-rails"`).

## Local development: webhook tunneling

Providers need a public URL for webhooks. Use ngrok:

```bash
ngrok http 3000
# set PAYMENT_WEBHOOK_BASE_URL=https://<your>.ngrok.io
# paste https://<your>.ngrok.io/api/payments/<provider>/webhook into the
# provider dashboard
```

For the mock rail no tunnel is needed — replay webhooks locally:

```bash
BODY='{"eventId":"dev-1","type":"mock.payment","reference":"<providerRef>","status":"success","amountMinor":100000,"currency":"NGN"}'
SIG=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "mock-webhook-dev-secret" | awk '{print $2}')
curl -X POST http://localhost:3000/api/payments/mock/webhook \
  -H "Content-Type: application/json" -H "x-mock-signature: $SIG" -d "$BODY"
```

Smoke test the whole pipeline: `BASE_URL=http://localhost:3000 node
scripts/smoke-payments.mjs` (add `SMOKE_AUTH_COOKIE` for the authenticated
initialize→verify→success flow).

## Go-live checklist

- [ ] `NODE_ENV=production`, `PAYMENT_PROVIDERS` lists only live rails
      (mock absent → sandbox rail hard-disabled).
- [ ] Live keys (`sk_live_`, `FLWSECK-`, production Monnify/Interswitch
      credentials) injected via secrets manager — never in git.
- [ ] Webhook URLs registered on each provider dashboard pointing at the
      production host; signature secrets match env vars.
- [ ] Migration `0080_payment_transactions.sql` applied; both tables present.
- [ ] CBN: collections settle into a CBN-licensed partner bank account via
      the rail's settlement; confirm rail licensing (PSSP/PTSP) documents on
      file for compliance. NIBSS NIP reach for Interswitch requires completed
      NIP participant onboarding.
- [ ] PCI-DSS: hosted-checkout-only posture (SAQ-A). Never enable direct card
      endpoints (e.g. Interswitch `/api/v3/purchases`) without a SAQ-D scope
      review.
- [ ] Reconciliation job monitors `LEDGER CREDIT FAILED` and
      `AMOUNT MISMATCH` log lines; daily payout-vs-ledger tie-out.
- [ ] Rate limits reviewed for `/api/payments/*` (webhook endpoints are
      unauthenticated by design — signature is the auth; consider IP
      allowlisting per provider docs).
- [ ] Run `node scripts/smoke-payments.mjs` against staging with live-test
      keys before cutover.
