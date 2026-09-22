/**
 * NEXCOM Exchange — Payment Collection Rail Framework (PAY-RAILS)
 * ─────────────────────────────────────────────────────────────────────────────
 * Pluggable provider abstraction for direct collection rails:
 *   Nigerian domestic: Paystack, Flutterwave, Monnify, Interswitch (NIBSS NIP)
 *   International:     Stripe (wraps the existing stripeRouter helpers)
 *   Sandbox:           Mock (deterministic, non-production)
 *
 * CONVENTIONS
 * ───────────
 * - Amounts are ALWAYS minor units (kobo for NGN, cents for USD) as `number`.
 *   All amounts handled by this framework are well below Number.MAX_SAFE_INTEGER
 *   (max single collection is capped in paymentsRouter at 1e12 minor units).
 * - Currency is an ISO-4217 uppercase code ("NGN", "USD", "GHS", "KES", ...).
 * - Statuses are NORMALISED across providers to PaymentStatus below.
 * - Providers NEVER log secrets or full PANs; only masked refs.
 * - Webhook signature checks MUST use timing-safe comparison.
 */

/** Payment channels a rail can collect through. */
export type PaymentChannel =
  | "card"
  | "bank_transfer"
  | "ussd"
  | "qr"
  | "mobile_money"
  | "bank_debit";

/** Normalised payment lifecycle status (provider-agnostic). */
export type PaymentStatus =
  | "pending"
  | "processing"
  | "success"
  | "failed"
  | "abandoned"
  | "refunded";

/** What the payment is for. */
export type PaymentPurpose = "deposit" | "fee" | "subscription";

/** Declared provider capabilities — surfaced to the client UI. */
export interface PaymentProviderCapabilities {
  refunds: boolean;
  payouts: boolean;
  recurring: boolean;
  webhooks: boolean;
}

/** Input to provider.initializePayment(). */
export interface PaymentIntent {
  /** Internal idempotency key (unique per payment_transactions row). */
  idempotencyKey: string;
  /** Amount in minor units (kobo/cents). */
  amountMinor: number;
  /** ISO-4217 currency, e.g. "NGN". */
  currency: string;
  /** Requested channel, or undefined for provider default. */
  channel?: PaymentChannel;
  purpose: PaymentPurpose;
  /** Payer identity hints (never include PANs). */
  customer: {
    userId: number;
    email?: string | null;
    name?: string | null;
    phone?: string | null;
  };
  /** Absolute URL the provider should redirect back to after payment. */
  callbackUrl?: string;
  /** Absolute URL the provider should POST webhooks to. */
  webhookUrl?: string;
  /** Free-form provider metadata (jsonb-safe). */
  metadata?: Record<string, unknown>;
}

/** Result of provider.initializePayment(). */
export interface PaymentInitResult {
  /** Provider-side reference (transaction/session reference). */
  providerRef: string;
  /** Hosted checkout / authorization URL to open (card, bank_transfer hosted). */
  authorizationUrl?: string;
  /** USSD code to display, e.g. "*737*000*12345#". */
  ussdCode?: string;
  /** Payload for QR rendering (client renders with `qrcode`). */
  qrData?: string;
  /** Dedicated/reserved account details for offline bank transfer. */
  transferAccount?: {
    bankName: string;
    accountNumber: string;
    accountName: string;
  };
  /** Provider-side expiry of this authorization (ISO date). */
  expiresAt?: Date;
  /** Raw provider payload (stored in metadata for audit — no secrets). */
  raw?: Record<string, unknown>;
}

/** Normalised result of provider.verifyPayment(). */
export interface PaymentResult {
  providerRef: string;
  status: PaymentStatus;
  /** Amount actually collected, minor units (may differ on partial/refund). */
  amountMinor: number;
  currency: string;
  channel?: PaymentChannel;
  /** When the provider marked the payment successful. */
  paidAt?: Date;
  /** Masked instrument summary only, e.g. "visa ****4081" — NEVER full PAN. */
  instrument?: string;
  /** Provider fee in minor units, when known. */
  feeMinor?: number;
  /** Failure/abandon reason, when applicable. */
  failureReason?: string;
  raw?: Record<string, unknown>;
}

/** Normalised webhook event after provider.parseWebhook(). */
export interface NormalizedWebhookEvent {
  /** Provider-unique event id — dedupe anchor (payment_webhook_events). */
  eventId: string;
  /** Provider event type string, e.g. "charge.success". */
  type: string;
  /** The payment this event concerns (null for non-payment events). */
  providerRef: string | null;
  /** Normalised status implied by the event, if any. */
  status?: PaymentStatus;
  amountMinor?: number;
  currency?: string;
  paidAt?: Date;
  failureReason?: string;
  raw?: Record<string, unknown>;
}

/** Express-compatible header bag (lowercased keys). */
export type WebhookHeaders = Record<string, string | string[] | undefined>;

/**
 * The contract every collection rail implements.
 * Implementations live in ./providers/<name>.ts and are wired by registry.ts.
 */
export interface PaymentProvider {
  /** Stable machine name, e.g. "paystack". */
  readonly name: string;
  /** Human label for the UI, e.g. "Paystack". */
  readonly displayName: string;
  /** ISO currencies this rail can collect. */
  readonly currencies: string[];
  /** Channels this rail supports. */
  readonly channels: PaymentChannel[];
  readonly capabilities: PaymentProviderCapabilities;

  /** True when the provider has the credentials/config it needs to run. */
  isConfigured(): boolean;

  /** Create a payment session/authorization with the rail. */
  initializePayment(intent: PaymentIntent): Promise<PaymentInitResult>;

  /** Pull the authoritative status for a payment from the rail. */
  verifyPayment(providerRef: string): Promise<PaymentResult>;

  /** Refund a successful payment (full when amountMinor omitted). */
  refund(payment: PaymentResult, amountMinor?: number): Promise<PaymentResult>;

  /** Verify the authenticity of an inbound webhook (timing-safe). */
  verifyWebhookSignature(headers: WebhookHeaders, rawBody: Buffer): boolean;

  /** Normalise an inbound webhook payload. Signature already verified. */
  parseWebhook(headers: WebhookHeaders, rawBody: Buffer): NormalizedWebhookEvent;
}

/** Selector used by the registry to pick a rail. */
export interface ProviderSelector {
  currency: string;
  channel?: PaymentChannel;
  amountMinor?: number;
}
