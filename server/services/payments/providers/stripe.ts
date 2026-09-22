/**
 * Stripe international collection rail (PAY-RAILS).
 *
 * This provider is a thin adapter over the EXISTING Stripe integration in
 * server/routers/stripeRouter.ts — it reuses getStripeClient() so both the
 * legacy stripe.createDepositSession flow and the unified payments.* framework
 * share one client, one key set, and one webhook secret. stripeRouter keeps
 * working unchanged (its /api/stripe/webhook Express route stays registered);
 * this adapter additionally represents Stripe inside the provider registry so
 * resolveProvider() can pick it for USD/international collections.
 *
 *  - Initialize: stripe.checkout.sessions.create (mode=payment, card)
 *  - Verify:     stripe.checkout.sessions.retrieve(providerRef)
 *  - Refund:     stripe.refunds.create({ payment_intent })
 *  - Webhook:    stripe.webhooks.constructEvent(rawBody, sig, secret) — the
 *                official SDK verification (timestamped HMAC + tolerance).
 *
 * Env (already used by stripeRouter):
 *   STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET
 *
 * Amounts: cents — minor units. Matches our convention.
 */
import Stripe from "stripe";
import { getStripeClient } from "../../../routers/stripeRouter";
import type {
  PaymentInitResult,
  PaymentIntent,
  PaymentProvider,
  PaymentResult,
  PaymentStatus,
  NormalizedWebhookEvent,
  WebhookHeaders,
} from "../types";

const WEBHOOK_SECRET = () => process.env.STRIPE_WEBHOOK_SECRET ?? "";

function mapSessionStatus(session: Stripe.Checkout.Session): PaymentStatus {
  if (session.payment_status === "paid") return "success";
  if (session.status === "expired") return "abandoned";
  if (session.payment_status === "unpaid") return "processing";
  return "pending";
}

export const stripePaymentProvider: PaymentProvider = {
  name: "stripe",
  displayName: "Stripe (International)",
  currencies: ["USD", "EUR", "GBP", "NGN"],
  channels: ["card", "bank_debit"],
  capabilities: { refunds: true, payouts: false, recurring: true, webhooks: true },

  isConfigured: () => (process.env.STRIPE_SECRET_KEY ?? "").length > 0,

  async initializePayment(intent: PaymentIntent): Promise<PaymentInitResult> {
    const stripe = getStripeClient();
    const session = await stripe.checkout.sessions.create({
      payment_method_types: intent.channel === "bank_debit" ? ["us_bank_account"] : ["card"],
      mode: "payment",
      customer_email: intent.customer.email ?? undefined,
      line_items: [
        {
          price_data: {
            currency: intent.currency.toLowerCase(),
            product_data: {
              name: "NEXCOM Exchange Wallet Deposit",
              description: `NEXCOM ${intent.purpose} — ${intent.currency} ${(intent.amountMinor / 100).toFixed(2)}`,
            },
            unit_amount: intent.amountMinor, // cents — minor units
          },
          quantity: 1,
        },
      ],
      client_reference_id: String(intent.customer.userId),
      metadata: {
        user_id: String(intent.customer.userId),
        type: intent.purpose.toUpperCase(),
        idempotency_key: intent.idempotencyKey,
        framework: "pay-rails",
      },
      success_url: intent.callbackUrl
        ? `${intent.callbackUrl}?reference={CHECKOUT_SESSION_ID}&provider=stripe`
        : undefined,
      cancel_url: intent.callbackUrl
        ? `${intent.callbackUrl}?reference={CHECKOUT_SESSION_ID}&provider=stripe&cancelled=1`
        : undefined,
    });
    return {
      providerRef: session.id,
      authorizationUrl: session.url ?? undefined,
      expiresAt: session.expires_at ? new Date(session.expires_at * 1000) : undefined,
    };
  },

  async verifyPayment(providerRef: string): Promise<PaymentResult> {
    const stripe = getStripeClient();
    const session = await stripe.checkout.sessions.retrieve(providerRef);
    const status = mapSessionStatus(session);
    return {
      providerRef: session.id,
      status,
      amountMinor: session.amount_total ?? 0, // cents
      currency: (session.currency ?? "usd").toUpperCase(),
      channel: "card",
      paidAt: status === "success" ? new Date(session.created * 1000) : undefined,
      raw: { paymentIntent: session.payment_intent as string | null, paymentStatus: session.payment_status },
    };
  },

  async refund(payment: PaymentResult, amountMinor?: number): Promise<PaymentResult> {
    const stripe = getStripeClient();
    const paymentIntent = (payment.raw as { paymentIntent?: string | null } | undefined)?.paymentIntent;
    if (!paymentIntent) throw new Error(`Stripe refund for ${payment.providerRef}: missing payment intent`);
    await stripe.refunds.create({
      payment_intent: paymentIntent,
      ...(amountMinor ? { amount: amountMinor } : {}),
    });
    return { ...payment, status: "refunded" };
  },

  verifyWebhookSignature(headersIn: WebhookHeaders, rawBody: Buffer): boolean {
    const h = headersIn["stripe-signature"];
    const sig = Array.isArray(h) ? h[0] : h;
    if (!sig || !WEBHOOK_SECRET()) return false;
    try {
      // constructEvent performs timestamped-HMAC verification internally.
      getStripeClient().webhooks.constructEvent(rawBody, sig, WEBHOOK_SECRET());
      return true;
    } catch {
      return false;
    }
  },

  parseWebhook(_headers: WebhookHeaders, rawBody: Buffer): NormalizedWebhookEvent {
    const event = JSON.parse(rawBody.toString("utf8")) as Stripe.Event;
    let providerRef: string | null = null;
    let status: PaymentStatus | undefined;
    let amountMinor: number | undefined;
    let currency: string | undefined;
    let paidAt: Date | undefined;
    let failureReason: string | undefined;

    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;
      providerRef = session.id;
      status = session.payment_status === "paid" ? "success" : "processing";
      amountMinor = session.amount_total ?? undefined;
      currency = session.currency?.toUpperCase();
      paidAt = status === "success" ? new Date(session.created * 1000) : undefined;
    } else if (event.type === "payment_intent.payment_failed") {
      const intent = event.data.object as Stripe.PaymentIntent;
      providerRef = intent.id;
      status = "failed";
      amountMinor = intent.amount;
      currency = intent.currency?.toUpperCase();
      failureReason = intent.last_payment_error?.message ?? undefined;
    } else if (event.type === "checkout.session.expired") {
      const session = event.data.object as Stripe.Checkout.Session;
      providerRef = session.id;
      status = "abandoned";
    }

    return {
      eventId: event.id, // Stripe event ids are unique — perfect dedupe anchor
      type: event.type,
      providerRef,
      status,
      amountMinor,
      currency,
      paidAt,
      failureReason,
    };
  },
};
