/**
 * paymentWebhooks.ts — unified inbound webhook route for all payment rails.
 *
 * Endpoint: POST /api/payments/:provider/webhook
 *   (:provider = paystack | flutterwave | monnify | interswitch | stripe | mock)
 *
 * MOUNTING (see MANIFEST snippet for server/_core/index.ts):
 *   app.use("/api/payments", express.raw({ type: "application/json" }), paymentWebhooksRouter);
 *   — MUST be mounted BEFORE express.json() (mirrors registerStripeWebhook) so
 *   the raw body is preserved for signature verification.
 *
 * Flow:
 *   1. Resolve provider; 404 unknown rails.
 *   2. verifyWebhookSignature (timing-safe) → 401 on failure.
 *   3. Dedupe: INSERT into payment_webhook_events (unique(provider, event_id))
 *      — a unique violation means "already seen" → 200 without reprocessing.
 *   4. Respond 200 immediately (well within provider retry windows), then
 *      process async: normalise event → on success settle exactly once via the
 *      guarded pending/processing→success transition + TigerBeetle credit.
 */
import { Router, Request, Response } from "express";
import { eq, and } from "drizzle-orm";
import { getDb } from "../db";
import { paymentTransactions, paymentWebhookEvents } from "../../drizzle/schema-payments";
import { getProvider } from "../services/payments/registry";
import { settlePaymentSuccess, markPaymentTerminal } from "../services/payments/settle";
import type { NormalizedWebhookEvent } from "../services/payments/types";

export const paymentWebhooksRouter = Router();

/** Coerce the request body to a Buffer (express.raw should guarantee this). */
function rawBodyOf(req: Request): Buffer {
  if (Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === "string") return Buffer.from(req.body, "utf8");
  return Buffer.from(JSON.stringify(req.body ?? ""), "utf8");
}

/** Process a verified, deduped webhook event (async, after the 200 response). */
async function processEvent(providerName: string, event: NormalizedWebhookEvent): Promise<void> {
  const db = await getDb();
  if (!db) {
    console.error(`[Payments Webhook] DB unavailable — cannot process ${providerName} event ${event.eventId}`);
    return;
  }
  try {
    if (event.providerRef && event.status) {
      const [payment] = await db
        .select()
        .from(paymentTransactions)
        .where(
          and(
            eq(paymentTransactions.provider, providerName),
            eq(paymentTransactions.providerRef, event.providerRef)
          )
        )
        .limit(1);

      if (!payment) {
        // Unknown payment (e.g. session created outside the framework — the
        // legacy stripeRouter webhook handles its own rows). Log and move on.
        console.warn(`[Payments Webhook] No payment_transactions row for ${providerName}:${event.providerRef}`);
      } else if (event.status === "success") {
        // Amount sanity check before settling.
        if (event.amountMinor != null && event.amountMinor > 0 && event.amountMinor !== payment.amountMinor) {
          console.error(
            `[Payments Webhook] AMOUNT MISMATCH on ${payment.providerRef}: authorized ${payment.amountMinor}, event ${event.amountMinor} — manual review required`
          );
        } else {
          // Exactly-once: only the first pending/processing→success transition wins.
          const outcome = await settlePaymentSuccess(payment, undefined, false);
          if (outcome === "already-settled") {
            console.log(`[Payments Webhook] ${event.providerRef} already settled — no-op`);
          }
        }
      } else if (event.status === "failed" || event.status === "abandoned") {
        await markPaymentTerminal(payment, event.status, event.failureReason);
      }
    }
  } catch (e) {
    console.error(`[Payments Webhook] Processing error for ${providerName} event ${event.eventId}:`, (e as Error).message);
  } finally {
    // Mark the dedupe row processed regardless of outcome — we never want the
    // provider to retry indefinitely; failures are logged for reconciliation.
    await db
      .update(paymentWebhookEvents)
      .set({ processed: true, processedAt: new Date() })
      .where(
        and(
          eq(paymentWebhookEvents.provider, providerName),
          eq(paymentWebhookEvents.eventId, event.eventId)
        )
      )
      .catch(() => {});
  }
}

paymentWebhooksRouter.post("/:provider/webhook", async (req: Request, res: Response) => {
  const providerName = String(req.params.provider ?? "").toLowerCase();
  const provider = getProvider(providerName);
  if (!provider) {
    return res.status(404).json({ error: "unknown payment provider" });
  }

  const rawBody = rawBodyOf(req);

  // ── 1. Signature verification (timing-safe inside each provider) ──────────
  let valid = false;
  try {
    valid = provider.verifyWebhookSignature(req.headers as Record<string, string | string[] | undefined>, rawBody);
  } catch (e) {
    console.warn(`[Payments Webhook] Signature check error (${providerName}):`, (e as Error).message);
  }
  if (!valid) {
    console.warn(`[Payments Webhook] Rejected ${providerName} webhook — invalid signature`);
    return res.status(401).json({ error: "invalid signature" });
  }

  // ── 2. Normalise ──────────────────────────────────────────────────────────
  let event: NormalizedWebhookEvent;
  try {
    event = provider.parseWebhook(req.headers as Record<string, string | string[] | undefined>, rawBody);
  } catch (e) {
    console.warn(`[Payments Webhook] Unparseable ${providerName} webhook:`, (e as Error).message);
    // 200 anyway: a verified-but-unparseable event should not trigger retries.
    return res.status(200).json({ received: true, parsed: false });
  }

  // ── 3. Dedupe (unique(provider, event_id) is the idempotency anchor) ──────
  const db = await getDb();
  if (db) {
    try {
      let payload: unknown = null;
      try { payload = JSON.parse(rawBody.toString("utf8")); } catch { /* keep null */ }
      await db.insert(paymentWebhookEvents).values({
        provider: providerName,
        eventId: event.eventId,
        payload: payload as Record<string, unknown> | null,
      });
    } catch (e) {
      if ((e as { code?: string }).code === "23505") {
        // Already seen — acknowledge without reprocessing.
        return res.status(200).json({ received: true, duplicate: true });
      }
      // Dedupe store failed — log and continue processing (better a duplicate
      // ledger-guarded settle than a lost webhook; settle itself is guarded).
      console.error(`[Payments Webhook] Dedupe insert failed (${providerName}):`, (e as Error).message);
    }
  }

  // ── 4. Ack fast, process async ────────────────────────────────────────────
  res.status(200).json({ received: true });
  setImmediate(() => {
    void processEvent(providerName, event);
  });
});
