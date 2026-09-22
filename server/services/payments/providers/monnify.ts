/**
 * Monnify collection rail (PAY-RAILS).
 *
 * API: MONNIFY_BASE_URL (default https://api.monnify.com; sandbox https://sandbox.monnify.com)
 *  - Auth:       POST /api/v1/auth/login  — HTTP Basic base64(apiKey:secretKey),
 *                returns an OAuth2 access token. Tokens are cached in
 *                server/cache.ts (Redis) with a TTL of (expiresIn - 60s) so
 *                concurrent collections share one token.
 *  - Initialize: POST /api/v1/merchant/transactions/init-transaction
 *      paymentMethods: CARD | ACCOUNT_TRANSFER | USSD  → hosted checkout URL.
 *  - Bank transfer (reserved accounts): Monnify can mint a DEDICATED virtual
 *    account per user (POST /api/v2/bank-transfer/reserved-accounts) so inbound
 *    NIP transfers auto-reconcile. This is OPTIONAL and not required for the
 *    standard init-transaction flow (which returns a one-off checkout URL);
 *    enable it for power users via the Monnify dashboard + reserved-account API.
 *  - Verify:     GET  /api/v2/transactions/{paymentReference}
 *  - Webhook:    HMAC-SHA512 of the RAW body with MONNIFY_SECRET_KEY, hex digest
 *                in the `monnify-signature` header.
 *
 * Env:
 *   MONNIFY_API_KEY        (required)
 *   MONNIFY_SECRET_KEY     (required — also the webhook HMAC key)
 *   MONNIFY_CONTRACT_CODE  (required)
 *   MONNIFY_BASE_URL       (default https://api.monnify.com)
 *
 * Amounts: Monnify expects MAJOR units (naira) on init; verify returns major.
 * Conversion is centralised in toMajor/fromMajor.
 * Docs: https://docs.monnify.com
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

const BASE_URL = () => (process.env.MONNIFY_BASE_URL ?? "https://api.monnify.com").replace(/\/$/, "");
const API_KEY = () => process.env.MONNIFY_API_KEY ?? "";
const SECRET_KEY = () => process.env.MONNIFY_SECRET_KEY ?? "";
const CONTRACT_CODE = () => process.env.MONNIFY_CONTRACT_CODE ?? "";

const TOKEN_CACHE_KEY = "payments:monnify:access_token";

/** kobo → naira (Monnify wire format is major units). */
function toMajor(amountMinor: number): number {
  return amountMinor / 100;
}
function fromMajor(amountMajor: number): number {
  return Math.round(amountMajor * 100);
}

/** Get a cached OAuth2 token, or login and cache it (TTL = expiresIn − 60s). */
async function getAccessToken(): Promise<string> {
  const cached = await cacheGet<{ token: string }>(TOKEN_CACHE_KEY);
  if (cached?.token) return cached.token;

  const basic = Buffer.from(`${API_KEY()}:${SECRET_KEY()}`).toString("base64");
  const res = await providerRequest<{
    requestSuccessful: boolean;
    responseBody: { accessToken: string; expiresIn: number };
  }>({
    method: "POST",
    url: `${BASE_URL()}/api/v1/auth/login`,
    headers: { Authorization: `Basic ${basic}` },
  });
  const { accessToken, expiresIn } = res.data.responseBody;
  // Cache for (expiresIn − 60s) so we never hand out a nearly-expired token.
  // cacheSet is a no-op when Redis is down; we still have the token for this call.
  await cacheSet(TOKEN_CACHE_KEY, { token: accessToken }, Math.max(60, expiresIn - 60));
  return accessToken;
}

function toPaymentMethods(channel?: PaymentChannel): string[] | undefined {
  switch (channel) {
    case "card": return ["CARD"];
    case "bank_transfer": return ["ACCOUNT_TRANSFER"];
    case "ussd": return ["USSD"];
    default: return undefined;
  }
}

function mapStatus(s: string | undefined): PaymentStatus {
  switch (s) {
    case "PAID": return "success";
    case "FAILED":
    case "REVERSED": return "failed";
    case "EXPIRED": return "abandoned";
    case "PENDING": return "processing";
    default: return "pending";
  }
}

function mapChannel(m: string | undefined): PaymentChannel | undefined {
  switch (m) {
    case "CARD": return "card";
    case "ACCOUNT_TRANSFER": return "bank_transfer";
    case "USSD": return "ussd";
    default: return undefined;
  }
}

function timingSafeEqualHex(a: string, b: string): boolean {
  const ba = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

interface MonnifyTransaction {
  transactionReference?: string;
  paymentReference?: string;
  paymentStatus?: string;
  amountPaid?: number | string;
  totalPayable?: number | string;
  currencyCode?: string;
  paymentMethod?: string;
  paidOn?: string;
  checkoutUrl?: string;
}

export const monnifyProvider: PaymentProvider = {
  name: "monnify",
  displayName: "Monnify",
  currencies: ["NGN"],
  channels: ["card", "bank_transfer", "ussd"],
  capabilities: { refunds: true, payouts: true, recurring: false, webhooks: true },

  isConfigured: () => API_KEY().length > 0 && SECRET_KEY().length > 0 && CONTRACT_CODE().length > 0,

  async initializePayment(intent: PaymentIntent): Promise<PaymentInitResult> {
    const paymentMethods = toPaymentMethods(intent.channel);
    try {
      const token = await getAccessToken();
      const res = await providerRequest<{
        requestSuccessful: boolean;
        responseMessage?: string;
        responseBody: MonnifyTransaction;
      }>({
        method: "POST",
        url: `${BASE_URL()}/api/v1/merchant/transactions/init-transaction`,
        headers: { Authorization: `Bearer ${token}` },
        data: {
          amount: toMajor(intent.amountMinor), // major units on the wire
          customerName: intent.customer.name ?? `NEXCOM User ${intent.customer.userId}`,
          customerEmail: intent.customer.email ?? `user-${intent.customer.userId}@nexcom.exchange`,
          paymentReference: intent.idempotencyKey, // unique per transaction — Monnify enforces
          paymentDescription: `NEXCOM ${intent.purpose}`,
          currencyCode: intent.currency,
          contractCode: CONTRACT_CODE(),
          redirectUrl: intent.callbackUrl,
          ...(paymentMethods ? { paymentMethods } : {}),
          metaData: {
            userId: String(intent.customer.userId),
            purpose: intent.purpose,
            amountMinor: String(intent.amountMinor),
            ...(intent.metadata ?? {}),
          },
        },
      });
      const d = res.data.responseBody;
      return {
        providerRef: d.paymentReference ?? intent.idempotencyKey,
        authorizationUrl: d.checkoutUrl,
        raw: { transactionReference: d.transactionReference },
      };
    } catch (err) {
      throw new Error(`Monnify initialize failed: ${providerErrorMessage(err)}`);
    }
  },

  async verifyPayment(providerRef: string): Promise<PaymentResult> {
    try {
      const token = await getAccessToken();
      const res = await providerRequest<{
        requestSuccessful: boolean;
        responseBody: MonnifyTransaction;
      }>({
        method: "GET",
        // v2 verify accepts the URL-encoded paymentReference in the path
        url: `${BASE_URL()}/api/v2/transactions/${encodeURIComponent(providerRef)}`,
        headers: { Authorization: `Bearer ${token}` },
      });
      const d = res.data.responseBody;
      const status = mapStatus(d.paymentStatus);
      return {
        providerRef: d.paymentReference ?? providerRef,
        status,
        amountMinor: fromMajor(Number(d.amountPaid ?? d.totalPayable ?? 0)),
        currency: (d.currencyCode ?? "NGN").toUpperCase(),
        channel: mapChannel(d.paymentMethod),
        paidAt: d.paidOn ? new Date(d.paidOn) : undefined,
        failureReason: status === "failed" ? d.paymentStatus : undefined,
        raw: { transactionReference: d.transactionReference, paymentStatus: d.paymentStatus },
      };
    } catch (err) {
      throw new Error(`Monnify verify failed: ${providerErrorMessage(err)}`);
    }
  },

  async refund(payment: PaymentResult, _amountMinor?: number): Promise<PaymentResult> {
    // Monnify refunds are initiated from the merchant dashboard / disbursement
    // API in most deployments; surface as unsupported via the rail API.
    void _amountMinor;
    throw new Error(`Monnify refund for ${payment.providerRef}: use the merchant dashboard (API refund not enabled)`);
  },

  verifyWebhookSignature(headersIn: WebhookHeaders, rawBody: Buffer): boolean {
    const h = headersIn["monnify-signature"];
    const signature = Array.isArray(h) ? h[0] : h;
    if (!signature || !SECRET_KEY()) return false;
    const expected = crypto.createHmac("sha512", SECRET_KEY()).update(rawBody).digest("hex");
    return timingSafeEqualHex(expected, signature);
  },

  parseWebhook(_headers: WebhookHeaders, rawBody: Buffer): NormalizedWebhookEvent {
    const event = JSON.parse(rawBody.toString("utf8")) as {
      eventType?: string;
      eventData?: MonnifyTransaction & { transactionHash?: string; product?: { reference?: string } };
    };
    const d = event.eventData ?? {};
    return {
      eventId: `monnify:${event.eventType ?? "event"}:${d.transactionReference ?? d.paymentReference ?? "unknown"}`,
      type: event.eventType ?? "UNKNOWN",
      providerRef: d.paymentReference ?? d.product?.reference ?? null,
      status: d.paymentStatus ? mapStatus(d.paymentStatus) : undefined,
      amountMinor: d.amountPaid != null ? fromMajor(Number(d.amountPaid)) : undefined,
      currency: d.currencyCode?.toUpperCase(),
      paidAt: d.paidOn ? new Date(d.paidOn) : undefined,
      failureReason: d.paymentStatus === "FAILED" ? d.paymentStatus : undefined,
    };
  },
};
