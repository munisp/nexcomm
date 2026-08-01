/**
 * NEXCOM Exchange — Cross-Border FX tRPC Router
 *
 * Provides tRPC procedures to initiate, query, cancel, and list
 * cross-border FX transfers powered by the CrossBorderFxWorkflow
 * Temporal workflow (Mojaloop ILP 6-phase saga).
 *
 * Procedures:
 *   initiate   — start a new cross-border FX transfer
 *   getStatus  — query workflow status by workflowId
 *   cancel     — signal a running workflow to abort
 *   list       — list the user's own transfers (paginated)
 *   adminList  — admin: list all transfers
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure, adminProcedure } from "../_core/trpc";
import { getDb } from "../db";
import { crossBorderLedgerEntries } from "../../drizzle/schema";
import { eq, desc, and } from "drizzle-orm";
import { writeAuditLog } from "../audit";
import { notifyOwner } from "../_core/notification";
import {
  triggerTemporalWorkflow,
  signalTemporalWorkflow,
  queryTemporalWorkflow,
} from "../temporal/temporalClient";
import {
  CROSS_BORDER_FX_WORKFLOW,
  type CrossBorderFxInput,
} from "../temporal/workflows";
import { publishFluvioEvent, FLUVIO_TOPICS } from "../fluvio/fluvioClient";

// ── Input schemas ─────────────────────────────────────────────────────────────

const InitiateInput = z.object({
  receiverFsp: z.string().min(1),
  receiverAccount: z.string().min(1),
  amount: z.number().positive(),
  sendCurrency: z.string().length(3),
  receiveCurrency: z.string().length(3),
  note: z.string().max(256).optional(),
  idempotencyKey: z.string().min(8),
});

const StatusInput = z.object({
  workflowId: z.string().min(1),
});

const CancelInput = z.object({
  workflowId: z.string().min(1),
  reason: z.string().max(256).optional(),
});

const ListInput = z.object({
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(20),
});

// ── Router ────────────────────────────────────────────────────────────────────

export const crossBorderFxRouter = router({
  /**
   * Initiate a cross-border FX transfer.
   * Creates a DB record and starts the CrossBorderFxWorkflow Temporal workflow.
   */
  initiate: protectedProcedure.input(InitiateInput).mutation(async ({ ctx, input }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

    const transferId = `xbfx-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
    const workflowId = `xborder-${transferId}`;

    // Persist the transfer record in crossBorderLedgerEntries
    await db.insert(crossBorderLedgerEntries).values({
      transferId,
      userId: ctx.user.id,
      sendAmount: String(input.amount),
      sendCurrency: input.sendCurrency,
      receiveCurrency: input.receiveCurrency,
      status: "INITIATED",
    });

    // Build workflow input
    const wfInput: CrossBorderFxInput = {
      transferId,
      senderUserId: ctx.user.id,
      receiverFsp: input.receiverFsp,
      receiverAccount: input.receiverAccount,
      amount: input.amount,
      sendCurrency: input.sendCurrency,
      receiveCurrency: input.receiveCurrency,
      note: input.note,
      idempotencyKey: input.idempotencyKey,
    };

    // Start the Temporal workflow (best-effort; DB record is the source of truth)
    await triggerTemporalWorkflow(
      CROSS_BORDER_FX_WORKFLOW.name,
      wfInput,
      workflowId
    );

    // Emit Fluvio event (use PAYMENT_RECEIVED as closest available topic)
    await publishFluvioEvent(FLUVIO_TOPICS.PAYMENT_RECEIVED, {
      transferId,
      userId: ctx.user.id,
      amount: input.amount,
      sendCurrency: input.sendCurrency,
      receiveCurrency: input.receiveCurrency,
    });

    await writeAuditLog({
      userId: ctx.user.id,
      action: "crossBorderFx.initiate",
      details: { transferId, workflowId, amount: input.amount, sendCurrency: input.sendCurrency, receiveCurrency: input.receiveCurrency },
    });

    return { transferId, workflowId, status: "INITIATED" as const };
  }),

  /**
   * Query the status of a cross-border FX workflow.
   */
  getStatus: protectedProcedure.input(StatusInput).query(async ({ ctx, input }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

    // Fetch DB record
    const rows = await db
      .select()
      .from(crossBorderLedgerEntries)
      .where(
        and(
          eq(crossBorderLedgerEntries.transferId, input.workflowId.replace("xborder-", "")),
          eq(crossBorderLedgerEntries.userId, ctx.user.id)
        )
      )
      .limit(1);

    const record = rows[0];
    if (!record) throw new TRPCError({ code: "NOT_FOUND", message: "Transfer not found" });

    // Try to get live workflow status from Temporal
    const temporalStatus = await queryTemporalWorkflow<{ phase: string; status: string }>(
      input.workflowId,
      "getStatus"
    );

    return {
      transferId: record.transferId,
      workflowId: input.workflowId,
      dbStatus: record.status,
      temporalPhase: temporalStatus?.phase ?? null,
      temporalStatus: temporalStatus?.status ?? null,
      sendAmount: record.sendAmount,
      sendCurrency: record.sendCurrency,
      receiveCurrency: record.receiveCurrency,
      receiveAmount: record.receiveAmount,
      fxRate: record.fxRate,
      createdAt: record.createdAt,
      settledAt: record.settledAt,
    };
  }),

  /**
   * Cancel a running cross-border FX workflow.
   */
  cancel: protectedProcedure.input(CancelInput).mutation(async ({ ctx, input }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

    const transferId = input.workflowId.replace("xborder-", "");
    const rows = await db
      .select()
      .from(crossBorderLedgerEntries)
      .where(
        and(
          eq(crossBorderLedgerEntries.transferId, transferId),
          eq(crossBorderLedgerEntries.userId, ctx.user.id)
        )
      )
      .limit(1);

    const record = rows[0];
    if (!record) throw new TRPCError({ code: "NOT_FOUND", message: "Transfer not found" });
    if (record.status === "COMPLETED" || record.status === "CANCELLED") {
      throw new TRPCError({ code: "BAD_REQUEST", message: `Transfer is already ${record.status}` });
    }

    // Signal the Temporal workflow to abort
    await signalTemporalWorkflow(input.workflowId, "cancel", { reason: input.reason ?? "User requested cancellation" });

    // Update DB status
    await db
      .update(crossBorderLedgerEntries)
      .set({ status: "CANCELLED" })
      .where(eq(crossBorderLedgerEntries.transferId, transferId));

    await writeAuditLog({
      userId: ctx.user.id,
      action: "crossBorderFx.cancel",
      details: { workflowId: input.workflowId, reason: input.reason },
    });

    return { success: true, workflowId: input.workflowId };
  }),

  /**
   * List the current user's cross-border FX transfers (paginated).
   */
  list: protectedProcedure.input(ListInput).query(async ({ ctx, input }) => {
    const db = await getDb();
    if (!db) return { transfers: [], total: 0 };

    const rows = await db
      .select()
      .from(crossBorderLedgerEntries)
      .where(eq(crossBorderLedgerEntries.userId, ctx.user.id))
      .orderBy(desc(crossBorderLedgerEntries.createdAt))
      .limit(input.pageSize)
      .offset((input.page - 1) * input.pageSize);

    return { transfers: rows, page: input.page, pageSize: input.pageSize };
  }),

  /**
   * Admin: list all cross-border FX transfers.
   */
  adminList: adminProcedure.input(ListInput).query(async ({ input }) => {
    const db = await getDb();
    if (!db) return { transfers: [], total: 0 };

    const rows = await db
      .select()
      .from(crossBorderLedgerEntries)
      .orderBy(desc(crossBorderLedgerEntries.createdAt))
      .limit(input.pageSize)
      .offset((input.page - 1) * input.pageSize);

    return { transfers: rows, page: input.page, pageSize: input.pageSize };
  }),

  /**
   * Admin: notify owner of a failed transfer.
   */
  adminNotifyFailure: adminProcedure
    .input(z.object({ workflowId: z.string(), reason: z.string() }))
    .mutation(async ({ input }) => {
      await notifyOwner({
        title: "Cross-Border FX Transfer Failed",
        content: `Workflow ${input.workflowId} failed: ${input.reason}`,
      });
      return { notified: true };
    }),
});
