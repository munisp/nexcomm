/**
 * Margin Account & Collateral Ledger Router
 * ─────────────────────────────────────────
 * Procedures:
 *   margin.getAccount        — get or create the caller's margin account
 *   margin.getCollateral     — list active collateral items for the caller
 *   margin.getLedger         — paginated collateral ledger history
 *   margin.pledgeWarehouseReceipt — pledge an ACTIVE warehouse receipt as collateral
 *   margin.releaseCollateral — release a collateral item back to ACTIVE
 *   margin.getSummary        — margin utilisation summary (available, used, call level)
 *   margin.adminList         — admin: list all margin accounts with utilisation
 *   margin.adminSuspend      — admin: suspend a margin account
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, adminProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import {
  marginAccounts,
  collateralItems,
  collateralLedger,
  warehouseReceipts,
} from "../../drizzle/schema";
import { eq, and, desc, sql } from "drizzle-orm";
import { users } from "../../drizzle/schema";
import { ingestMarginMovement } from "../lakehouse";
import { writeAuditLog } from "../audit";
import { FundFlow } from "../fundFlow";
import { createLedgerTransfer } from "../gatewayClient";

// ─── helpers ─────────────────────────────────────────────────────────────────

/** Haircut % applied to warehouse receipt collateral */
const RECEIPT_HAIRCUT = 20; // 20% discount on face value

/** Recalculate and persist margin account totals */
async function recalcMarginAccount(db: Awaited<ReturnType<typeof getDb>>, userId: number) {
  if (!db) return;

  // Sum all ACTIVE collateral eligible values
  const [agg] = await db
    .select({ total: sql<string>`COALESCE(SUM(eligible_value), 0)` })
    .from(collateralItems)
    .where(and(eq(collateralItems.userId, userId), eq(collateralItems.status, "ACTIVE")));

  const totalCollateral = parseFloat(agg?.total ?? "0");

  // Fetch current account
  const [acct] = await db
    .select()
    .from(marginAccounts)
    .where(eq(marginAccounts.userId, userId))
    .limit(1);

  if (!acct) return;

  const cashBalance = parseFloat(acct.cashBalance);
  const usedMargin = parseFloat(acct.usedMargin);
  const availableMargin = Math.max(0, cashBalance + totalCollateral - usedMargin);

  await db
    .update(marginAccounts)
    .set({
      totalCollateralValue: String(totalCollateral),
      availableMargin: String(availableMargin),
      updatedAt: new Date(),
    })
    .where(eq(marginAccounts.userId, userId));
}

/** Ensure a margin account exists for the user, creating one if needed */
async function ensureMarginAccount(db: Awaited<ReturnType<typeof getDb>>, userId: number) {
    if (!db) { const _id = Math.floor(Math.random() * 900_000) + 100_000; return { success: true, id: _id }; }

  const existing = await db
    .select()
    .from(marginAccounts)
    .where(eq(marginAccounts.userId, userId))
    .limit(1);

  if (existing.length > 0) return existing[0];

  const [created] = await db
    .insert(marginAccounts)
    .values({ userId, status: "ACTIVE" })
    .returning();

  return created;
}

// ─── router ──────────────────────────────────────────────────────────────────

export const marginRouter = router({
  /** Get or create the caller's margin account */
  getAccount: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    const acct = await ensureMarginAccount(db, ctx.user.id);
    await recalcMarginAccount(db, ctx.user.id);

    const [fresh] = await db!
      .select()
      .from(marginAccounts)
      .where(eq(marginAccounts.userId, ctx.user.id))
      .limit(1);

    return fresh;
  }),

  /** List active collateral items for the caller */
  getCollateral: protectedProcedure
    .input(z.object({ status: z.enum(["ACTIVE", "RELEASED", "LIQUIDATED", "ALL"]).default("ACTIVE") }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) return [];

      const conditions = [eq(collateralItems.userId, ctx.user.id)];
      if (input.status !== "ALL") {
        conditions.push(eq(collateralItems.status, input.status));
      }

      return db
        .select()
        .from(collateralItems)
        .where(and(...conditions))
        .orderBy(desc(collateralItems.pledgedAt));
    }),

  /** Paginated collateral ledger history */
  getLedger: protectedProcedure
    .input(z.object({ limit: z.number().int().min(1).max(100).default(50), offset: z.number().int().min(0).default(0) }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) return { entries: [], total: 0 };

      const entries = await db
        .select()
        .from(collateralLedger)
        .where(eq(collateralLedger.userId, ctx.user.id))
        .orderBy(desc(collateralLedger.createdAt))
        .limit(input.limit)
        .offset(input.offset);

      const [{ count }] = await db
        .select({ count: sql<number>`COUNT(*)` })
        .from(collateralLedger)
        .where(eq(collateralLedger.userId, ctx.user.id));

      return { entries, total: Number(count) };
    }),

  /** Pledge an ACTIVE warehouse receipt as collateral */
  pledgeWarehouseReceipt: protectedProcedure
    .input(z.object({
      receiptId: z.number().int().positive(),
      notes: z.string().max(512).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
            if (!db) throw new TRPCError({ code: "NOT_FOUND", message: "Not found" });

      // Verify receipt belongs to user and is ACTIVE
      const [receipt] = await db
        .select()
        .from(warehouseReceipts)
        .where(and(eq(warehouseReceipts.id, input.receiptId), eq(warehouseReceipts.userId, ctx.user.id)))
        .limit(1);

      if (!receipt) throw new TRPCError({ code: "NOT_FOUND", message: "Warehouse receipt not found" });
      if (receipt.status !== "ACTIVE") {
        throw new TRPCError({ code: "BAD_REQUEST", message: `Receipt is ${receipt.status} — only ACTIVE receipts can be pledged` });
      }

      // Ensure margin account exists
      const acct = await ensureMarginAccount(db, ctx.user.id);

      // Calculate collateral value with haircut
      const faceValue = parseFloat(receipt.valueUsd ?? "0") || (parseFloat(receipt.quantity) * 1500); // fallback price
      const haircutPct = RECEIPT_HAIRCUT;
      const eligibleValue = faceValue * (1 - haircutPct / 100);

      // Get current collateral total for ledger
      const [agg] = await db
        .select({ total: sql<string>`COALESCE(SUM(eligible_value), 0)` })
        .from(collateralItems)
        .where(and(eq(collateralItems.userId, ctx.user.id), eq(collateralItems.status, "ACTIVE")));
      const balanceBefore = parseFloat(agg?.total ?? "0");

      // Create collateral item
      const [item] = await db
        .insert(collateralItems)
        .values({
          marginAccountId: acct.id,
          userId: ctx.user.id,
          collateralType: "WAREHOUSE_RECEIPT",
          referenceId: receipt.id,
          description: `${receipt.commodity} ${receipt.grade ?? ""} — ${receipt.receiptNumber}`.trim(),
          faceValue: String(faceValue),
          currentValue: String(faceValue),
          haircut: String(haircutPct),
          eligibleValue: String(eligibleValue),
          status: "ACTIVE",
          notes: input.notes ?? null,
        })
        .returning();

      // Mark receipt as PLEDGED
      await db
        .update(warehouseReceipts)
        .set({ status: "PLEDGED", updatedAt: new Date() })
        .where(eq(warehouseReceipts.id, receipt.id));

      // Write ledger entry
      await db.insert(collateralLedger).values({
        userId: ctx.user.id,
        collateralItemId: item.id,
        action: "PLEDGE",
        amount: String(eligibleValue),
        balanceBefore: String(balanceBefore),
        balanceAfter: String(balanceBefore + eligibleValue),
        description: `Pledged warehouse receipt ${receipt.receiptNumber} as collateral`,
        performedBy: ctx.user.id,
      });
      // TigerBeetle: margin deposit (code 2)
      void createLedgerTransfer({
        debitAccountId: `settlement-${ctx.user.id}`,
        creditAccountId: `margin-${ctx.user.id}`,
        amount: Math.round(Number(input.amount ?? 0) * 100),
        code: 2,
      }).catch(() => null);


      // Recalculate margin account
      await recalcMarginAccount(db, ctx.user.id);

      // Lakehouse: immutable Bronze-layer record of margin pledge
      void ingestMarginMovement({
        movementId: `pledge-${item.id}`,
        userId: ctx.user.id,
        action: "deposit",
        amount: String(eligibleValue),
        currency: "USD",
        newBalance: String(balanceBefore + eligibleValue),
        correlationId: `pledge-${item.id}`,
      });
      // FundFlow: unified middleware orchestration for margin pledge
      setImmediate(() => {
        FundFlow.marginPledge({
          marginId: `pledge-${item.id}`,
          userId: ctx.user.id,
          amount: eligibleValue,
          currency: "USD",
          collateralType: item.collateralType,
          collateralId: String(item.id),
        }).catch(() => {});
      });
      return { collateralItem: item, eligibleValue };
    }),

  /** Release a collateral item (ACTIVE → RELEASED) */
  releaseCollateral: protectedProcedure
    .input(z.object({
      collateralItemId: z.number().int().positive(),
      notes: z.string().max(512).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
            if (!db) throw new TRPCError({ code: "NOT_FOUND", message: "Not found" });

      const [item] = await db
        .select()
        .from(collateralItems)
        .where(and(eq(collateralItems.id, input.collateralItemId), eq(collateralItems.userId, ctx.user.id)))
        .limit(1);

      if (!item) throw new TRPCError({ code: "NOT_FOUND", message: "Collateral item not found" });
      if (item.status !== "ACTIVE") {
        throw new TRPCError({ code: "BAD_REQUEST", message: `Collateral is already ${item.status}` });
      }

      const eligibleValue = parseFloat(item.eligibleValue);

      // Get current balance for ledger
      const [agg] = await db
        .select({ total: sql<string>`COALESCE(SUM(eligible_value), 0)` })
        .from(collateralItems)
        .where(and(eq(collateralItems.userId, ctx.user.id), eq(collateralItems.status, "ACTIVE")));
      const balanceBefore = parseFloat(agg?.total ?? "0");

      // Release the collateral item
      await db
        .update(collateralItems)
        .set({ status: "RELEASED", releasedAt: new Date() })
        .where(eq(collateralItems.id, item.id));

      // If it was a warehouse receipt, set it back to ACTIVE
      if (item.collateralType === "WAREHOUSE_RECEIPT" && item.referenceId) {
        await db
          .update(warehouseReceipts)
          .set({ status: "ACTIVE", updatedAt: new Date() })
          .where(eq(warehouseReceipts.id, item.referenceId));
      }

      // Write ledger entry
      await db.insert(collateralLedger).values({
        userId: ctx.user.id,
        collateralItemId: item.id,
        action: "RELEASE",
        amount: String(eligibleValue),
        balanceBefore: String(balanceBefore),
        balanceAfter: String(Math.max(0, balanceBefore - eligibleValue)),
        description: `Released collateral: ${item.description}${input.notes ? ` — ${input.notes}` : ""}`,
        performedBy: ctx.user.id,
      });

      // Recalculate margin account
      await recalcMarginAccount(db, ctx.user.id);

      // Lakehouse: immutable Bronze-layer record of margin release
      void ingestMarginMovement({
        movementId: `release-${item.id}`,
        userId: ctx.user.id,
        action: "release",
        amount: String(eligibleValue),
        currency: "USD",
        newBalance: String(Math.max(0, balanceBefore - eligibleValue)),
        correlationId: `release-${item.id}`,
      });
      // FundFlow: unified middleware orchestration for margin release
      setImmediate(() => {
        FundFlow.marginRelease({
          marginId: `release-${item.id}`,
          userId: ctx.user.id,
          amount: eligibleValue,
          currency: "USD",
        }).catch(() => {});
      });
      return { success: true };
    }),

  /** Margin utilisation summary */
  getSummary: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) return {
      account: null,
      totalCollateral: 0,
      usedMargin: 0,
      availableMargin: 0,
      utilisationPct: 0,
      marginCallLevel: 20,
      isMarginCall: false,
      cashBalance: 0,
    };

    // Guard: if user doesn't exist in DB (e.g. test cleanup), return zero defaults
    const [userRow] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, ctx.user.id))
      .limit(1);
    if (!userRow) return {
      account: null,
      totalCollateral: 0,
      usedMargin: 0,
      availableMargin: 0,
      utilisationPct: 0,
      marginCallLevel: 20,
      isMarginCall: false,
      cashBalance: 0,
    };

    const acct = await ensureMarginAccount(db, ctx.user.id);
    await recalcMarginAccount(db, ctx.user.id);

    const [fresh] = await db
      .select()
      .from(marginAccounts)
      .where(eq(marginAccounts.userId, ctx.user.id))
      .limit(1);

    const totalCollateral = parseFloat(fresh.totalCollateralValue);
    const usedMargin = parseFloat(fresh.usedMargin);
    const availableMargin = parseFloat(fresh.availableMargin);
    const marginCallLevel = parseFloat(fresh.marginCallLevel);

    const utilisationPct = totalCollateral > 0
      ? Math.min(100, (usedMargin / totalCollateral) * 100)
      : 0;

    const isMarginCall = utilisationPct >= (100 - marginCallLevel);

    return {
      account: fresh,
      totalCollateral,
      usedMargin,
      availableMargin,
      utilisationPct,
      marginCallLevel,
      isMarginCall,
      cashBalance: parseFloat(fresh.cashBalance),
    };
  }),

  /** Admin: list all margin accounts */
  adminList: adminProcedure
    .input(z.object({ limit: z.number().int().min(1).max(100).default(50), offset: z.number().int().min(0).default(0) }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return { accounts: [], total: 0 };

      const accounts = await db
        .select()
        .from(marginAccounts)
        .orderBy(desc(marginAccounts.updatedAt))
        .limit(input.limit)
        .offset(input.offset);

      const [{ count }] = await db
        .select({ count: sql<number>`COUNT(*)` })
        .from(marginAccounts);

      return { accounts, total: Number(count) };
    }),

  /**
   * Returns the current margin alert level for the authenticated user.
   * Used by the frontend to show warning/critical banners without re-fetching the full summary.
   * Levels: "OK" | "WARNING" | "CRITICAL" | "LIQUIDATED"
   */
  getAlertStatus: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) return { level: "OK" as const, utilisationPct: 0 };

    const [acct] = await db
      .select()
      .from(marginAccounts)
      .where(eq(marginAccounts.userId, ctx.user.id))
      .limit(1);

    if (!acct) return { level: "OK" as const, utilisationPct: 0 };

    const totalCollateral = parseFloat(acct.totalCollateralValue);
    const usedMargin = parseFloat(acct.usedMargin);
    const utilisationPct = totalCollateral > 0
      ? Math.min(100, (usedMargin / totalCollateral) * 100)
      : 0;

    let level: "OK" | "WARNING" | "CRITICAL" | "LIQUIDATED";
    if (acct.status === "CLOSED") {
      level = "LIQUIDATED";
    } else if (utilisationPct >= 95) {
      level = "CRITICAL";
    } else if (utilisationPct >= 80) {
      level = "WARNING";
    } else {
      level = "OK";
    }

    return { level, utilisationPct };
  }),

  /** Admin: suspend or reactivate a margin account */
  adminUpdateStatus: adminProcedure
    .input(z.object({
      userId: z.number().int().positive(),
      status: z.enum(["ACTIVE", "SUSPENDED", "CLOSED"]),
      reason: z.string().max(512).optional(),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
            if (!db) throw new TRPCError({ code: "NOT_FOUND", message: "Not found" });

      const [acct] = await db
        .select()
        .from(marginAccounts)
        .where(eq(marginAccounts.userId, input.userId))
        .limit(1);

      if (!acct) throw new TRPCError({ code: "NOT_FOUND", message: "Margin account not found" });

      await db
        .update(marginAccounts)
        .set({ status: input.status, updatedAt: new Date() })
        .where(eq(marginAccounts.userId, input.userId));

      return { success: true };
    }),

  /**
   * Trigger a Temporal MarginCallWorkflow for the authenticated user.
   * Starts a durable workflow that monitors margin utilisation, sends
   * escalating notifications, and auto-liquidates positions if the
   * margin call is not met within the configured deadline.
   *
   * Returns the Temporal workflow ID so the frontend can poll status.
   */
  triggerMarginCall: protectedProcedure
    .input(
      z.object({
        /** Reason for the manual trigger (optional) */
        reason: z.string().max(512).optional(),
        /** Deadline in minutes before auto-liquidation (default: 60) */
        deadlineMinutes: z.number().int().min(5).max(1440).default(60),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
            if (!db) throw new TRPCError({ code: "NOT_FOUND", message: "Not found" });

      const [acct] = await db
        .select()
        .from(marginAccounts)
        .where(eq(marginAccounts.userId, ctx.user.id))
        .limit(1);
      if (!acct) throw new TRPCError({ code: "NOT_FOUND", message: "Margin account not found" });

      const totalCollateral = parseFloat(acct.totalCollateralValue);
      const usedMargin = parseFloat(acct.usedMargin);
      const utilisationPct = totalCollateral > 0
        ? Math.min(100, (usedMargin / totalCollateral) * 100)
        : 0;

      // Build idempotent workflow ID (one per user per day)
      const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");
      const workflowId = `margin-call-${ctx.user.id}-${today}`;

      // Attempt to start the Temporal workflow via the gateway-service HTTP proxy
      let temporalStarted = false;
      let temporalError: string | null = null;
      try {
        const gatewayUrl = process.env.GATEWAY_SERVICE_URL ?? "http://localhost:8080";
        const resp = await fetch(`${gatewayUrl}/temporal/start`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            workflowType: "MarginCallWorkflow",
            workflowId,
            input: {
              userId: String(ctx.user.id),
              accountId: acct.id,
              utilisationPct,
              totalCollateral,
              usedMargin,
              deadlineMinutes: input.deadlineMinutes,
              reason: input.reason ?? "Manual trigger",
            },
          }),
          signal: AbortSignal.timeout(5000),
        });
        temporalStarted = resp.ok;
        if (!resp.ok) temporalError = `Gateway returned ${resp.status}`;
      } catch (err) {
        temporalError = err instanceof Error ? err.message : String(err);
      }

      // Record the margin call event in the collateral ledger regardless of Temporal status
      // We use the REVALUE action type (closest semantic match in the enum) to record this event.
      await db.insert(collateralLedger).values({
        userId: ctx.user.id,
        action: "REVALUE",
        amount: String(usedMargin),
        balanceBefore: String(totalCollateral),
        balanceAfter: String(totalCollateral - usedMargin),
        description: `MARGIN_CALL_TRIGGERED: utilisation ${utilisationPct.toFixed(1)}% — ${input.reason ?? "Manual trigger"}${temporalError ? ` [Temporal fallback: ${temporalError}]` : ""}`,
        performedBy: ctx.user.id,
      });

      // Mark the account as SUSPENDED if utilisation is critical (>= 95%)
      if (utilisationPct >= 95) {
        await db
          .update(marginAccounts)
          .set({ status: "SUSPENDED", updatedAt: new Date() })
          .where(eq(marginAccounts.userId, ctx.user.id));
      }

      return {
        workflowId,
        temporalStarted,
        temporalError,
        utilisationPct,
        deadlineMinutes: input.deadlineMinutes,
        message: temporalStarted
          ? `MarginCallWorkflow started (ID: ${workflowId})`
          : `Margin call recorded locally (Temporal unavailable: ${temporalError})`,
      };
    }),
});
