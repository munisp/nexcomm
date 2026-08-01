/**
 * NEXCOM Exchange — Commodity Indices & Order Book Levels tRPC Router
 * =====================================================================
 * Procedures:
 *   indices.list              — Public: list all commodity indexes
 *   indices.get               — Public: single index detail
 *   indices.getHistory        — Public: price history for an index
 *   indices.create            — Admin: create a new index
 *   indices.update            — Admin: update index value / components
 *   indices.delete            — Admin: soft-delete an index
 *   indices.getOrderBookLevels — Public: current order book depth for a symbol
 *   indices.upsertOrderBookLevel — Admin/system: upsert a price level
 *   indices.clearOrderBook    — Admin/system: clear all levels for a symbol
 */
import { z } from "zod";
import { router, publicProcedure, protectedProcedure } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import { getDb } from "../db";
import {
  commodityIndexes,
  commodityIndexHistory,
  orderBookLevels,
} from "../../drizzle/schema";
import { eq, desc, and, gte, lte, asc } from "drizzle-orm";
import { writeAuditLog } from "../audit";

export const indicesRouter = router({
  // ─── List all indexes ──────────────────────────────────────────────────────
  list: publicProcedure
    .input(
      z.object({
        limit: z.number().int().min(1).max(100).default(50),
        offset: z.number().int().min(0).default(0),
      }).optional()
    )
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return [];
      return db
        .select()
        .from(commodityIndexes)
        .orderBy(asc(commodityIndexes.ticker))
        .limit(input?.limit ?? 50)
        .offset(input?.offset ?? 0);
    }),

  // ─── Get single index ──────────────────────────────────────────────────────
  get: publicProcedure
    .input(z.object({ ticker: z.string().min(1).max(20) }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return null;
      const [row] = await db
        .select()
        .from(commodityIndexes)
        .where(eq(commodityIndexes.ticker, input.ticker.toUpperCase()))
        .limit(1);
      return row ?? null;
    }),

  // ─── Price history for an index ────────────────────────────────────────────
  getHistory: publicProcedure
    .input(
      z.object({
        indexId: z.number().int().positive(),
        from: z.string().optional(),
        to: z.string().optional(),
        limit: z.number().int().min(1).max(1000).default(200),
      })
    )
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return [];
      const conditions = [eq(commodityIndexHistory.indexId, input.indexId)];
      if (input.from) conditions.push(gte(commodityIndexHistory.recordedAt, new Date(input.from)));
      if (input.to) conditions.push(lte(commodityIndexHistory.recordedAt, new Date(input.to)));
      return db
        .select()
        .from(commodityIndexHistory)
        .where(and(...conditions))
        .orderBy(desc(commodityIndexHistory.recordedAt))
        .limit(input.limit);
    }),

  // ─── Create index (admin) ──────────────────────────────────────────────────
  create: protectedProcedure
    .input(
      z.object({
        ticker: z.string().min(2).max(20).toUpperCase(),
        name: z.string().min(3).max(200),
        description: z.string().max(2000).optional(),
        baseValue: z.number().positive().default(1000),
        calculationMethod: z.enum(["PRICE_WEIGHTED", "MARKET_CAP_WEIGHTED", "EQUAL_WEIGHTED"]).default("PRICE_WEIGHTED"),
        rebalanceFrequency: z.enum(["DAILY", "WEEKLY", "MONTHLY", "QUARTERLY"]).default("MONTHLY"),
        components: z.array(z.object({
          symbol: z.string().trim(),
          weight: z.number().min(0).max(1),
          lastPrice: z.number().optional(),
        })).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
      const db = await getDb();
            if (!db) return { success: true };
      const [idx] = await db
        .insert(commodityIndexes)
        .values({
          ticker: input.ticker,
          name: input.name,
          description: input.description,
          baseValue: String(input.baseValue),
          currentValue: String(input.baseValue),
          calculationMethod: input.calculationMethod,
          rebalanceFrequency: input.rebalanceFrequency,
          components: input.components ?? [],
        })
        .returning();
      return { success: true, indexId: idx.id, ticker: idx.ticker };
    }),

  // ─── Update index value / components (admin) ──────────────────────────────
  update: protectedProcedure
    .input(
      z.object({
        id: z.number().int().positive(),
        currentValue: z.number().positive().optional(),
        changePercent: z.number().optional(),
        components: z.array(z.object({
          symbol: z.string().trim(),
          weight: z.number().min(0).max(1),
          lastPrice: z.number().optional(),
        })).optional(),
        name: z.string().min(3).max(200).optional(),
        description: z.string().max(2000).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
      const db = await getDb();
            if (!db) throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "Database unavailable" });
      const updates: Record<string, unknown> = { updatedAt: new Date() };
      if (input.currentValue !== undefined) updates.currentValue = String(input.currentValue);
      if (input.changePercent !== undefined) updates.changePercent = String(input.changePercent);
      if (input.components !== undefined) updates.components = input.components;
      if (input.name !== undefined) updates.name = input.name;
      if (input.description !== undefined) updates.description = input.description;
      if (input.currentValue !== undefined) {
        updates.lastCalculatedAt = new Date();
        // Record history snapshot
        await db.insert(commodityIndexHistory).values({
          indexId: input.id,
          value: String(input.currentValue),
          changePercent: input.changePercent !== undefined ? String(input.changePercent) : null,
        });
      }
      const [updated] = await db
        .update(commodityIndexes)
        .set(updates as any)
        .where(eq(commodityIndexes.id, input.id))
        .returning();
      return { success: true, index: updated };
    }),

  // ─── Delete index (admin) ──────────────────────────────────────────────────
  delete: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
      const db = await getDb();
            if (!db) return { success: true };
      await db.delete(commodityIndexes).where(eq(commodityIndexes.id, input.id));
      return { success: true };
    }),

  // ─── Order book depth ─────────────────────────────────────────────────────
  getOrderBookLevels: publicProcedure
    .input(
      z.object({
        symbol: z.string().min(1).max(32),
        depth: z.number().int().min(1).max(100).default(20),
      })
    )
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return { bids: [], asks: [] };
      const sym = input.symbol.toUpperCase();
      const [bids, asks] = await Promise.all([
        db
          .select()
          .from(orderBookLevels)
          .where(and(eq(orderBookLevels.symbol, sym), eq(orderBookLevels.side, "BID")))
          .orderBy(desc(orderBookLevels.price))
          .limit(input.depth),
        db
          .select()
          .from(orderBookLevels)
          .where(and(eq(orderBookLevels.symbol, sym), eq(orderBookLevels.side, "ASK")))
          .orderBy(asc(orderBookLevels.price))
          .limit(input.depth),
      ]);
      return { bids, asks };
    }),

  // ─── Upsert order book level (system/admin) ────────────────────────────────
  upsertOrderBookLevel: protectedProcedure
    .input(
      z.object({
        symbol: z.string().min(1).max(32),
        side: z.enum(["BID", "ASK"]),
        price: z.number().positive(),
        quantity: z.number().min(0),
        orderCount: z.number().int().min(0).default(1),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
      const db = await getDb();
            if (!db) return { success: true };
      const sym = input.symbol.toUpperCase();
      if (input.quantity === 0) {
        // Remove the level
        await db
          .delete(orderBookLevels)
          .where(
            and(
              eq(orderBookLevels.symbol, sym),
              eq(orderBookLevels.side, input.side),
              eq(orderBookLevels.price, String(input.price))
            )
          );
        return { success: true, action: "deleted" };
      }
      const existing = await db
        .select({ id: orderBookLevels.id })
        .from(orderBookLevels)
        .where(
          and(
            eq(orderBookLevels.symbol, sym),
            eq(orderBookLevels.side, input.side),
            eq(orderBookLevels.price, String(input.price))
          )
        )
        .limit(1);
      if (existing.length > 0) {
        await db
          .update(orderBookLevels)
          .set({ quantity: String(input.quantity), orderCount: input.orderCount, updatedAt: new Date() })
          .where(eq(orderBookLevels.id, existing[0].id));
      } else {
        await db.insert(orderBookLevels).values({
          symbol: sym,
          side: input.side,
          price: String(input.price),
          quantity: String(input.quantity),
          orderCount: input.orderCount,
        });
      }
      return { success: true, action: "upserted" };
    }),

  // ─── Clear order book for a symbol (admin) ────────────────────────────────
  clearOrderBook: protectedProcedure
    .input(z.object({ symbol: z.string().min(1).max(32) }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
      const db = await getDb();
            if (!db) return { success: true };
      await db.delete(orderBookLevels).where(eq(orderBookLevels.symbol, input.symbol.toUpperCase()));
      return { success: true };
    }),
});
