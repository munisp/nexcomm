import { z } from "zod";
import { eq, and, gte, lte, desc, sql } from "drizzle-orm";
import { getDb } from "../db";
import { protectedProcedure, adminProcedure, router } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import {
import { writeAuditLog } from "../audit";
  positions,
  orders,
  futuresPositions,
  optionsPositions,
  clearingAccounts,
  portfolioEquitySnapshots,
  users,
  type FuturesPosition,
  type OptionsPosition,
  type ClearingAccount,
  type PortfolioEquitySnapshot,
} from "../../drizzle/schema";

// ─── helpers ────────────────────────────────────────────────────────────────

function toNum(v: unknown): number {
  return parseFloat(String(v ?? "0")) || 0;
}

async function computePortfolioSummary(userId: number) {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

  type SpotPosition = typeof positions.$inferSelect;

  const spotPositions = await db.select().from(positions).where(eq(positions.userId, userId));
  const spotRealizedPnl = spotPositions.reduce((acc: number, p: SpotPosition) => acc + toNum(p.realizedPnl), 0);

  const openFutures = await db
    .select()
    .from(futuresPositions)
    .where(and(eq(futuresPositions.userId, userId), eq(futuresPositions.status, "OPEN")));

  const futuresUnrealizedPnl = openFutures.reduce((acc: number, p: FuturesPosition) => acc + toNum(p.unrealizedPnl), 0);
  const futuresRealizedPnl = openFutures.reduce((acc: number, p: FuturesPosition) => acc + toNum(p.realizedPnl), 0);

  const openOptions = await db
    .select()
    .from(optionsPositions)
    .where(and(eq(optionsPositions.userId, userId), eq(optionsPositions.status, "OPEN")));

  const optionsTotalCost = openOptions.reduce((acc: number, p: OptionsPosition) => acc + toNum(p.totalCost), 0);

  const [optionsSettledRow] = await db
    .select({ total: sql<string>`COALESCE(SUM(settlement_pnl), 0)` })
    .from(optionsPositions)
    .where(and(eq(optionsPositions.userId, userId), sql`settlement_pnl IS NOT NULL`));
  const optionsPnl = toNum(optionsSettledRow?.total);

  const clearingAccount = await db
    .select()
    .from(clearingAccounts)
    .where(eq(clearingAccounts.userId, userId))
    .limit(1);
  const cashBalance = clearingAccount.length > 0 ? toNum((clearingAccount[0] as ClearingAccount).cashBalance) : 0;

  const totalEquity = cashBalance + spotRealizedPnl + futuresUnrealizedPnl + futuresRealizedPnl + optionsPnl;

  return {
    spotRealizedPnl,
    spotUnrealizedPnl: 0,
    futuresUnrealizedPnl,
    futuresRealizedPnl,
    optionsTotalCost,
    optionsPnl,
    cashBalance,
    totalEquity,
    openFuturesCount: openFutures.length,
    openOptionsCount: openOptions.length,
    spotPositionsCount: spotPositions.filter((p: SpotPosition) => toNum(p.quantity) > 0).length,
  };
}

// ─── router ─────────────────────────────────────────────────────────────────

export const portfolioRouter = router({
  // ── getPortfolioSummary ────────────────────────────────────────────────────
  getPortfolioSummary: protectedProcedure.query(async ({ ctx }) => {
    return computePortfolioSummary(ctx.user.id);
  }),

  // ── getEquityCurve ─────────────────────────────────────────────────────────
  getEquityCurve: protectedProcedure
    .input(z.object({ days: z.number().min(7).max(365).default(30) }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const since = new Date(Date.now() - input.days * 24 * 60 * 60 * 1000);
      const snapshots = await db
        .select()
        .from(portfolioEquitySnapshots)
        .where(
          and(
            eq(portfolioEquitySnapshots.userId, ctx.user.id),
            gte(portfolioEquitySnapshots.snapshotDate, since),
          )
        )
        .orderBy(portfolioEquitySnapshots.snapshotDate);

      return snapshots.map((s: PortfolioEquitySnapshot) => ({
        date: s.snapshotDate,
        totalEquity: toNum(s.totalEquity),
        spotPnl: toNum(s.spotPnl),
        futuresPnl: toNum(s.futuresPnl),
        optionsPnl: toNum(s.optionsPnl),
        cashBalance: toNum(s.cashBalance),
      }));
    }),

  // ── recordEquitySnapshot ──────────────────────────────────────────────────
  recordEquitySnapshot: protectedProcedure.mutation(async ({ ctx }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

    const summary = await computePortfolioSummary(ctx.user.id);
    const [snap] = await db
      .insert(portfolioEquitySnapshots)
      .values({
        userId: ctx.user.id,
        snapshotDate: new Date(),
        spotPnl: String(summary.spotRealizedPnl),
        futuresPnl: String(summary.futuresUnrealizedPnl + summary.futuresRealizedPnl),
        optionsPnl: String(summary.optionsPnl),
        cashBalance: String(summary.cashBalance),
        totalEquity: String(summary.totalEquity),
      })
      .returning();
    return snap;
  }),

  // ── generateStatement ─────────────────────────────────────────────────────
  // Supports { format: "CSV"|"JSON", days: number } input
  // Returns { contentType, data, rowCount, fromDate, toDate }
  generateStatement: protectedProcedure
    .input(z.object({
      format: z.enum(["CSV", "JSON"]).default("CSV"),
      days: z.number().min(1).max(365).default(30),
      // Legacy support: also accept fromDate/toDate strings
      fromDate: z.string().optional(),
      toDate: z.string().optional(),
    }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      let from: Date;
      let to: Date;

      if (input.fromDate && input.toDate) {
        from = new Date(input.fromDate);
        to = new Date(input.toDate);
        if (isNaN(from.getTime()) || isNaN(to.getTime())) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid date range" });
        }
      } else {
        to = new Date();
        from = new Date(Date.now() - input.days * 24 * 60 * 60 * 1000);
      }

      const userOrders = await db
        .select()
        .from(orders)
        .where(and(eq(orders.userId, ctx.user.id), gte(orders.createdAt, from), lte(orders.createdAt, to)))
        .orderBy(desc(orders.createdAt));

      const futuresTrades = await db
        .select()
        .from(futuresPositions)
        .where(and(eq(futuresPositions.userId, ctx.user.id), gte(futuresPositions.openedAt, from), lte(futuresPositions.openedAt, to)))
        .orderBy(desc(futuresPositions.openedAt));

      const optionsTrades = await db
        .select()
        .from(optionsPositions)
        .where(and(eq(optionsPositions.userId, ctx.user.id), gte(optionsPositions.openedAt, from), lte(optionsPositions.openedAt, to)))
        .orderBy(desc(optionsPositions.openedAt));

      type OrderRow = typeof orders.$inferSelect;
      type FuturesRow = typeof futuresPositions.$inferSelect;
      type OptionsRow = typeof optionsPositions.$inferSelect;

      if (input.format === "JSON") {
        const records: object[] = [];
        for (const o of userOrders as OrderRow[]) {
          records.push({ date: o.createdAt, type: "SPOT", symbol: o.symbol, side: o.side, quantity: o.quantity, price: o.avgFillPrice ?? o.price, status: o.status });
        }
        for (const f of futuresTrades as FuturesRow[]) {
          records.push({ date: f.openedAt, type: "FUTURES", contractId: f.contractId, side: f.side, quantity: f.quantity, entryPrice: f.entryPrice, realizedPnl: f.realizedPnl, status: f.status });
        }
        for (const op of optionsTrades as OptionsRow[]) {
          records.push({ date: op.openedAt, type: "OPTIONS", contractId: op.contractId, optionType: op.optionType, quantity: op.quantity, premiumPaid: op.premiumPaid, settlementPnl: op.settlementPnl, status: op.status });
        }
        return {
          contentType: "application/json",
          data: JSON.stringify(records, null, 2),
          rowCount: records.length,
          fromDate: from.toISOString(),
          toDate: to.toISOString(),
        };
      }

      // CSV format
      const rows: string[] = ["Date,Type,Symbol/Contract,Side,Quantity,Price,Amount,Status,P&L"];

      for (const o of userOrders as OrderRow[]) {
        const amount = toNum(o.filledQty) * toNum(o.avgFillPrice ?? o.price ?? "0");
        rows.push([o.createdAt.toISOString(), "SPOT", o.symbol, o.side, o.quantity, o.avgFillPrice ?? o.price ?? "", amount.toFixed(2), o.status, ""].join(","));
      }

      for (const f of futuresTrades as FuturesRow[]) {
        rows.push([f.openedAt.toISOString(), "FUTURES", `Contract#${f.contractId}`, f.side, f.quantity, f.entryPrice, (toNum(f.quantity) * toNum(f.entryPrice)).toFixed(2), f.status, toNum(f.realizedPnl).toFixed(2)].join(","));
      }

      for (const op of optionsTrades as OptionsRow[]) {
        rows.push([op.openedAt.toISOString(), "OPTIONS", `Contract#${op.contractId}`, op.optionType, op.quantity, op.premiumPaid, toNum(op.totalCost).toFixed(2), op.status, toNum(op.settlementPnl ?? "0").toFixed(2)].join(","));
      }

      return {
        contentType: "text/csv",
        data: rows.join("\n"),
        rowCount: rows.length - 1,
        fromDate: from.toISOString(),
        toDate: to.toISOString(),
      };
    }),

  // ── adminGetPortfolioOverview ──────────────────────────────────────────────
  // Returns { totalUsers, totalEquity, accounts, ... }
  adminGetPortfolioOverview: adminProcedure
    .input(z.object({ limit: z.number().min(1).max(100).default(20) }).optional())
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const limit = input?.limit ?? 20;

      const accounts = await db
        .select()
        .from(clearingAccounts)
        .orderBy(desc(clearingAccounts.cashBalance))
        .limit(limit);

      const overview = (accounts as ClearingAccount[]).map((a) => ({
        userId: a.userId,
        accountRef: a.accountRef,
        cashBalance: toNum(a.cashBalance),
        portfolioValue: toNum(a.portfolioValue),
        totalEquity: toNum(a.cashBalance) + toNum(a.portfolioValue),
        initialMarginPct: toNum(a.initialMarginPct),
        maintenanceMarginPct: toNum(a.maintenanceMarginPct),
      }));

      const totalEquity = overview.reduce((acc: number, o: { totalEquity: number }) => acc + o.totalEquity, 0);

      // Count total users in the system
      const [userCountRow] = await db
        .select({ count: sql<number>`COUNT(*)::int` })
        .from(users);
      const totalUsers = Number(userCountRow?.count ?? 0);

      return {
        accounts: overview,
        totalAccounts: overview.length,
        totalUsers,
        totalEquity,
        // Legacy aliases
        totalEquitySum: totalEquity,
        topGainer: overview.length > 0 ? overview[0] : null,
        topLoser: overview.length > 0 ? overview[overview.length - 1] : null,
      };
    }),

  // ── adminRecordEquitySnapshotForUser ──────────────────────────────────────
  adminRecordEquitySnapshotForUser: adminProcedure
    .input(z.object({ userId: z.number() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const summary = await computePortfolioSummary(input.userId);
      const [snap] = await db
        .insert(portfolioEquitySnapshots)
        .values({
          userId: input.userId,
          snapshotDate: new Date(),
          spotPnl: String(summary.spotRealizedPnl),
          futuresPnl: String(summary.futuresUnrealizedPnl + summary.futuresRealizedPnl),
          optionsPnl: String(summary.optionsPnl),
          cashBalance: String(summary.cashBalance),
          totalEquity: String(summary.totalEquity),
        })
        .returning();
      return snap;
    }),

  // ── getPortfolioStats ──────────────────────────────────────────────────────
  // Returns { totalTrades, winRate, bestDay, worstDay, ... }
  getPortfolioStats: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

    const summary = await computePortfolioSummary(ctx.user.id);

    const [tradeCount] = await db
      .select({ count: sql<number>`COUNT(*)` })
      .from(orders)
      .where(and(eq(orders.userId, ctx.user.id), eq(orders.status, "FILLED")));

    const [winningFutures] = await db
      .select({ count: sql<number>`COUNT(*)` })
      .from(futuresPositions)
      .where(and(eq(futuresPositions.userId, ctx.user.id), eq(futuresPositions.status, "CLOSED"), sql`realized_pnl > 0`));

    const [totalFutures] = await db
      .select({ count: sql<number>`COUNT(*)` })
      .from(futuresPositions)
      .where(and(eq(futuresPositions.userId, ctx.user.id), eq(futuresPositions.status, "CLOSED")));

    const winRate = Number(totalFutures.count) > 0
      ? ((Number(winningFutures.count) / Number(totalFutures.count)) * 100).toFixed(1)
      : "0.0";

    // Best and worst day from equity snapshots
    const snapshots = await db
      .select()
      .from(portfolioEquitySnapshots)
      .where(eq(portfolioEquitySnapshots.userId, ctx.user.id))
      .orderBy(portfolioEquitySnapshots.snapshotDate);

    let bestDay: { date: Date; pnl: number } | null = null;
    let worstDay: { date: Date; pnl: number } | null = null;

    if (snapshots.length >= 2) {
      for (let i = 1; i < snapshots.length; i++) {
        const prev = toNum((snapshots[i - 1] as PortfolioEquitySnapshot).totalEquity);
        const curr = toNum((snapshots[i] as PortfolioEquitySnapshot).totalEquity);
        const dailyPnl = curr - prev;
        const date = (snapshots[i] as PortfolioEquitySnapshot).snapshotDate;
        if (!bestDay || dailyPnl > bestDay.pnl) bestDay = { date, pnl: dailyPnl };
        if (!worstDay || dailyPnl < worstDay.pnl) worstDay = { date, pnl: dailyPnl };
      }
    }

    const totalTrades = Number(tradeCount.count);

    return {
      ...summary,
      totalTrades,
      totalFilledOrders: totalTrades,
      closedFuturesPositions: Number(totalFutures.count),
      winningFuturesPositions: Number(winningFutures.count),
      winRate,
      bestDay: bestDay ?? { date: null, pnl: 0 },
      worstDay: worstDay ?? { date: null, pnl: 0 },
    };
  }),
});
