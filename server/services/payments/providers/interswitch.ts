/**
 * Interswitch collection rail (PAY-RAILS) — Interswitch Payment Gateway (IPG),
 * with reach onto NIBSS Instant Payments (NIP) rails via bank transfer.
 *
 * CHOSEN ENDPOINTS (documented against IPG "Collections" API v1):
 *  - Auth:       POST {PASSPORT_URL}/passport/oauth/token
 *                OAuth2 client_credentials, HTTP Basic base64(clientId:secret),
 *                scope=profile. Tokens cached in server/cache.ts (expiresIn−60s).
 *                Production passport: https://passport.interswitchng.com
 *                QA passport:         https://passport.qa.interswitchng.com
 *  - Initialize: POST {BASE_URL}/collections/api/v1/paymentgateway/transaction/initialize
 *                Hosted-checkout style: returns a paymentUrl to redirect to.
 *                (Direct card purchases would use POST /api/v3/purchases with
 *                encrypted card data — deliberately NOT used: keeping PANs off
 *                our servers preserves our PCI-DSS SAQ-A posture. The hosted
 *                page still offers CARD / BANK TRANSFER (NIP) / USSD / QR.)
 *  - Verify:     GET  {BASE_URL}/collections/api/v1/paymentgateway/transaction/verify
 *                ?merchantCode={INTERSWITCH_MERCHANT_CODE}&reference={ref}
 *  - Webhook:    HMAC-SHA512 of the RAW body with INTERSWITCH_CLIENT_SECRET,
 *                hex digest in the `x-interswitch-signature` header.
 *
 * Env:
 *   INTERSWITCH_CLIENT_ID      (required)
 *   INTERSWITCH_CLIENT_SECRET  (required — also the webhook HMAC key)
 *   INTERSWITCH_MERCHANT_CODE  (required, e.g. "MX12345")
 *   INTERSWITCH_BASE_URL       (default https://api-d.interswitchng.com; QA https://qa.interswitchng.com)
 *   INTERSWITCH_PASSPORT_URL   (default https://passport.interswitchng.com)
 *
 * Amounts: IPG expects MINOR units (kobo) — matches our convention, no conversion.
 * Docs: https://docs.interswitchgroup.com
 */
import crypto from "node:crypto";
import { cacheGet, cacheSet } from "../../../cache";
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

const BASE_URL = () => (process.env.INTERSWITCH_BASE_URL ?? "https://api-d.interswitchng.com").replace(/\/$/, "");
const PASSPORT_URL = () => (process.env.INTERSWITCH_PASSPORT_URL ?? "https://passport.interswitchng.com").replace(/\/$/, "");
const CLIENT_ID = () => process.env.INTERSWITCH_CLIENT_ID ?? "";
const CLIENT_SECRET = () => process.env.INTERSWITCH_CLIENT_SECRET ?? "";
const MERCHANT_CODE = () => process.env.INTERSWITCH_MERCHANT_CODE ?? "";

const TOKEN_CACHE_KEY = "payments:interswitch:access_token";

/** Get a cached passport token, or authenticate and cache it. */
async function getAccessToken(): Promise<string> {
  const cached = await cacheGet<{ token: string }>(TOKEN_CACHE_KEY);
  if (cached?.token) return cached.token;

  const basic = Buffer.from(`${CLIENT_ID()}:${CLIENT_SECRET()}`).toString("base64");
  const res = await providerRequest<{ access_token: string; expires_in: number | string }>({
    method: "POST",
    url: `${PASSPORT_URL()}/passport/oauth/token`,
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    data: "grant_type=client_credentials&scope=profile",
  });
  const token = res.data.access_token;
  const expiresIn = Number(res.data.expires_in) || 3600;
  await cacheSet(TOKEN_CACHE_KEY, { token }, Math.max(60, expiresIn - 60));
  return token;
}

async function authHeaders() {
  const token = await getAccessToken();
  return { Authorization: `Bearer ${token}` };
}

function mapStatus(s: string | undefined): PaymentStatus {
  switch ((s ?? "").toUpperCase()) {
    case "SUCCESS":
    case "SUCCESSFUL":
    case "00": return "success";
    case "FAILED":
    case "DECLINED": return "failed";
    case "ABANDONED":
    case "EXPIRED": return "abandoned";
    case "PENDING":
    case "PROCESSING": return "processing";
    default: return "pending";
  }
}

function timingSafeEqualHex(a: string, b: string): boolean {
  const ba = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

export const interswitchProvider: PaymentProvider = {
  name: "interswitch",
  displayName: "Interswitch (NIBSS)",
  currencies: ["NGN"],
  // NIP reach comes through bank_transfer on the hosted page; card via Verve/MC/Visa.
  channels: ["card", "bank_transfer", "ussd", "qr"],
  capabilities: { refunds: true, payouts: false, recurring: false, webhooks: true },

  isConfigured: () => CLIENT_ID().length > 0 && CLIENT_SECRET().length > 0 && MERCHANT_CODE().length > 0,

  async initializePayment(intent: PaymentIntent): Promise<PaymentInitResult> {
    try {
      const res = await providerRequest<{
        transactionRef?: string;
        paymentUrl?: string;
        responseCode?: string;
        responseDescription?: string;
      }>({
        method: "POST",
        url: `${BASE_URL()}/collections/api/v1/paymentgateway/transaction/initialize`,
        headers: await authHeaders(),
        data: {
          merchantCode: MERCHANT_CODE(),
          // our idempotency key IS the Interswitch transaction reference
          reference: intent.idempotencyKey,
          amount: intent.amountMinor, // kobo — minor units
          currency: intent.currency === "NGN" ? "566" : intent.currency, // ISO numeric for NGN
          redirectUrl: intent.callbackUrl,
          customer: {
            email: intent.customer.email ?? undefined,
            name: intent.customer.name ?? undefined,
          },
          meta: {
            userId: intent.customer.userId,
            purpose: intent.purpose,
            requestedChannel: intent.channel ?? "any",
            ...(intent.metadata ?? {}),
          },
        },
      });
      const d = res.data;
      return {
        providerRef: d.transactionRef ?? intent.idempotencyKey,
        authorizationUrl: d.paymentUrl,
        raw: { responseCode: d.responseCode },
      };
    } catch (err) {
      throw new Error(`Interswitch initialize failed: ${providerErrorMessage(err)}`);
    }
  },

  async verifyPayment(providerRef: string): Promise<PaymentResult> {
    try {
      const res = await providerRequest<{
        reference?: string;
        status?: string;
        responseCode?: string;
        amount?: number;
        currency?: string;
        channel?: string;
        transactionDate?: string;
        responseDescription?: string;
      }>({
        method: "GET",
        url: `${BASE_URL()}/collections/api/v1/paymentgateway/transaction/verify`,
        params: { merchantCode: MERCHANT_CODE(), reference: providerRef },
        headers: await authHeaders(),
      });
      const d = res.data;
      const status = mapStatus(d.status ?? d.responseCode);
      return {
        providerRef: d.reference ?? providerRef,
        status,
        amountMinor: d.amount ?? 0, // already kobo
        currency: d.currency === "566" ? "NGN" : (d.currency ?? "NGN").toUpperCase(),
        channel: (d.channel?.toLowerCase() as PaymentChannel | undefined) ?? undefined,
        paidAt: d.transactionDate ? new Date(d.transactionDate) : undefined,
        failureReason: status === "failed" ? d.responseDescription : undefined,
        raw: { responseCode: d.responseCode },
      };
    } catch (err) {
      throw new Error(`Interswitch verify failed: ${providerErrorMessage(err)}`);
    }
  },

  async refund(payment: PaymentResult, _amountMinor?: number): Promise<PaymentResult> {
    void _amountMinor;
    // IPG refunds/reversals are merchant-portal or direct-integration operations;
    // not exposed on the hosted collections API.
    throw new Error(`Interswitch refund for ${payment.providerRef}: use the Interswitch merchant portal`);
  },

  verifyWebhookSignature(headersIn: WebhookHeaders, rawBody: Buffer): boolean {
    const h = headersIn["x-interswitch-signature"];
    const signature = Array.isArray(h) ? h[0] : h;
    if (!signature || !CLIENT_SECRET()) return false;
    const expected = crypto.createHmac("sha512", CLIENT_SECRET()).update(rawBody).digest("hex");
    return timingSafeEqualHex(expected, signature);
  },

  parseWebhook(_headers: WebhookHeaders, rawBody: Buffer): NormalizedWebhookEvent {
    const event = JSON.parse(rawBody.toString("utf8")) as {
      event?: string;
      eventType?: string;
      data?: {
        reference?: string;
        transactionRef?: string;
        status?: string;
        responseCode?: string;
        amount?: number;
        currency?: string;
        transactionDate?: string;
        responseDescription?: string;
      };
    };
    const d = event.data ?? {};
    const type = event.eventType ?? event.event ?? "UNKNOWN";
    const ref = d.reference ?? d.transactionRef ?? null;
    return {
      eventId: `interswitch:${type}:${ref ?? "unknown"}`,
      type,
      providerRef: ref,
      status: d.status || d.responseCode ? mapStatus(d.status ?? d.responseCode) : undefined,
      amountMinor: d.amount,
      currency: d.currency === "566" ? "NGN" : d.currency?.toUpperCase(),
      paidAt: d.transactionDate ? new Date(d.transactionDate) : undefined,
      failureReason: d.responseCode && d.responseCode !== "00" ? d.responseDescription : undefined,
    };
  },
};
