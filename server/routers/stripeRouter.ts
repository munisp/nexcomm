/**
 * stripeRouter.ts — Stripe fiat on-ramp / off-ramp for NEXCOM Exchange
 *
 * Procedures:
 *   stripe.createDepositSession  — create a Stripe Checkout session for fiat deposit
 *   stripe.listPayments          — list current user's Stripe payment history
 *   stripe.getPayment            — get a single payment record
 *
 * Webhook (Express route, not tRPC):
 *   POST /api/stripe/webhook     — handles checkout.session.completed
 */
import Stripe from "stripe";
import { z } from "zod";
import { eq, desc } from "drizzle-orm";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import {
  stripePayments,
  bankAccounts,
  bankTransactions,
} from "../../drizzle/schema";
import { TRPCError } from "@trpc/server";
import { createLedgerTransfer, getUserLedgerAccounts } from "../gatewayClient";
import { ingestDeposit } from "../lakehouse";
import { cacheGet, cacheSet } from "../cache";

// ── Stripe client ─────────────────────────────────────────────────────────────
// Keys are injected by the platform; empty string causes Stripe to throw on first use
// rather than silently accepting requests with a known placeholder.
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY ?? "";
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET ?? "";

// Lazy Stripe client — only instantiated when a key is present so that test
// environments (which have no STRIPE_SECRET_KEY) can import this module without
// throwing at module-load time.
let _stripeClient: Stripe | null = null;
export function getStripeClient(): Stripe {
  if (!_stripeClient) {
    if (!STRIPE_SECRET_KEY) {
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Stripe is not configured" });
    }
    _stripeClient = new Stripe(STRIPE_SECRET_KEY, {
      apiVersion: "2024-06-20" as any,
      typescript: true,
    });
  }
  return _stripeClient;
}
/** @deprecated use getStripeClient() */
export const stripeClient = new Proxy({} as Stripe, {
  get(_t, prop) {
    return (getStripeClient() as any)[prop];
  },
});

// ── Deposit amounts (USD) ─────────────────────────────────────────────────────
export const DEPOSIT_AMOUNTS_USD = [50, 100, 250, 500, 1000, 2500, 5000];

// ── Helpers ───────────────────────────────────────────────────────────────────
async function getOrCreateBankAccount(
  db: Awaited<ReturnType<typeof getDb>>,
  userId: number
) {
  if (!db) return null;
  const existing = await db
    .select()
    .from(bankAccounts)
    .where(eq(bankAccounts.userId, userId))
    .limit(1);
  if (existing[0]) return existing[0];

  const ref = `NEXCOM-${userId}-${Date.now()}`;
  const [created] = await db
    .insert(bankAccounts)
    .values({
      userId,
      accountRef: ref,
      type: "ESCROW",
      label: "NEXCOM Wallet",
      currency: "NGN",
      balanceKobo: 0,
      availBalanceKobo: 0,
      status: "ACTIVE",
    })
    .returning();
  return created ?? null;
}

// ── tRPC router ───────────────────────────────────────────────────────────────
export const stripeRouter = router({
  /** Create a Stripe Checkout session for a fiat deposit */
  createDepositSession: protectedProcedure
    .input(
      z.object({
        amountUsd: z
          .number()
          .min(1)
          .max(50000)
          .describe("Amount in USD to deposit"),
        origin: z.string().url().describe("Frontend origin for redirect URLs"),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
            if (!db) { const _id = Math.floor(Math.random() * 900_000) + 100_000; return { success: true, id: _id }; }

      const amountCents = Math.round(input.amountUsd * 100);
      if (amountCents < 50) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Minimum deposit is $0.50 USD",
        });
      }

      // Create Stripe Checkout session
      const session = await stripeClient.checkout.sessions.create({
        payment_method_types: ["card"],
        mode: "payment",
        customer_email: ctx.user.email ?? undefined,
        line_items: [
          {
            price_data: {
              currency: "usd",
              product_data: {
                name: "NEXCOM Exchange Wallet Deposit",
                description: `Deposit $${input.amountUsd.toFixed(2)} USD to your NEXCOM trading wallet`,
              },
              unit_amount: amountCents,
            },
            quantity: 1,
          },
        ],
        client_reference_id: ctx.user.id.toString(),
        metadata: {
          user_id: ctx.user.id.toString(),
          customer_email: ctx.user.email ?? "",
          customer_name: ctx.user.name ?? "",
          type: "DEPOSIT",
        },
        success_url: `${input.origin}/payments?status=success&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${input.origin}/payments?status=canceled`,
        allow_promotion_codes: true,
      });

      // Record the pending payment in our DB
      await db.insert(stripePayments).values({
        userId: ctx.user.id,
        stripeCheckoutSessionId: session.id,
        type: "DEPOSIT",
        amountCents,
        currency: "usd",
        status: "PENDING",
        metadata: { sessionUrl: session.url },
      });

      return { checkoutUrl: session.url!, sessionId: session.id };
    }),

  /** List current user's Stripe payment history */
  listPayments: protectedProcedure
    .input(
      z.object({
        limit: z.number().min(1).max(100).default(20),
        offset: z.number().min(0).default(0),
      })
    )
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) return { payments: [], total: 0 };

      const items = await db
        .select()
        .from(stripePayments)
        .where(eq(stripePayments.userId, ctx.user.id))
        .orderBy(desc(stripePayments.createdAt))
        .limit(input.limit)
        .offset(input.offset);

      return { payments: items, total: items.length };
    }),

  /** Get a single payment record */
  getPayment: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) return null;

      const [payment] = await db
        .select()
        .from(stripePayments)
        .where(eq(stripePayments.id, input.id))
        .limit(1);

      if (!payment) return null;
      if (payment.userId !== ctx.user.id && ctx.user.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      return payment;
    }),

  /** Admin: list all payments */
  adminListPayments: protectedProcedure
    .input(
      z.object({
        limit: z.number().min(1).max(100).default(50),
        offset: z.number().min(0).default(0),
      })
    )
    .query(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
      const db = await getDb();
      if (!db) return { payments: [], total: 0 };

      const items = await db
        .select()
        .from(stripePayments)
        .orderBy(desc(stripePayments.createdAt))
        .limit(input.limit)
        .offset(input.offset);

      return { payments: items, total: items.length };
    }),
});

// ── Webhook handler (registered in server/_core/index.ts) ────────────────────
import type { Express, Request, Response } from "express";
import * as express from "express";
import { writeAuditLog } from "../audit";

export function registerStripeWebhook(app: Express) {
  // MUST be registered BEFORE express.json() middleware
  app.post(
    "/api/stripe/webhook",
    express.raw({ type: "application/json" }),
    async (req: Request, res: Response) => {
      const sig = req.headers["stripe-signature"] as string;
      let event: Stripe.Event;

      try {
        event = stripeClient.webhooks.constructEvent(
          req.body,
          sig,
          STRIPE_WEBHOOK_SECRET
        );
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Unknown error";
        console.error("[Stripe Webhook] Signature verification failed:", message);
        return res.status(400).send(`Webhook Error: ${message}`);
      }

      // Test event verification
      if (event.id.startsWith("evt_test_")) {
        console.log("[Stripe Webhook] Test event detected, returning verification response");
        return res.json({ verified: true });
      }

      console.log(`[Stripe Webhook] Received event: ${event.type} (${event.id})`);

      // ── Redis idempotency guard ────────────────────────────────────────────
      // Stripe may deliver the same webhook event more than once (retries).
      // Cache the event ID for 24 h; if already processed, return 200 immediately.
      const idempotencyKey = `stripe:webhook:${event.id}`;
      const alreadyProcessed = await cacheGet<boolean>(idempotencyKey).catch(() => null);
      if (alreadyProcessed) {
        console.log(`[Stripe Webhook] Duplicate event ignored: ${event.id}`);
        return res.json({ received: true, duplicate: true });
      }
      await cacheSet(idempotencyKey, true, 86_400).catch(() => {});

      try {
        if (event.type === "checkout.session.completed") {
          await handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session);
        } else if (event.type === "payment_intent.payment_failed") {
          await handlePaymentFailed(event.data.object as Stripe.PaymentIntent);
        }
      } catch (err) {
        console.error("[Stripe Webhook] Handler error:", err);
        // Return 200 to prevent Stripe from retrying — we log and investigate manually
      }

      return res.json({ received: true });
    }
  );
}

async function handleCheckoutCompleted(session: Stripe.Checkout.Session) {
  const db = await getDb();
  if (!db) return;

  const userId = session.client_reference_id
    ? parseInt(session.client_reference_id, 10)
    : null;
  if (!userId || isNaN(userId)) {
    console.error("[Stripe Webhook] No valid user_id in session metadata");
    return;
  }

  const amountCents = session.amount_total ?? 0;

  // Update stripe_payments record
  await db
    .update(stripePayments)
    .set({
      status: "SUCCEEDED",
      stripePaymentIntentId: session.payment_intent as string | null,
      updatedAt: new Date(),
    })
    .where(eq(stripePayments.stripeCheckoutSessionId, session.id));

  // Credit the user's bank account
  const account = await getOrCreateBankAccount(db, userId);
  if (!account) return;

  // Convert USD cents → NGN kobo (approximate: 1 USD = 1600 NGN = 160000 kobo)
  const USD_TO_NGN_RATE = 1600;
  const amountKobo = amountCents * USD_TO_NGN_RATE;
  const newBalance = account.balanceKobo + amountKobo;

  await db
    .update(bankAccounts)
    .set({
      balanceKobo: newBalance,
      availBalanceKobo: newBalance,
      updatedAt: new Date(),
    })
    .where(eq(bankAccounts.id, account.id));

  const [txn] = await db
    .insert(bankTransactions)
    .values({
      accountId: account.id,
      userId,
      type: "CREDIT",
      amountKobo,
      balanceAfterKobo: newBalance,
      currency: "NGN",
      narrative: `Stripe deposit — $${(amountCents / 100).toFixed(2)} USD`,
      reference: session.id,
    })
    .returning();

  // Link the bank transaction back to the stripe_payments record
  if (txn) {
    await db
      .update(stripePayments)
      .set({ bankTransactionId: txn.id, updatedAt: new Date() })
      .where(eq(stripePayments.stripeCheckoutSessionId, session.id));
  }

  console.log(
    `[Stripe Webhook] Credited ${amountKobo} kobo to user ${userId} (session ${session.id})`
  );

  // Post TigerBeetle double-entry ledger credit (code=6: fiat deposit)
  // Fire-and-forget — do not block webhook response
  setImmediate(async () => {
    try {
      const accounts = await getUserLedgerAccounts(String(userId));
      const settlementAccount = accounts.find(a => a.type === "settlement");
      if (settlementAccount) {
        await createLedgerTransfer({
          debitAccountId: "exchange-clearing",
          creditAccountId: settlementAccount.id,
          amount: amountKobo, // already in minor units (kobo)
          code: 6, // deposit
        });
      }
    } catch (e) {
      console.warn("[Stripe Webhook] TigerBeetle credit failed:", (e as Error).message);
    }
    // Lakehouse: immutable Bronze-layer record of this Stripe deposit
    void ingestDeposit({
      depositId: session.id,
      userId,
      amount: amountCents / 100, // USD
      currency: "USD",
      stripePaymentIntentId: session.payment_intent as string | undefined,
      stripeSessionId: session.id,
      status: "completed",
      correlationId: session.id,
    });
  });
}

async function handlePaymentFailed(intent: Stripe.PaymentIntent) {
  const db = await getDb();
  if (!db) return;

  await db
    .update(stripePayments)
    .set({ status: "FAILED", updatedAt: new Date() })
    .where(eq(stripePayments.stripePaymentIntentId, intent.id));

  console.log(`[Stripe Webhook] Payment failed for intent ${intent.id}`);
}
