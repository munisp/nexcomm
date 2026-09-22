/**
 * Paystack collection rail (PAY-RAILS).
 *
 * API: https://api.paystack.co
 *  - Initialize: POST /transaction/initialize
 *      channels: card | bank_transfer | ussd | qr  (Paystack "channels" array)
 *  - Verify:     GET  /transaction/verify/{reference}
 *  - Refund:     POST /refund  { transaction: <ref>, amount?: <kobo> }
 *  - Webhook:    HMAC-SHA512 of the RAW request body, hex digest, sent in the
 *                `x-paystack-signature` header. IMPORTANT: Paystack signs with
 *                the merchant SECRET KEY (PAYSTACK_SECRET_KEY) — there is no
 *                separate webhook secret; PAYSTACK_WEBHOOK_SECRET, when set,
 *                overrides the signing key (dashboard-configured setups only).
 *
 * Env:
 *   PAYSTACK_SECRET_KEY      (required — sk_test_... / sk_live_...)
 *   PAYSTACK_PUBLIC_KEY      (optional — for inline/checkout.js UX)
 *   PAYSTACK_WEBHOOK_SECRET  (optional override for the HMAC key)
 *
 * Amounts: Paystack expects kobo for NGN (minor units) — matches our convention.
 * Docs: https://paystack.com/docs/api
 */
import crypto from "node:crypto";
import { providerRequest, providerErrorMessage } from "../http";
import type {
  PaymentChannel,
  PaymentInitResult,
  PaymentIntent,
  PaymentProvider,
  PaymentResult,
  PaymentStatus,
  NormalizedWebhookEvent,
  WebhookHeaders,
} from "../types";

const BASE_URL = "https://api.paystack.co";

const SECRET_KEY = () => process.env.PAYSTACK_SECRET_KEY ?? "";
const HMAC_KEY = () => process.env.PAYSTACK_WEBHOOK_SECRET ?? process.env.PAYSTACK_SECRET_KEY ?? "";

function headers() {
  return { Authorization: `Bearer ${SECRET_KEY()}` };
}

/** Map our channel → Paystack channels array (omit for provider default). */
function toPaystackChannels(channel?: PaymentChannel): string[] | undefined {
  switch (channel) {
    case "card": return ["card"];
    case "bank_transfer": return ["bank_transfer"];
    case "ussd": return ["ussd"];
    case "qr": return ["qr"];
    case "mobile_money": return ["mobile_money"];
    default: return undefined;
  }
}

function mapStatus(s: string | undefined): PaymentStatus {
  switch (s) {
    case "success": return "success";
    case "failed": return "failed";
    case "abandoned": return "abandoned";
    case "pending":
    case "ongoing": return "processing";
    case "reversed":
    case "refunded": return "refunded";
    default: return "pending";
  }
}

function maskChannel(raw: Record<string, unknown>): string | undefined {
  const auth = raw.authorization as { channel?: string; card_type?: string; last4?: string } | undefined;
  if (auth?.card_type && auth?.last4) return `${auth.card_type} ****${auth.last4}`;
  return auth?.channel;
}

function timingSafeEqualHex(a: string, b: string): boolean {
  const ba = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

export const paystackProvider: PaymentProvider = {
  name: "paystack",
  displayName: "Paystack",
  currencies: ["NGN", "USD", "GHS", "KES", "ZAR"],
  channels: ["card", "bank_transfer", "ussd", "qr", "mobile_money"],
  capabilities: { refunds: true, payouts: true, recurring: true, webhooks: true },

  isConfigured: () => SECRET_KEY().length > 0,

  async initializePayment(intent: PaymentIntent): Promise<PaymentInitResult> {
    const channels = toPaystackChannels(intent.channel);
    try {
      const res = await providerRequest<{
        status: boolean;
        message?: string;
        data: { reference: string; authorization_url: string; access_code: string };
      }>({
        method: "POST",
        url: `${BASE_URL}/transaction/initialize`,
        headers: headers(),
        data: {
          email: intent.customer.email ?? `user-${intent.customer.userId}@nexcom.exchange`,
          amount: intent.amountMinor, // kobo — minor units
          currency: intent.currency,
          reference: intent.idempotencyKey, // our idempotency key IS the Paystack reference
          callback_url: intent.callbackUrl,
          ...(channels ? { channels } : {}),
          metadata: {
            userId: intent.customer.userId,
            purpose: intent.purpose,
            idempotencyKey: intent.idempotencyKey,
            ...(intent.metadata ?? {}),
          },
        },
      });
      const d = res.data.data;
      return {
        providerRef: d.reference,
        authorizationUrl: d.authorization_url,
        raw: { accessCode: d.access_code },
      };
    } catch (err) {
      throw new Error(`Paystack initialize failed: ${providerErrorMessage(err)}`);
    }
  },

  async verifyPayment(providerRef: string): Promise<PaymentResult> {
    try {
      const res = await providerRequest<{
        status: boolean;
        data: {
          reference: string;
          status: string;
          amount: number;
          currency: string;
          channel?: string;
          paid_at?: string;
          fees?: number;
          gateway_response?: string;
          authorization?: Record<string, unknown>;
        };
      }>({
        method: "GET",
        url: `${BASE_URL}/transaction/verify/${encodeURIComponent(providerRef)}`,
        headers: headers(),
      });
      const d = res.data.data;
      const status = mapStatus(d.status);
      return {
        providerRef: d.reference,
        status,
        amountMinor: d.amount,
        currency: (d.currency ?? "NGN").toUpperCase(),
        channel: (d.channel as PaymentChannel | undefined) ?? undefined,
        paidAt: d.paid_at ? new Date(d.paid_at) : undefined,
        feeMinor: d.fees,
        instrument: maskChannel(d as unknown as Record<string, unknown>),
        failureReason: status === "failed" || status === "abandoned" ? d.gateway_response : undefined,
        raw: { status: d.status, channel: d.channel },
      };
    } catch (err) {
      throw new Error(`Paystack verify failed: ${providerErrorMessage(err)}`);
    }
  },

  async refund(payment: PaymentResult, amountMinor?: number): Promise<PaymentResult> {
    try {
      await providerRequest({
        method: "POST",
        url: `${BASE_URL}/refund`,
        headers: headers(),
        data: {
          transaction: payment.providerRef,
          ...(amountMinor ? { amount: amountMinor } : {}),
        },
      });
      return { ...payment, status: "refunded" };
    } catch (err) {
      throw new Error(`Paystack refund failed: ${providerErrorMessage(err)}`);
    }
  },

  verifyWebhookSignature(headersIn: WebhookHeaders, rawBody: Buffer): boolean {
    const sig = headersIn["x-paystack-signature"];
    const signature = Array.isArray(sig) ? sig[0] : sig;
    if (!signature || !HMAC_KEY()) return false;
    const expected = crypto.createHmac("sha512", HMAC_KEY()).update(rawBody).digest("hex");
    return timingSafeEqualHex(expected, signature);
  },

  parseWebhook(_headers: WebhookHeaders, rawBody: Buffer): NormalizedWebhookEvent {
    const event = JSON.parse(rawBody.toString("utf8")) as {
      event: string;
      data?: {
        id?: number;
        reference?: string;
        status?: string;
        amount?: number;
        currency?: string;
        paid_at?: string;
        gateway_response?: string;
      };
    };
    const d = event.data ?? {};
    return {
      // Paystack sends no event id; use the numeric transaction id as the dedupe anchor.
      eventId: `paystack:${event.event}:${d.id ?? d.reference ?? "unknown"}`,
      type: event.event,
      providerRef: d.reference ?? null,
      status: d.status ? mapStatus(d.status) : undefined,
      amountMinor: d.amount,
      currency: d.currency?.toUpperCase(),
      paidAt: d.paid_at ? new Date(d.paid_at) : undefined,
      failureReason: event.event.includes("failed") ? d.gateway_response : undefined,
    };
  },
};
