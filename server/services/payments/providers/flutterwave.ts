/**
 * Flutterwave v3 collection rail (PAY-RAILS).
 *
 * API: https://api.flutterwave.com/v3
 *  - Initialize: POST /payments  (standard hosted checkout; redirect the user
 *    to data.link). Channels are requested via `payment_options`.
 *  - Verify:     GET  /transactions/{id}/verify  — Flutterwave's verify is by
 *    numeric transaction ID; our providerRef stores the ID (we keep tx_ref as
 *    the idempotency key in metadata).
 *  - Refund:     POST /transactions/{id}/refund
 *  - Webhook:    the dashboard-configured secret hash is sent verbatim in the
 *    `verif-hash` header — compare with timing-safe equality against
 *    FLUTTERWAVE_WEBHOOK_HASH. (v3 does NOT HMAC-sign the body.)
 *
 * Env:
 *   FLUTTERWAVE_SECRET_KEY     (required — FLWSECK_TEST-... / FLWSECK-...)
 *   FLUTTERWAVE_PUBLIC_KEY     (optional — inline checkout)
 *   FLUTTERWAVE_WEBHOOK_HASH   (required for webhooks — dashboard "secret hash")
 *
 * Amounts: Flutterwave v3 accepts MAJOR units (naira) — we convert kobo → naira
 * on initialize and naira → kobo on verify. This is the ONE rail that is not
 * minor-units on the wire; conversion is centralised in toMajor/fromMajor.
 * Docs: https://developer.flutterwave.com/reference
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

const BASE_URL = "https://api.flutterwave.com/v3";

const SECRET_KEY = () => process.env.FLUTTERWAVE_SECRET_KEY ?? "";
const WEBHOOK_HASH = () => process.env.FLUTTERWAVE_WEBHOOK_HASH ?? "";

function headers() {
  return { Authorization: `Bearer ${SECRET_KEY()}` };
}

/** kobo → naira string (Flutterwave v3 wire format is major units). */
function toMajor(amountMinor: number): number {
  return amountMinor / 100;
}
/** naira → kobo, rounding to the nearest minor unit. */
function fromMajor(amountMajor: number): number {
  return Math.round(amountMajor * 100);
}

function toPaymentOptions(channel?: PaymentChannel): string | undefined {
  switch (channel) {
    case "card": return "card";
    case "bank_transfer": return "banktransfer";
    case "ussd": return "ussd";
    case "qr": return "nqr";
    case "mobile_money": return "mobilemoney";
    case "bank_debit": return "account";
    default: return undefined;
  }
}

function mapStatus(s: string | undefined): PaymentStatus {
  switch (s) {
    case "successful": return "success";
    case "failed": return "failed";
    case "cancelled": return "abandoned";
    case "pending": return "processing";
    default: return "pending";
  }
}

function timingSafeEqualStr(a: string, b: string): boolean {
  const ba = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

interface FlwTransaction {
  id: number;
  tx_ref: string;
  status: string;
  amount: number;
  currency: string;
  payment_type?: string;
  created_at?: string;
  charged_amount?: number;
  app_fee?: number;
  card?: { type?: string; last_4digits?: string };
  narration?: string;
}

export const flutterwaveProvider: PaymentProvider = {
  name: "flutterwave",
  displayName: "Flutterwave",
  currencies: ["NGN", "USD", "GHS", "KES", "ZAR", "XOF"],
  channels: ["card", "bank_transfer", "ussd", "qr", "mobile_money", "bank_debit"],
  capabilities: { refunds: true, payouts: true, recurring: true, webhooks: true },

  isConfigured: () => SECRET_KEY().length > 0,

  async initializePayment(intent: PaymentIntent): Promise<PaymentInitResult> {
    const paymentOptions = toPaymentOptions(intent.channel);
    try {
      const res = await providerRequest<{
        status: string;
        message?: string;
        data: { link: string };
      }>({
        method: "POST",
        url: `${BASE_URL}/payments`,
        headers: headers(),
        data: {
          tx_ref: intent.idempotencyKey, // our idempotency key IS the Flutterwave tx_ref
          amount: toMajor(intent.amountMinor), // major units on the wire
          currency: intent.currency,
          redirect_url: intent.callbackUrl,
          ...(paymentOptions ? { payment_options: paymentOptions } : {}),
          customer: {
            email: intent.customer.email ?? `user-${intent.customer.userId}@nexcom.exchange`,
            name: intent.customer.name ?? undefined,
            phonenumber: intent.customer.phone ?? undefined,
          },
          customizations: {
            title: "NEXCOM Exchange",
            description: `${intent.purpose} — ${intent.currency} ${toMajor(intent.amountMinor).toLocaleString()}`,
          },
          meta: {
            userId: intent.customer.userId,
            purpose: intent.purpose,
            amountMinor: intent.amountMinor, // exact minor units preserved for verify
            ...(intent.metadata ?? {}),
          },
        },
      });
      return {
        // We verify by tx_ref via /transactions/verify?tx_ref=... below, so the
        // providerRef stays our idempotency key (stable across redirects).
        providerRef: intent.idempotencyKey,
        authorizationUrl: res.data.data.link,
      };
    } catch (err) {
      throw new Error(`Flutterwave initialize failed: ${providerErrorMessage(err)}`);
    }
  },

  async verifyPayment(providerRef: string): Promise<PaymentResult> {
    try {
      // Verify by tx_ref (our providerRef). /transactions/verify?tx_ref= returns
      // the matching transaction without needing the numeric Flutterwave ID.
      const res = await providerRequest<{
        status: string;
        data: FlwTransaction[];
      }>({
        method: "GET",
        url: `${BASE_URL}/transactions/verify_by_reference`,
        params: { tx_ref: providerRef },
        headers: headers(),
      });
      const d = res.data.data?.[0];
      if (!d) {
        return {
          providerRef,
          status: "pending",
          amountMinor: 0,
          currency: "NGN",
          failureReason: "transaction not found",
        };
      }
      const status = mapStatus(d.status);
      return {
        providerRef,
        status,
        amountMinor: fromMajor(d.charged_amount ?? d.amount),
        currency: (d.currency ?? "NGN").toUpperCase(),
        channel: d.payment_type === "banktransfer" ? "bank_transfer" : (d.payment_type as PaymentChannel | undefined),
        paidAt: status === "success" && d.created_at ? new Date(d.created_at) : undefined,
        feeMinor: d.app_fee ? fromMajor(d.app_fee) : undefined,
        instrument: d.card?.type && d.card?.last_4digits ? `${d.card.type} ****${d.card.last_4digits}` : undefined,
        failureReason: status === "failed" ? d.narration : undefined,
        raw: { flwId: d.id, status: d.status },
      };
    } catch (err) {
      throw new Error(`Flutterwave verify failed: ${providerErrorMessage(err)}`);
    }
  },

  async refund(payment: PaymentResult, amountMinor?: number): Promise<PaymentResult> {
    const flwId = (payment.raw as { flwId?: number } | undefined)?.flwId;
    if (!flwId) throw new Error("Flutterwave refund failed: missing numeric transaction id");
    try {
      await providerRequest({
        method: "POST",
        url: `${BASE_URL}/transactions/${flwId}/refund`,
        headers: headers(),
        data: amountMinor ? { amount: toMajor(amountMinor) } : {},
      });
      return { ...payment, status: "refunded" };
    } catch (err) {
      throw new Error(`Flutterwave refund failed: ${providerErrorMessage(err)}`);
    }
  },

  verifyWebhookSignature(headersIn: WebhookHeaders, _rawBody: Buffer): boolean {
    const h = headersIn["verif-hash"];
    const hash = Array.isArray(h) ? h[0] : h;
    const expected = WEBHOOK_HASH();
    if (!hash || !expected) return false;
    return timingSafeEqualStr(hash, expected);
  },

  parseWebhook(_headers: WebhookHeaders, rawBody: Buffer): NormalizedWebhookEvent {
    const event = JSON.parse(rawBody.toString("utf8")) as {
      event: string;
      data?: FlwTransaction & { id?: number };
    };
    const d = (event.data ?? {}) as FlwTransaction;
    return {
      eventId: `flutterwave:${event.event}:${d.id ?? d.tx_ref ?? "unknown"}`,
      type: event.event,
      providerRef: d.tx_ref ?? null,
      status: d.status ? mapStatus(d.status) : undefined,
      amountMinor: typeof d.charged_amount === "number" ? fromMajor(d.charged_amount) : undefined,
      currency: d.currency?.toUpperCase(),
      paidAt: d.created_at ? new Date(d.created_at) : undefined,
      failureReason: d.status === "failed" ? d.narration : undefined,
    };
  },
};
