/**
 * livePricesRouter.ts
 * tRPC procedures for accessing live commodity prices from the live_prices table.
 * Prices are populated by the priceFeedJob (Yahoo Finance, every 5 minutes).
 */
import { z } from "zod";
import { publicProcedure, adminProcedure, router } from "../_core/trpc";
import { runPriceFeedJob } from "../jobs/priceFeedJob";
import { getDb } from "../db";
import { livePrices } from "../../drizzle/schema";
import { eq, inArray } from "drizzle-orm";
import { getOrSet, cacheDel, CacheKeys, TTL } from "../cache";
import { writeAuditLog } from "../audit";

export const livePricesRouter = router({
  /**
   * Get all live prices (for the Markets and Indices pages).
   * Returns an empty array if the DB is unavailable or no prices have been fetched yet.
   */
  getAll: publicProcedure.query(async () => {
    return getOrSet(CacheKeys.livePrices(), TTL.PRICE_FEED, async () => {
      try {
        const db = await getDb();
        if (!db) return { prices: [], lastUpdated: null };
        const rows = await db.select().from(livePrices).orderBy(livePrices.assetClass, livePrices.symbol);
        const lastUpdated = rows.length > 0
          ? rows.reduce((latest, r) => r.updatedAt > latest ? r.updatedAt : latest, rows[0].updatedAt)
          : null;
        return { prices: rows, lastUpdated };
      } catch {
        return { prices: [], lastUpdated: null };
      }
    });
  }),

  /**
   * Get the live price for a single symbol.
   */
  getBySymbol: publicProcedure
    .input(z.object({ symbol: z.string().trim() }))
    .query(async ({ input }) => {
      try {
        const db = await getDb();
        if (!db) return null;
        const rows = await db.select().from(livePrices).where(eq(livePrices.symbol, input.symbol)).limit(1);
        return rows[0] ?? null;
      } catch {
        return null;
      }
    }),

  /**
   * Get live prices for multiple symbols at once.
   */
  getBySymbols: publicProcedure
    .input(z.object({ symbols: z.array(z.string().trim()) }))
    .query(async ({ input }) => {
      try {
        const db = await getDb();
        if (!db) return [];
        if (input.symbols.length === 0) return [];
        const rows = await db.select().from(livePrices).where(inArray(livePrices.symbol, input.symbols));
        return rows;
      } catch {
        return [];
      }
    }),

  /**
   * Get live prices grouped by asset class.
   */
  getByAssetClass: publicProcedure
    .input(z.object({ assetClass: z.string().trim() }))
    .query(async ({ input }) => {
      try {
        const db = await getDb();
        if (!db) return [];
        const rows = await db.select().from(livePrices).where(eq(livePrices.assetClass, input.assetClass));
        return rows;
      } catch {
        return [];
      }
    }),

  /**
   * Force-trigger the price feed job immediately (admin only).
   */
  triggerRefresh: adminProcedure.mutation(async () => {
    try {
      await runPriceFeedJob();
      const db = await getDb();
      if (!db) return { success: true, updated: 0, fallback: 0 };
      const rows = await db.select().from(livePrices);
      const updated = rows.filter(r => r.source === "yahoo").length;
      const fallback = rows.filter(r => r.source !== "yahoo").length;
      return { success: true, updated, fallback };
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      throw new Error(`Price feed refresh failed: ${msg}`);
    }
  }),
  /**
   * Get price feed health status — used by the Markets page status indicator.
   */
  feedStatus: publicProcedure.query(async () => {
    try {
      const db = await getDb();
      if (!db) return { live: 0, fallback: 0, total: 0, lastUpdated: null, healthy: false };
      const rows = await db.select({ source: livePrices.source, updatedAt: livePrices.updatedAt }).from(livePrices);
      const live = rows.filter(r => r.source === "yahoo").length;
      const fallback = rows.filter(r => r.source !== "yahoo").length;
      const lastUpdated = rows.length > 0
        ? rows.reduce((latest, r) => r.updatedAt > latest ? r.updatedAt : latest, rows[0].updatedAt)
        : null;
      const ageMs = lastUpdated ? Date.now() - new Date(lastUpdated).getTime() : Infinity;
      return { live, fallback, total: rows.length, lastUpdated, healthy: ageMs < 5 * 60 * 1000 };
    } catch {
      return { live: 0, fallback: 0, total: 0, lastUpdated: null, healthy: false };
    }
  }),
});
