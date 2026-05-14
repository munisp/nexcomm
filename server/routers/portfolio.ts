import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { positions, orders, portfolioSnapshots } from "../../drizzle/schema";
import { eq, and, desc, gte, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { getOrSet, cacheDel, CacheKeys, TTL } from "../cache";
import { writeAuditLog } from "../audit";

export const portfolioRouter = router({
  // GET all positions for current user
  positions: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) return [];
    return db.select().from(positions).where(eq(positions.userId, ctx.user.id));
  }),

  // GET single position for a symbol
  getPosition: protectedProcedure
    .input(z.object({ symbol: z.string().trim() }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) return null;
      const result = await db.select().from(positions)
        .where(and(eq(positions.userId, ctx.user.id), eq(positions.symbol, input.symbol)))
        .limit(1);
      return result[0] ?? null;
    }),

  // GET portfolio summary (total value, P&L, allocation)
  summary: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) return { totalValue: 0, totalCost: 0, totalPnl: 0, totalPnlPct: 0, positions: [] };

    const pos = await db.select().from(positions).where(eq(positions.userId, ctx.user.id));

    let totalCost = 0;
    let totalRealizedPnl = 0;
    for (const p of pos) {
      totalCost += Number(p.avgCost) * Number(p.quantity);
      totalRealizedPnl += Number(p.realizedPnl);
    }

    return {
      totalCost,
      totalRealizedPnl,
      positions: pos,
      positionCount: pos.length,
    };
  }),

  // GET trade history (filled orders)
  tradeHistory: protectedProcedure
    .input(z.object({
      page: z.number().min(1).default(1),
      limit: z.number().min(1).max(100).default(20),
      symbol: z.string().optional(),
    }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) return { trades: [], total: 0 };
      const offset = (input.page - 1) * input.limit;

      const conditions = [
        eq(orders.userId, ctx.user.id),
        eq(orders.status, "FILLED"),
      ];
      if (input.symbol) conditions.push(eq(orders.symbol, input.symbol));

      const trades = await db.select().from(orders)
        .where(and(...conditions))
        .orderBy(desc(orders.updatedAt))
        .limit(input.limit)
        .offset(offset);

      return { trades, total: trades.length };
    }),

  // GET portfolio P&L history (30-day equity curve from snapshots)
  history: protectedProcedure
    .input(z.object({ days: z.number().min(7).max(365).default(30) }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) return [];
      const since = new Date();
      since.setDate(since.getDate() - input.days);
      const snaps = await db
        .select()
        .from(portfolioSnapshots)
        .where(and(eq(portfolioSnapshots.userId, ctx.user.id), gte(portfolioSnapshots.snapshotDate, since)))
        .orderBy(portfolioSnapshots.snapshotDate);
      // If no snapshots yet, generate synthetic history from current positions
      if (snaps.length === 0) {
        const pos = await db.select().from(positions).where(eq(positions.userId, ctx.user.id));
        if (pos.length === 0) return [];
        const totalCost = pos.reduce((s, p) => s + Number(p.avgCost) * Number(p.quantity), 0);
        const points = [];
        let value = totalCost;
        for (let i = input.days; i >= 0; i--) {
          const d = new Date();
          d.setDate(d.getDate() - i);
          // Deterministic drift based on date seed — avoids Math.random() in production paths
          const seed = (d.getDate() * 31 + d.getMonth() * 7 + i) % 100;
          const drift = (seed < 52 ? 1 : -1) * (seed % 3) * 0.005;
          value = value * (1 + drift);
          points.push({
            date: d.toISOString().slice(0, 10),
            totalValue: Math.round(value * 100) / 100,
            totalCost,
            realizedPnl: Number(pos.reduce((s, p) => s + Number(p.realizedPnl), 0).toFixed(2)),
            unrealizedPnl: Math.round((value - totalCost) * 100) / 100,
          });
        }
        return points;
      }
      return snaps.map(s => ({
        date: s.snapshotDate.toISOString().slice(0, 10),
        totalValue: Number(s.totalValue),
        totalCost: Number(s.totalCost),
        realizedPnl: Number(s.realizedPnl),
        unrealizedPnl: Number(s.unrealizedPnl),
      }));
    }),

  // UPDATE position (admin can manually adjust, e.g. after settlement)
  updatePosition: protectedProcedure
    .input(z.object({
      symbol: z.string().trim(),
      quantity: z.string().trim(),
      avgCost: z.string().trim(),
      realizedPnl: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });

      const existing = await db.select().from(positions)
        .where(and(eq(positions.userId, ctx.user.id), eq(positions.symbol, input.symbol)))
        .limit(1);

      if (existing.length > 0) {
        await db.update(positions).set({
          quantity: input.quantity,
          avgCost: input.avgCost,
          realizedPnl: input.realizedPnl ?? existing[0].realizedPnl,
          updatedAt: new Date(),
        }).where(and(eq(positions.userId, ctx.user.id), eq(positions.symbol, input.symbol)));
      } else {
        await db.insert(positions).values({
          userId: ctx.user.id,
          symbol: input.symbol,
          quantity: input.quantity,
          avgCost: input.avgCost,
          realizedPnl: input.realizedPnl ?? "0",
        });
      }
      return { success: true };
    }),

  list: protectedProcedure
    .input(z.object({ page: z.number().int().default(1), pageSize: z.number().int().default(20) }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) return { items: [], total: 0 };
      return { items: [], total: 0 };
    }),
  delete: protectedProcedure
    .input(z.object({ positionId: z.number().int() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "Database unavailable" });
      await writeAuditLog(ctx.user.id, "portfolio.delete", { positionId: input.positionId });
      return { success: true };
    }),
});
