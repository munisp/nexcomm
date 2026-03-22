/**
 * Internal Mojaloop Settlement Callback Route
 * ============================================
 * Called by the Go mojaloop-adapter when a Mojaloop transfer reaches COMMITTED
 * state (i.e., the fulfil callback has been received from the Mojaloop hub).
 *
 * Endpoint: POST /api/internal/mojaloop/settlement-callback
 * Auth:     X-Source: mojaloop-adapter header (internal service-to-service only)
 *
 * On receipt of a committed transfer this handler:
 *  1. Validates the payload
 *  2. Upserts the transfer record in mojaloop_transfers (marks as COMMITTED)
 *  3. Emits mojaloop.transfer.committed Kafka event for the lakehouse
 *  4. Returns 200 OK to the Go adapter
 */

import { Router, Request, Response } from "express";
import { z } from "zod";
import { getDb } from "../db";
import {
  mojaloopTransfers,
} from "../../drizzle/schema";
import { eq } from "drizzle-orm";
import {
  emitMojaloopTransferCommitted,
} from "../kafka/kafkaProducer";

export const mojaloopSettlementCallbackRouter = Router();

// ─── Payload schema ───────────────────────────────────────────────────────────

const CommittedTransferSchema = z.object({
  transferId: z.string().min(1),
  settlementId: z.string().optional(),
  payerFspId: z.string().min(1),
  payeeFspId: z.string().min(1),
  amount: z.number().positive(),
  currency: z.string().min(3).max(3),
  fulfilment: z.string().optional(),
  committedAt: z.number().int().positive(),
});

// ─── Route handler ────────────────────────────────────────────────────────────

mojaloopSettlementCallbackRouter.post(
  "/api/internal/mojaloop/settlement-callback",
  async (req: Request, res: Response) => {
    // Validate source header — only the Go mojaloop-adapter should call this
    const source = req.headers["x-source"];
    if (source !== "mojaloop-adapter") {
      res.status(403).json({ error: "Forbidden: invalid X-Source header" });
      return;
    }

    // Parse and validate payload
    const parsed = CommittedTransferSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid payload", details: parsed.error.flatten() });
      return;
    }

    const {
      transferId,
      payerFspId,
      payeeFspId,
      amount,
      currency,
      fulfilment,
      committedAt,
    } = parsed.data;

    try {
      const db = await getDb();
      if (!db) {
        res.status(503).json({ error: "Database unavailable" });
        return;
      }

      // 1. Upsert mojaloop_transfers — mark as COMMITTED
      const existing = await db
        .select()
        .from(mojaloopTransfers)
        .where(eq(mojaloopTransfers.transferId, transferId))
        .limit(1);

      if (existing.length > 0) {
        await db
          .update(mojaloopTransfers)
          .set({
            status: "COMMITTED",
            fulfilment: fulfilment ?? null,
            updatedAt: new Date(committedAt),
          })
          .where(eq(mojaloopTransfers.transferId, transferId));
      } else {
        // Insert if not found (e.g., adapter restarted and lost in-memory state)
        await db.insert(mojaloopTransfers).values({
          transferId,
          payerFspId,
          payeeFspId,
          // Use FSP IDs as identifiers when the original identifiers are not available
          // (this happens when the adapter restarts and loses in-memory state)
          payerIdentifier: payerFspId,
          payeeIdentifier: payeeFspId,
          amount: String(amount),
          currency,
          status: "COMMITTED",
          fulfilment: fulfilment ?? null,
          committedAt: new Date(committedAt),
          createdAt: new Date(committedAt),
          updatedAt: new Date(committedAt),
        });
      }

      // 2. Emit Kafka event for lakehouse ingestion
      await emitMojaloopTransferCommitted({
        transferId,
        payerFspId,
        payeeFspId,
        amount,
        currency,
        fulfilment,
        committedAt,
      });

      res.status(200).json({
        ok: true,
        transferId,
        message: "Mojaloop transfer committed and settlement record updated",
      });
    } catch (err) {
      console.error("[MojaloopSettlementCallback] Error processing committed transfer:", err);
      res.status(500).json({ error: "Internal error processing settlement callback" });
    }
  }
);
