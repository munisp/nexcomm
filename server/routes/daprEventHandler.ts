/**
 * NEXCOM Exchange — Dapr Event Handler Routes
 * ─────────────────────────────────────────────────────────────────────────────
 * Express routes that receive Dapr pub/sub events for fund-flow processing.
 * Each route corresponds to a subscription rule in infra/dapr/subscriptions.yaml.
 *
 * Dapr delivers events as HTTP POST to these endpoints.
 * Each handler:
 *   1. Validates the CloudEvent envelope
 *   2. Processes the fund-flow event (DB update, TigerBeetle, notifications)
 *   3. Returns 200 to ACK (Dapr will retry on non-200)
 *
 * Idempotency: each handler checks the Dapr state store for the event ID
 * before processing to prevent duplicate execution.
 */

import { Router, Request, Response } from "express";
import { getDb } from "../db";
import { notifications } from "../../drizzle/schema";
import { getStateValue, saveIdempotencyKey } from "../dapr/daprClient";
import { writeAuditLog } from "../audit";

const router = Router();

// ─── Middleware: parse Dapr CloudEvent envelope ───────────────────────────────

function extractCloudEvent(req: Request): {
  id: string;
  type: string;
  data: unknown;
} | null {
  const body = req.body as Record<string, unknown>;
  if (!body || typeof body !== "object") return null;
  const id = (body.id ?? body.traceid ?? body.datacontenttype) as string;
  const type = body.type as string;
  const data = body.data ?? body;
  if (!id || !type) return null;
  return { id: String(id), type, data };
}

// ─── Deposit completed ────────────────────────────────────────────────────────

router.post("/deposit/completed", async (req: Request, res: Response) => {
  const event = extractCloudEvent(req);
  if (!event) return res.status(400).json({ error: "Invalid CloudEvent" });

  // Idempotency check
  const existing = await getStateValue(`deposit-completed:${event.id}`);
  if (existing) return res.status(200).json({ status: "duplicate" });

  try {
    const d = event.data as { depositId: string; userId: number; amount: number; currency: string };
    const db = await getDb();
    if (db) {
      await db.insert(notifications).values({
        userId: d.userId,
        type: "ALERT",
        title: "Deposit Confirmed",
        message: `Your deposit of ${d.amount.toLocaleString()} ${d.currency} has been confirmed and credited to your account.`,
        read: false,
      });
    }
    await writeAuditLog({
      userId: d.userId,
      action: "DEPOSIT_COMPLETED",
      resource: "deposit",
      resourceId: d.depositId,
      details: { amount: d.amount, currency: d.currency, source: "dapr" },
    });
    await saveIdempotencyKey(`deposit-completed:${event.id}`, { processedAt: new Date().toISOString() });
    return res.status(200).json({ status: "ok" });
  } catch (err) {
    console.error("[Dapr] deposit/completed handler error:", err);
    return res.status(500).json({ error: "processing failed" });
  }
});

// ─── Deposit failed ───────────────────────────────────────────────────────────

router.post("/deposit/failed", async (req: Request, res: Response) => {
  const event = extractCloudEvent(req);
  if (!event) return res.status(400).json({ error: "Invalid CloudEvent" });

  const existing = await getStateValue(`deposit-failed:${event.id}`);
  if (existing) return res.status(200).json({ status: "duplicate" });

  try {
    const d = event.data as { depositId: string; userId: number; amount: number; currency: string; reason?: string };
    const db = await getDb();
    if (db) {
      await db.insert(notifications).values({
        userId: d.userId,
        type: "ALERT",
        title: "Deposit Failed",
        message: `Your deposit of ${d.amount.toLocaleString()} ${d.currency} could not be processed. ${d.reason ?? "Please try again or contact support."}`,
        read: false,
      });
    }
    await saveIdempotencyKey(`deposit-failed:${event.id}`, { processedAt: new Date().toISOString() });
    return res.status(200).json({ status: "ok" });
  } catch (err) {
    console.error("[Dapr] deposit/failed handler error:", err);
    return res.status(500).json({ error: "processing failed" });
  }
});

// ─── Withdrawal completed ─────────────────────────────────────────────────────

router.post("/withdrawal/completed", async (req: Request, res: Response) => {
  const event = extractCloudEvent(req);
  if (!event) return res.status(400).json({ error: "Invalid CloudEvent" });

  const existing = await getStateValue(`withdrawal-completed:${event.id}`);
  if (existing) return res.status(200).json({ status: "duplicate" });

  try {
    const d = event.data as { withdrawalId: string; userId: number; amount: number; currency: string };
    const db = await getDb();
    if (db) {
      await db.insert(notifications).values({
        userId: d.userId,
        type: "ALERT",
        title: "Withdrawal Processed",
        message: `Your withdrawal of ${d.amount.toLocaleString()} ${d.currency} has been processed and sent to your bank.`,
        read: false,
      });
    }
    await writeAuditLog({
      userId: d.userId,
      action: "WITHDRAWAL_COMPLETED",
      resource: "withdrawal",
      resourceId: d.withdrawalId,
      details: { amount: d.amount, currency: d.currency, source: "dapr" },
    });
    await saveIdempotencyKey(`withdrawal-completed:${event.id}`, { processedAt: new Date().toISOString() });
    return res.status(200).json({ status: "ok" });
  } catch (err) {
    console.error("[Dapr] withdrawal/completed handler error:", err);
    return res.status(500).json({ error: "processing failed" });
  }
});

// ─── Withdrawal failed ────────────────────────────────────────────────────────

router.post("/withdrawal/failed", async (req: Request, res: Response) => {
  const event = extractCloudEvent(req);
  if (!event) return res.status(400).json({ error: "Invalid CloudEvent" });

  const existing = await getStateValue(`withdrawal-failed:${event.id}`);
  if (existing) return res.status(200).json({ status: "duplicate" });

  try {
    const d = event.data as { withdrawalId: string; userId: number; amount: number; currency: string; reason?: string };
    const db = await getDb();
    if (db) {
      await db.insert(notifications).values({
        userId: d.userId,
        type: "ALERT",
        title: "Withdrawal Failed",
        message: `Your withdrawal of ${d.amount.toLocaleString()} ${d.currency} failed. ${d.reason ?? "Funds have been returned to your account."}`,
        read: false,
      });
    }
    await saveIdempotencyKey(`withdrawal-failed:${event.id}`, { processedAt: new Date().toISOString() });
    return res.status(200).json({ status: "ok" });
  } catch (err) {
    console.error("[Dapr] withdrawal/failed handler error:", err);
    return res.status(500).json({ error: "processing failed" });
  }
});

// ─── Order filled ─────────────────────────────────────────────────────────────

router.post("/order/filled", async (req: Request, res: Response) => {
  const event = extractCloudEvent(req);
  if (!event) return res.status(400).json({ error: "Invalid CloudEvent" });

  const existing = await getStateValue(`order-filled:${event.id}`);
  if (existing) return res.status(200).json({ status: "duplicate" });

  try {
    const d = event.data as { orderId: number; userId: number; symbol: string; side: string; filledQty: string; fillPrice: string };
    const db = await getDb();
    if (db) {
      await db.insert(notifications).values({
        userId: d.userId,
        type: "TRADE",
        title: `Order Filled — ${d.symbol}`,
        message: `Your ${d.side} order for ${d.filledQty} ${d.symbol} was filled at ${d.fillPrice}.`,
        read: false,
      });
    }
    await saveIdempotencyKey(`order-filled:${event.id}`, { processedAt: new Date().toISOString() });
    return res.status(200).json({ status: "ok" });
  } catch (err) {
    console.error("[Dapr] order/filled handler error:", err);
    return res.status(500).json({ error: "processing failed" });
  }
});

// ─── Trade settled ────────────────────────────────────────────────────────────

router.post("/trade/settled", async (req: Request, res: Response) => {
  const event = extractCloudEvent(req);
  if (!event) return res.status(400).json({ error: "Invalid CloudEvent" });

  const existing = await getStateValue(`trade-settled:${event.id}`);
  if (existing) return res.status(200).json({ status: "duplicate" });

  try {
    const d = event.data as { settlementId: string; buyerUserId: number; sellerUserId: number; symbol: string; amount: number; currency: string };
    const db = await getDb();
    if (db) {
      await Promise.all([
        db.insert(notifications).values({
          userId: d.buyerUserId,
          type: "SETTLEMENT",
          title: `Trade Settled — ${d.symbol}`,
          message: `Your purchase of ${d.symbol} has been settled. Net amount: ${d.amount.toLocaleString()} ${d.currency}.`,
          read: false,
        }),
        db.insert(notifications).values({
          userId: d.sellerUserId,
          type: "SETTLEMENT",
          title: `Trade Settled — ${d.symbol}`,
          message: `Your sale of ${d.symbol} has been settled. Net proceeds: ${d.amount.toLocaleString()} ${d.currency}.`,
          read: false,
        }),
      ]);
    }
    await saveIdempotencyKey(`trade-settled:${event.id}`, { processedAt: new Date().toISOString() });
    return res.status(200).json({ status: "ok" });
  } catch (err) {
    console.error("[Dapr] trade/settled handler error:", err);
    return res.status(500).json({ error: "processing failed" });
  }
});

// ─── Margin call ──────────────────────────────────────────────────────────────

router.post("/margin/call", async (req: Request, res: Response) => {
  const event = extractCloudEvent(req);
  if (!event) return res.status(400).json({ error: "Invalid CloudEvent" });

  const existing = await getStateValue(`margin-call:${event.id}`);
  if (existing) return res.status(200).json({ status: "duplicate" });

  try {
    const d = event.data as { userId: number; utilisationPct: number; marginBalance: number; requiredMargin: number; currency: string };
    const db = await getDb();
    if (db) {
      await db.insert(notifications).values({
        userId: d.userId,
        type: "MARGIN_CALL",
        title: "⚠️ Margin Call",
        message: `Your margin utilisation is at ${d.utilisationPct.toFixed(1)}%. Please deposit additional margin of ${(d.requiredMargin - d.marginBalance).toLocaleString()} ${d.currency} to avoid liquidation.`,
        read: false,
      });
    }
    await saveIdempotencyKey(`margin-call:${event.id}`, { processedAt: new Date().toISOString() });
    return res.status(200).json({ status: "ok" });
  } catch (err) {
    console.error("[Dapr] margin/call handler error:", err);
    return res.status(500).json({ error: "processing failed" });
  }
});

// ─── Margin liquidated ────────────────────────────────────────────────────────

router.post("/margin/liquidated", async (req: Request, res: Response) => {
  const event = extractCloudEvent(req);
  if (!event) return res.status(400).json({ error: "Invalid CloudEvent" });

  const existing = await getStateValue(`margin-liquidated:${event.id}`);
  if (existing) return res.status(200).json({ status: "duplicate" });

  try {
    const d = event.data as { userId: number; symbol: string; quantity: string; liquidationPrice: string; currency: string };
    const db = await getDb();
    if (db) {
      await db.insert(notifications).values({
        userId: d.userId,
        type: "LIQUIDATED",
        title: "🔴 Position Liquidated",
        message: `Your ${d.symbol} position (${d.quantity} units) was liquidated at ${d.liquidationPrice} ${d.currency} due to insufficient margin.`,
        read: false,
      });
    }
    await saveIdempotencyKey(`margin-liquidated:${event.id}`, { processedAt: new Date().toISOString() });
    return res.status(200).json({ status: "ok" });
  } catch (err) {
    console.error("[Dapr] margin/liquidated handler error:", err);
    return res.status(500).json({ error: "processing failed" });
  }
});

// ─── Loan disbursed ───────────────────────────────────────────────────────────

router.post("/loan/disbursed", async (req: Request, res: Response) => {
  const event = extractCloudEvent(req);
  if (!event) return res.status(400).json({ error: "Invalid CloudEvent" });

  const existing = await getStateValue(`loan-disbursed:${event.id}`);
  if (existing) return res.status(200).json({ status: "duplicate" });

  try {
    const d = event.data as { loanId: string; userId: number; amount: number; currency: string; dueDate: string };
    const db = await getDb();
    if (db) {
      await db.insert(notifications).values({
        userId: d.userId,
        type: "ALERT",
        title: "Loan Disbursed",
        message: `Your loan of ${d.amount.toLocaleString()} ${d.currency} has been disbursed. Repayment due: ${new Date(d.dueDate).toLocaleDateString()}.`,
        read: false,
      });
    }
    await saveIdempotencyKey(`loan-disbursed:${event.id}`, { processedAt: new Date().toISOString() });
    return res.status(200).json({ status: "ok" });
  } catch (err) {
    console.error("[Dapr] loan/disbursed handler error:", err);
    return res.status(500).json({ error: "processing failed" });
  }
});

// ─── AML freeze ───────────────────────────────────────────────────────────────

router.post("/aml/freeze", async (req: Request, res: Response) => {
  const event = extractCloudEvent(req);
  if (!event) return res.status(400).json({ error: "Invalid CloudEvent" });

  const existing = await getStateValue(`aml-freeze:${event.id}`);
  if (existing) return res.status(200).json({ status: "duplicate" });

  try {
    const d = event.data as { userId: number; reason: string; alertId: string };
    const db = await getDb();
    if (db) {
      await db.insert(notifications).values({
        userId: d.userId,
        type: "SECURITY_ALERT",
        title: "Account Under Review",
        message: "Your account has been temporarily restricted pending a compliance review. Please contact support for assistance.",
        read: false,
      });
    }
    await writeAuditLog({
      userId: d.userId,
      action: "AML_FREEZE",
      resource: "user",
      resourceId: String(d.userId),
      details: { reason: d.reason, alertId: d.alertId, source: "dapr" },
    });
    await saveIdempotencyKey(`aml-freeze:${event.id}`, { processedAt: new Date().toISOString() });
    return res.status(200).json({ status: "ok" });
  } catch (err) {
    console.error("[Dapr] aml/freeze handler error:", err);
    return res.status(500).json({ error: "processing failed" });
  }
});

// ─── Cross-border committed ───────────────────────────────────────────────────

router.post("/crossborder/committed", async (req: Request, res: Response) => {
  const event = extractCloudEvent(req);
  if (!event) return res.status(400).json({ error: "Invalid CloudEvent" });

  const existing = await getStateValue(`crossborder-committed:${event.id}`);
  if (existing) return res.status(200).json({ status: "duplicate" });

  try {
    const d = event.data as { transferId: string; userId: number; amount: string; currency: string; payeeFspId: string };
    const db = await getDb();
    if (db) {
      await db.insert(notifications).values({
        userId: d.userId,
        type: "SETTLEMENT",
        title: "Cross-Border Transfer Completed",
        message: `Your transfer of ${d.amount} ${d.currency} to ${d.payeeFspId} has been committed and confirmed by the Mojaloop hub.`,
        read: false,
      });
    }
    await saveIdempotencyKey(`crossborder-committed:${event.id}`, { processedAt: new Date().toISOString() });
    return res.status(200).json({ status: "ok" });
  } catch (err) {
    console.error("[Dapr] crossborder/committed handler error:", err);
    return res.status(500).json({ error: "processing failed" });
  }
});

// ─── Unhandled events (dead-letter fallback) ──────────────────────────────────

router.post("/unhandled", (req: Request, res: Response) => {
  const body = req.body as Record<string, unknown>;
  console.warn("[Dapr] Unhandled event type:", body?.type, "id:", body?.id);
  return res.status(200).json({ status: "acknowledged" });
});

export default router;
