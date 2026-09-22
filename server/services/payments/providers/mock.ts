/**
 * Mock sandbox collection rail (PAY-RAILS).
 *
 * A deterministic in-process rail for local dev, CI and demos — no network,
 * no credentials, instant feedback:
 *
 *  - initializePayment returns a fake authorizationUrl, a *737*-style USSD
 *    code, QR data and a reserved-account block (all derived from the ref).
 *  - verifyPayment auto-succeeds once the payment is MOCK_SETTLE_SECONDS old
 *    (default 5s) — UNLESS the reference contains "fail" (→ failed) or
 *    "stuck" (→ stays processing forever, for timeout-path testing).
 *  - Webhook: HMAC-SHA256 of the raw body with MOCK_WEBHOOK_SECRET in the
 *    `x-mock-signature` header — lets you test the full webhook pipeline
 *    locally with curl (see docs/PAYMENTS.md).
 *  - NEVER enabled in production unless PAYMENT_PROVIDERS explicitly lists
 *    "mock" (enforced in registry.ts).
 *
 * Env:
 *   MOCK_SETTLE_SECONDS   (default 5)
 *   MOCK_WEBHOOK_SECRET   (default "mock-webhook-dev-secret")
 */
import crypto from "node:crypto";
import type {
  PaymentInitResult,
  PaymentIntent,
  PaymentProvider,
  PaymentResult,
  NormalizedWebhookEvent,
  WebhookHeaders,
} from "../types";

const SETTLE_SECONDS = () => parseInt(process.env.MOCK_SETTLE_SECONDS ?? "5", 10);
const WEBHOOK_SECRET = () => process.env.MOCK_WEBHOOK_SECRET ?? "mock-webhook-dev-secret";

/** ref → creation time (module-local; good enough for a sandbox). */
const initializedAt = new Map<string, number>();
/** ref → intent snapshot so verify can echo amount/currency. */
const intents = new Map<string, { amountMinor: number; currency: string }>();

function fakeUssd(ref: string): string {
  // *737*-style display code, digits derived deterministically from the ref.
  const digits = crypto.createHash("sha1").update(ref).digest("hex").replace(/\D/g, "").slice(0, 8).padEnd(8, "0");
  return `*737*000*${digits}#`;
}

export const mockProvider: PaymentProvider = {
  name: "mock",
  displayName: "Mock (Sandbox)",
  currencies: ["NGN", "USD", "GHS", "KES", "ZAR", "XOF", "EUR", "GBP"],
  channels: ["card", "bank_transfer", "ussd", "qr", "mobile_money", "bank_debit"],
  capabilities: { refunds: true, payouts: false, recurring: false, webhooks: true },

  // Always "configured" — the registry decides when mock is resolvable.
  isConfigured: () => true,

  async initializePayment(intent: PaymentIntent): Promise<PaymentInitResult> {
    const ref = intent.idempotencyKey.startsWith("mock-")
      ? intent.idempotencyKey
      : `mock-${intent.idempotencyKey}`;
    initializedAt.set(ref, Date.now());
    intents.set(ref, { amountMinor: intent.amountMinor, currency: intent.currency });
    // Bound memory: keep only the last 1k sandbox payments.
    if (initializedAt.size > 1000) {
      const oldest = initializedAt.keys().next().value;
      if (oldest) { initializedAt.delete(oldest); intents.delete(oldest); }
    }

    return {
      providerRef: ref,
      authorizationUrl: intent.callbackUrl
        ? `${intent.callbackUrl}?reference=${encodeURIComponent(ref)}&provider=mock&simulated=1`
        : `https://sandbox.payments.nexcom.local/pay/${encodeURIComponent(ref)}`,
      ussdCode: fakeUssd(ref),
      qrData: `nexcom://pay?ref=${encodeURIComponent(ref)}&amount=${intent.amountMinor}&currency=${intent.currency}`,
      transferAccount: {
        bankName: "Sandbox Bank NG",
        accountNumber: fakeUssd(ref).replace(/\D/g, "").slice(-10).padStart(10, "0"),
        accountName: "NEXCOM Exchange Sandbox",
      },
      expiresAt: new Date(Date.now() + 30 * 60_000), // 30 min
      raw: { simulated: true },
    };
  },

  async verifyPayment(providerRef: string): Promise<PaymentResult> {
    const started = initializedAt.get(providerRef);
    const snapshot = intents.get(providerRef);
    const lower = providerRef.toLowerCase();

    if (lower.includes("fail")) {
      return {
        providerRef,
        status: "failed",
        amountMinor: snapshot?.amountMinor ?? 0,
        currency: snapshot?.currency ?? "NGN",
        failureReason: "simulated failure (ref contains 'fail')",
      };
    }
    if (lower.includes("stuck")) {
      return {
        providerRef,
        status: "processing",
        amountMinor: snapshot?.amountMinor ?? 0,
        currency: snapshot?.currency ?? "NGN",
      };
    }
    const settled = started != null && Date.now() - started >= SETTLE_SECONDS() * 1000;
    return {
      providerRef,
      status: settled ? "success" : "processing",
      amountMinor: snapshot?.amountMinor ?? 0,
      currency: snapshot?.currency ?? "NGN",
      channel: "card",
      paidAt: settled ? new Date() : undefined,
      instrument: "sandbox ****0000",
      raw: { simulated: true },
    };
  },

  async refund(payment: PaymentResult, amountMinor?: number): Promise<PaymentResult> {
    return {
      ...payment,
      status: "refunded",
      amountMinor: amountMinor ?? payment.amountMinor,
    };
  },

  verifyWebhookSignature(headersIn: WebhookHeaders, rawBody: Buffer): boolean {
    const h = headersIn["x-mock-signature"];
    const signature = Array.isArray(h) ? h[0] : h;
    if (!signature) return false;
    const expected = crypto.createHmac("sha256", WEBHOOK_SECRET()).update(rawBody).digest("hex");
    const a = Buffer.from(expected, "utf8");
    const b = Buffer.from(signature, "utf8");
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  },

  parseWebhook(_headers: WebhookHeaders, rawBody: Buffer): NormalizedWebhookEvent {
    const event = JSON.parse(rawBody.toString("utf8")) as {
      eventId?: string;
      type?: string;
      reference?: string;
      status?: string;
      amountMinor?: number;
      currency?: string;
    };
    const statusMap: Record<string, NormalizedWebhookEvent["status"]> = {
      success: "success",
      failed: "failed",
      abandoned: "abandoned",
      processing: "processing",
    };
    return {
      eventId: event.eventId ?? `mock:event:${event.reference ?? "unknown"}:${crypto.randomUUID()}`,
      type: event.type ?? "mock.payment",
      providerRef: event.reference ?? null,
      status: event.status ? statusMap[event.status] : undefined,
      amountMinor: event.amountMinor,
      currency: event.currency?.toUpperCase(),
      paidAt: event.status === "success" ? new Date() : undefined,
    };
  },
};
