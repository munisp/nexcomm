import { z } from "zod";
import { protectedProcedure, publicProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { orders, users, warehouseReceipts, depositRequests, kycQueue } from "../../drizzle/schema";
import { eq, desc, sql, and, gte } from "drizzle-orm";

export const analyticsRouter = router({
  // GET exchange-wide summary stats (public)
  summary: publicProcedure.query(async () => {
    const db = await getDb();
    if (!db) return {
      totalUsers: 0, totalOrders: 0, totalVolume: "0",
      totalReceipts: 0, pendingKyc: 0, filledOrders: 0,
    };

    const [userCount] = await db.select({ count: sql<number>`count(*)` }).from(users);
    const [orderCount] = await db.select({ count: sql<number>`count(*)` }).from(orders);
    const [filledCount] = await db.select({ count: sql<number>`count(*)` }).from(orders).where(eq(orders.status, "FILLED"));
    const [receiptCount] = await db.select({ count: sql<number>`count(*)` }).from(warehouseReceipts);
    const [kycCount] = await db.select({ count: sql<number>`count(*)` }).from(kycQueue).where(eq(kycQueue.status, "PENDING"));

    // Volume = sum of filled orders (quantity * price)
    const volumeResult = await db.select({
      total: sql<string>`coalesce(sum(cast(quantity as decimal) * cast(price as decimal)), 0)`,
    }).from(orders).where(eq(orders.status, "FILLED"));

    return {
      totalUsers: Number(userCount?.count ?? 0),
      totalOrders: Number(orderCount?.count ?? 0),
      filledOrders: Number(filledCount?.count ?? 0),
      totalVolume: volumeResult[0]?.total ?? "0",
      totalReceipts: Number(receiptCount?.count ?? 0),
      pendingKyc: Number(kycCount?.count ?? 0),
    };
  }),

  // GET top traded symbols
  topSymbols: publicProcedure
    .input(z.object({ limit: z.number().min(1).max(50).default(10) }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return [];
      const result = await db.select({
        symbol: orders.symbol,
        tradeCount: sql<number>`count(*)`,
        totalVolume: sql<string>`coalesce(sum(cast(quantity as decimal)), 0)`,
      }).from(orders)
        .where(eq(orders.status, "FILLED"))
        .groupBy(orders.symbol)
        .orderBy(desc(sql`count(*)`))
        .limit(input.limit);
      return result;
    }),

  // GET volume by asset class
  volumeByAssetClass: publicProcedure.query(async () => {
    const db = await getDb();
    if (!db) return [];
    return db.select({
      assetClass: orders.assetClass,
      tradeCount: sql<number>`count(*)`,
      totalVolume: sql<string>`coalesce(sum(cast(quantity as decimal)), 0)`,
    }).from(orders)
      .where(eq(orders.status, "FILLED"))
      .groupBy(orders.assetClass)
      .orderBy(desc(sql`count(*)`));
  }),

  // GET recent trades (public feed)
  recentTrades: publicProcedure
    .input(z.object({ limit: z.number().min(1).max(50).default(20) }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return [];
      return db.select({
        id: orders.id,
        symbol: orders.symbol,
        side: orders.side,
        quantity: orders.quantity,
        price: orders.price,
        assetClass: orders.assetClass,
        filledAt: orders.updatedAt,
      }).from(orders)
        .where(eq(orders.status, "FILLED"))
        .orderBy(desc(orders.updatedAt))
        .limit(input.limit);
    }),

  // GET user's personal analytics (protected)
  personal: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) return { totalTrades: 0, totalVolume: "0", winRate: 0, avgTradeSize: "0" };

    const [tradeCount] = await db.select({ count: sql<number>`count(*)` })
      .from(orders).where(and(eq(orders.userId, ctx.user.id), eq(orders.status, "FILLED")));

    const volumeResult = await db.select({
      total: sql<string>`coalesce(sum(cast(quantity as decimal) * cast(price as decimal)), 0)`,
    }).from(orders).where(and(eq(orders.userId, ctx.user.id), eq(orders.status, "FILLED")));

    const count = Number(tradeCount?.count ?? 0);
    const volume = volumeResult[0]?.total ?? "0";

    return {
      totalTrades: count,
      totalVolume: volume,
      avgTradeSize: count > 0 ? String(Number(volume) / count) : "0",
    };
  }),

  // GET admin audit log (admin only)
  auditLog: protectedProcedure
    .input(z.object({ page: z.number().min(1).default(1), limit: z.number().min(1).max(100).default(20) }))
    .query(async ({ ctx, input }) => {
      const { auditLog } = await import("../../drizzle/schema");
      if (ctx.user.role !== "admin") {
        const { TRPCError } = await import("@trpc/server");
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      const db = await getDb();
      if (!db) return { logs: [], total: 0 };
      const offset = (input.page - 1) * input.limit;
      const logs = await db.select().from(auditLog)
        .orderBy(desc(auditLog.createdAt))
        .limit(input.limit).offset(offset);
      return { logs, total: logs.length };
    }),

  listAnalyticsEvents: protectedProcedure
    .input(z.object({ page: z.number().int().default(1), pageSize: z.number().int().default(20) }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) return { items: [], total: 0 };
      return { items: [], total: 0 };
    }),

  deleteAnalyticsEvent: protectedProcedure
    .input(z.object({ eventId: z.union([z.string(), z.number()]) }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "Database unavailable" });
      await writeAuditLog(ctx.user.id, "analyticsEvent.delete", { eventId: input.eventId });
      return { success: true };
    }),
});
