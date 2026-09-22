/**
 * paymentsRouter.ts — unified payment collection rail API (PAY-RAILS)
 *
 * Procedures:
 *   payments.listProviders     — enabled rails + capabilities (provider picker UI)
 *   payments.initializeDeposit — create a collection on the best/explicit rail
 *                                (idempotent via client-supplied idempotencyKey)
 *   payments.verifyPayment     — pull authoritative status from the rail and
 *                                settle exactly once (ledger credit + lakehouse)
 *   payments.paymentStatus     — lightweight status poll (low-bandwidth clients)
 *   payments.myPayments        — paginated payment history for the current user
 *
 * Webhooks are NOT tRPC procedures — they are Express routes in
 * server/routes/paymentWebhooks.ts (raw-body signature verification).
 *
 * Amounts are ALWAYS minor units (kobo/cents).
 */
import { z } from "zod";
import { eq, desc, and } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { paymentTransactions } from "../../drizzle/schema-payments";
import { getProvider, listCapabilities, resolveProvider } from "../services/payments/registry";
import { settlePaymentSuccess, markPaymentTerminal } from "../services/payments/settle";
import type { PaymentChannel, PaymentProvider } from "../services/payments/types";

const channelEnum = z.enum(["card", "bank_transfer", "ussd", "qr", "mobile_money", "bank_debit"]);

/** Max single collection: ₦10,000,000.00 (1e9 kobo) — guard against fat-finger. */
const MAX_AMOUNT_MINOR = 1_000_000_000;
const MIN_AMOUNT_MINOR = 100; // ₦1.00 / $1.00

/** Build the user-facing callback URL for provider redirects. */
function callbackUrl(origin: string | undefined): string | undefined {
  const base = origin ?? process.env.PAYMENT_CALLBACK_BASE_URL;
  return base ? `${base.replace(/\/$/, "")}/payment/callback` : undefined;
}

/** Build the webhook URL we advertise to providers (where supported). */
function webhookUrl(origin: string | undefined, provider: string): string | undefined {
  const base = process.env.PAYMENT_WEBHOOK_BASE_URL ?? origin;
  return base ? `${base.replace(/\/$/, "")}/api/payments/${provider}/webhook` : undefined;
}

/**
 * Resolve the rail for a collection. Explicit `provider` names win; otherwise
 * the registry picks the first enabled+configured rail supporting currency+channel.
 */
function pickProvider(
  explicit: string | undefined,
  currency: string,
  channel: PaymentChannel | undefined
): PaymentProvider {
  if (explicit) {
    const p = getProvider(explicit);
    if (!p) throw new TRPCError({ code: "BAD_REQUEST", message: `Unknown or disabled payment provider: ${explicit}` });
    if (!p.isConfigured()) throw new TRPCError({ code: "BAD_REQUEST", message: `Provider ${explicit} is not configured (missing credentials)` });
    if (!p.currencies.includes(currency.toUpperCase())) {
      throw new TRPCError({ code: "BAD_REQUEST", message: `Provider ${explicit} does not support ${currency}` });
    }
    if (channel && !p.channels.includes(channel)) {
      throw new TRPCError({ code: "BAD_REQUEST", message: `Provider ${explicit} does not support channel ${channel}` });
    }
    return p;
  }
  const resolved = resolveProvider({ currency, channel });
  if (!resolved) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `No enabled payment provider supports ${currency}${channel ? ` via ${channel}` : ""}`,
    });
  }
  return resolved;
}

export const paymentsRouter = router({
  /** Enabled rails + capabilities for the provider picker UI. */
  listProviders: protectedProcedure.query(() => {
    return { providers: listCapabilities() };
  }),

  /**
   * Initialize a collection (default purpose: wallet deposit).
   * Idempotent: re-submitting the same idempotencyKey returns the existing
   * payment instead of creating a duplicate charge.
   */
  initializeDeposit: protectedProcedure
    .input(
      z.object({
        amountMinor: z.number().int().min(MIN_AMOUNT_MINOR).max(MAX_AMOUNT_MINOR),
        currency: z.string().length(3).default("NGN"),
        channel: channelEnum.optional(),
        provider: z.string().max(32).optional(),
        /** Client-generated unique key (nanoid/uuid) — the idempotency anchor. */
        idempotencyKey: z.string().min(8).max(128),
        purpose: z.enum(["deposit", "fee", "subscription"]).default("deposit"),
        /** Frontend origin for redirect/callback URLs (e.g. window.location.origin). */
        origin: z.string().url().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "Database unavailable" });

      // ── Idempotency: same key → same payment, no new provider call ────────
      const [existing] = await db
        .select()
        .from(paymentTransactions)
        .where(eq(paymentTransactions.idempotencyKey, input.idempotencyKey))
        .limit(1);
      if (existing) {
        if (existing.userId !== ctx.user.id) {
          throw new TRPCError({ code: "CONFLICT", message: "Idempotency key already used by another account" });
        }
        return { payment: existing, duplicate: true };
      }

      const provider = pickProvider(input.provider, input.currency, input.channel);

      // ── Create the session with the rail ──────────────────────────────────
      const init = await provider.initializePayment({
        idempotencyKey: input.idempotencyKey,
        amountMinor: input.amountMinor,
        currency: input.currency.toUpperCase(),
        channel: input.channel,
        purpose: input.purpose,
        customer: {
          userId: ctx.user.id,
          email: ctx.user.email,
          name: ctx.user.name,
        },
        callbackUrl: callbackUrl(input.origin),
        webhookUrl: webhookUrl(input.origin, provider.name),
        metadata: { source: "payments.initializeDeposit" },
      }).catch((e: unknown) => {
        throw new TRPCError({ code: "BAD_GATEWAY", message: (e as Error).message });
      });

      // ── Persist the payment row ───────────────────────────────────────────
      // Unique constraints on idempotencyKey/providerRef protect against the
      // narrow concurrent-submit race; on conflict we return the existing row.
      try {
        const [payment] = await db
          .insert(paymentTransactions)
          .values({
            idempotencyKey: input.idempotencyKey,
            userId: ctx.user.id,
            provider: provider.name,
            providerRef: init.providerRef,
            amountMinor: input.amountMinor,
            currency: input.currency.toUpperCase(),
            channel: input.channel ?? null,
            status: "pending",
            purpose: input.purpose,
            authorizationUrl: init.authorizationUrl ?? null,
            ussdCode: init.ussdCode ?? null,
            metadata: {
              qrData: init.qrData ?? null,
              transferAccount: init.transferAccount ?? null,
              expiresAt: init.expiresAt?.toISOString() ?? null,
              providerRaw: init.raw ?? null,
            },
          })
          .returning();
        return { payment, duplicate: false };
      } catch (e) {
        if ((e as { code?: string }).code === "23505") {
          const [row] = await db
            .select()
            .from(paymentTransactions)
            .where(eq(paymentTransactions.idempotencyKey, input.idempotencyKey))
            .limit(1);
          if (row) return { payment: row, duplicate: true };
        }
        throw e;
      }
    }),

  /**
   * Verify a payment against the rail and settle it.
   * Idempotent: an already-successful payment returns immediately without
   * touching the provider or the ledger (settle guard makes double-settlement
   * impossible even under concurrent verify+webhook).
   */
  verifyPayment: protectedProcedure
    .input(z.object({ providerRef: z.string().min(1).max(191) }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "Database unavailable" });

      const [payment] = await db
        .select()
        .from(paymentTransactions)
        .where(eq(paymentTransactions.providerRef, input.providerRef))
        .limit(1);
      if (!payment) throw new TRPCError({ code: "NOT_FOUND", message: "Payment not found" });
      if (payment.userId !== ctx.user.id && ctx.user.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN" });
      }

      // Already terminal — nothing to do (idempotent verify).
      if (payment.status === "success" || payment.status === "refunded") {
        return { payment, settle: "already-settled" as const };
      }

      const provider = getProvider(payment.provider);
      if (!provider) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `Provider ${payment.provider} unavailable` });
      }

      const result = await provider.verifyPayment(payment.providerRef).catch((e: unknown) => {
        // Provider unreachable — report current known status instead of failing hard.
        console.warn(`[Payments] verify via ${payment.provider} failed:`, (e as Error).message);
        return null;
      });
      if (!result) return { payment, settle: "unverified" as const };

      if (result.status === "success") {
        // Amount sanity check: never settle more than was authorized.
        if (result.amountMinor > 0 && result.amountMinor !== payment.amountMinor) {
          console.error(
            `[Payments] AMOUNT MISMATCH on ${payment.providerRef}: authorized ${payment.amountMinor}, collected ${result.amountMinor} — manual review required`
          );
          return { payment, settle: "amount-mismatch" as const };
        }
        // Mark processing first so the webhook path sees the in-flight state.
        await db
          .update(paymentTransactions)
          .set({ status: "processing", updatedAt: new Date() })
          .where(and(eq(paymentTransactions.id, payment.id), eq(paymentTransactions.status, "pending")));
        const settle = await settlePaymentSuccess(
          { ...payment, status: "processing" },
          result,
          /* awaitLedger (3s SLA, fallback queued) */ true
        );
        const [updated] = await db
          .select()
          .from(paymentTransactions)
          .where(eq(paymentTransactions.id, payment.id))
          .limit(1);
        return { payment: updated ?? payment, settle };
      }

      if (result.status === "failed" || result.status === "abandoned") {
        await markPaymentTerminal(payment, result.status, result.failureReason);
        const [updated] = await db
          .select()
          .from(paymentTransactions)
          .where(eq(paymentTransactions.id, payment.id))
          .limit(1);
        return { payment: updated ?? payment, settle: "terminal" as const };
      }

      // pending/processing — reflect the in-flight state for the poller.
      if (payment.status === "pending") {
        await db
          .update(paymentTransactions)
          .set({ status: "processing", updatedAt: new Date() })
          .where(eq(paymentTransactions.id, payment.id));
      }
      return { payment: { ...payment, status: "processing" as const }, settle: "pending" as const };
    }),

  /** Lightweight status poll — low-bandwidth friendly (no provider call). */
  paymentStatus: protectedProcedure
    .input(z.object({ providerRef: z.string().min(1).max(191) }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) return null;
      const [payment] = await db
        .select({
          providerRef: paymentTransactions.providerRef,
          provider: paymentTransactions.provider,
          status: paymentTransactions.status,
          amountMinor: paymentTransactions.amountMinor,
          currency: paymentTransactions.currency,
          paidAt: paymentTransactions.paidAt,
        })
        .from(paymentTransactions)
        .where(eq(paymentTransactions.providerRef, input.providerRef))
        .limit(1);
      if (!payment) return null;
      // Ownership is enforced by verifyPayment; the poll exposes no PII beyond
      // the caller's own reference, but we still scope to owner/admin.
      const [owner] = await db
        .select({ userId: paymentTransactions.userId })
        .from(paymentTransactions)
        .where(eq(paymentTransactions.providerRef, input.providerRef))
        .limit(1);
      if (owner && owner.userId !== ctx.user.id && ctx.user.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      return payment;
    }),

  /** Paginated payment history for the current user. */
  myPayments: protectedProcedure
    .input(
      z.object({
        page: z.number().min(1).default(1),
        limit: z.number().min(1).max(100).default(20),
        status: z.enum(["pending", "processing", "success", "failed", "abandoned", "refunded"]).optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) return { payments: [], total: 0 };
      const offset = (input.page - 1) * input.limit;
      const items = await db
        .select()
        .from(paymentTransactions)
        .where(
          input.status
            ? and(eq(paymentTransactions.userId, ctx.user.id), eq(paymentTransactions.status, input.status))
            : eq(paymentTransactions.userId, ctx.user.id)
        )
        .orderBy(desc(paymentTransactions.createdAt))
        .limit(input.limit)
        .offset(offset);
      return { payments: items, total: items.length };
    }),
});
