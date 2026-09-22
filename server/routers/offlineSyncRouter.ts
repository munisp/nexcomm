/**
 * Offline sync router (INNOV-C) — replays operations the PWA queued while
 * offline (client/src/lib/offlineOrderQueue.ts, IDB nexcom-offline-queue).
 *
 * Dedupe is layered and fail-closed:
 *   1. offline_operations.idempotency_key UNIQUE — one ledger row per queued op;
 *      a repeat submission returns the recorded prior result ("duplicate").
 *   2. orders.clientOrderId idempotency inside orders.create (existing) — the
 *      replay passes the idempotency key through as clientOrderId, so even a
 *      ledger-miss race cannot double-place an order.
 *
 * Unknown operation types are rejected at input validation (z.literal union) —
 * extend the union deliberately when new offline operation types are added.
 *
 * Register in server/routers.ts (see INNOV-C/MANIFEST.md):
 *   import { offlineSyncRouter } from "./routers/offlineSyncRouter";
 *   ... offlineSync: offlineSyncRouter,
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { offlineOperations } from "../../drizzle/schema-offline-sync";
import { ordersRouter } from "./orders";

// Payload mirrors orders.create input (minus idempotency fields — the key is
// carried separately and injected as clientOrderId at replay time).
const orderCreatePayload = z.object({
  symbol: z.string().min(1).max(32),
  assetClass: z.enum(["COMMODITY", "FOREX", "EQUITY", "DIGITAL_ASSET", "INDEX"]).default("COMMODITY"),
  side: z.enum(["BUY", "SELL"]),
  orderType: z.enum(["LIMIT", "MARKET", "STOP_LIMIT"]),
  quantity: z.number().positive(),
  price: z.number().positive().optional(),
  stopPrice: z.number().positive().optional(),
  timeInForce: z.enum(["GTC", "DAY", "IOC", "FOK"]).default("GTC"),
  notes: z.string().max(512).optional(),
});

const queuedOperation = z.object({
  // Fail closed: only explicitly supported offline operation types are accepted.
  type: z.literal("order.create"),
  idempotencyKey: z.string().uuid(),
  payload: orderCreatePayload,
});

export interface SubmitResult {
  idempotencyKey: string;
  status: "done" | "duplicate" | "failed";
  orderId?: number;
  error?: string;
}

export const offlineSyncRouter = router({
  /**
   * Replay a batch of queued operations through their real server paths.
   * Per-operation results — one failure never fails the batch.
   */
  submitQueued: protectedProcedure
    .input(z.object({ operations: z.array(queuedOperation).min(1).max(50) }))
    .mutation(async ({ ctx, input }): Promise<{ results: SubmitResult[] }> => {
      const db = await getDb();
      if (!db) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Database unavailable — operations remain queued",
        });
      }
      const userId = ctx.user.id;
      // Replay through the REAL orders.create procedure (same validation,
      // balance checks, matching-engine handoff) — no duplicated logic.
      const ordersCaller = ordersRouter.createCaller(ctx);
      const results: SubmitResult[] = [];

      for (const op of input.operations) {
        // ── Ledger dedupe: insert first; unique conflict = already processed ──
        try {
          await db.insert(offlineOperations).values({
            userId,
            idempotencyKey: op.idempotencyKey,
            operationType: op.type,
            payload: op.payload,
            status: "processing",
          });
        } catch (err: unknown) {
          // Postgres 23505 unique_violation → already replayed; return prior result
          const code = (err as { code?: string })?.code;
          if (code === "23505") {
            const prior = await db
              .select()
              .from(offlineOperations)
              .where(
                and(
                  eq(offlineOperations.idempotencyKey, op.idempotencyKey),
                  eq(offlineOperations.userId, userId)
                )
              )
              .limit(1);
            const priorResult = prior[0]?.result as { orderId?: number } | null | undefined;
            results.push({
              idempotencyKey: op.idempotencyKey,
              status: "duplicate",
              orderId: priorResult?.orderId,
            });
            continue;
          }
          results.push({ idempotencyKey: op.idempotencyKey, status: "failed", error: "ledger write failed" });
          continue;
        }

        // ── Replay through the real order path ──
        try {
          const placed = await ordersCaller.create({
            ...op.payload,
            clientOrderId: op.idempotencyKey, // second layer of dedupe
          });
          const orderId = (placed as { orderId?: number }).orderId;
          await db
            .update(offlineOperations)
            .set({ status: "done", result: { orderId }, processedAt: new Date() })
            .where(eq(offlineOperations.idempotencyKey, op.idempotencyKey));
          results.push({ idempotencyKey: op.idempotencyKey, status: "done", orderId });
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          await db
            .update(offlineOperations)
            .set({ status: "failed", result: { error: message }, processedAt: new Date() })
            .where(eq(offlineOperations.idempotencyKey, op.idempotencyKey));
          results.push({ idempotencyKey: op.idempotencyKey, status: "failed", error: message });
        }
      }

      return { results };
    }),

  /** Status lookup for queued keys the client is awaiting confirmation on. */
  status: protectedProcedure
    .input(z.object({ idempotencyKeys: z.array(z.string().uuid()).max(50) }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) return { operations: [] };
      const rows = await db
        .select()
        .from(offlineOperations)
        .where(eq(offlineOperations.userId, ctx.user.id));
      const wanted = new Set(input.idempotencyKeys);
      return {
        operations: rows
          .filter((r) => wanted.has(r.idempotencyKey))
          .map((r) => ({
            idempotencyKey: r.idempotencyKey,
            status: r.status,
            result: r.result,
            processedAt: r.processedAt,
          })),
      };
    }),
});
