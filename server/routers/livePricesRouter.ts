/**
 * livePricesRouter.ts
 * tRPC procedures for accessing live commodity prices from the live_prices table.
 * Prices are populated by the priceFeedJob (Yahoo Finance, every 5 minutes).
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { publicProcedure, protectedProcedure, adminProcedure, router } from "../_core/trpc";
import { requireExchangeAdmin } from "../_core/permify";
import { runPriceFeedJob } from "../jobs/priceFeedJob";
import { getDb } from "../db";
import { livePrices } from "../../drizzle/schema";
import { eq, inArray } from "drizzle-orm";
import { cacheWrap, cacheDel, CacheKeys, TTL, type CacheStatus } from "../cache";
import { measureDb } from "../_core/perfMiddleware";
import { writeAuditLog } from "../audit";

/** Set the X-Cache marker header when the express response object is reachable. */
function setCacheHeader(res: { setHeader?: (k: string, v: string) => void } | undefined) {
  return (status: CacheStatus) => {
    try {
      res?.setHeader?.("X-Cache", status);
    } catch {
      // headers already sent — non-critical
    }
  };
}

export const livePricesRouter = router({
  /**
   * Get all live prices (for the Markets and Indices pages).
   * Returns an empty array if the DB is unavailable or no prices have been fetched yet.
   * Cached with SWR: 5s fresh, serves stale up to 30s while refreshing in background.
   */
  getAll: publicProcedure.query(async ({ ctx }) => {
    return cacheWrap(CacheKeys.livePrices(), TTL.PRICE_FEED, async () => {
      try {
        const db = await getDb();
        if (!db) return { prices: [], lastUpdated: null };
        const rows = await measureDb("livePrices.getAll", () =>
          db.select().from(livePrices).orderBy(livePrices.assetClass, livePrices.symbol));
        const lastUpdated = rows.length > 0
          ? rows.reduce((latest, r) => r.updatedAt > latest ? r.updatedAt : latest, rows[0].updatedAt)
          : null;
        return { prices: rows, lastUpdated };
      } catch {
        return { prices: [], lastUpdated: null };
      }
    }, { staleTtl: 30, onStatus: setCacheHeader(ctx.res) });
  }),

  /**
   * Get the live price for a single symbol.
   */
  getBySymbol: publicProcedure
    .input(z.object({ symbol: z.string().trim() }))
    .query(async ({ ctx, input }) => {
      return cacheWrap(`live_prices:symbol:${input.symbol}`, TTL.PRICE_FEED, async () => {
        try {
          const db = await getDb();
          if (!db) return null;
          const rows = await measureDb("livePrices.getBySymbol", () =>
            db.select().from(livePrices).where(eq(livePrices.symbol, input.symbol)).limit(1));
          return rows[0] ?? null;
        } catch {
          return null;
        }
      }, { staleTtl: 30, onStatus: setCacheHeader(ctx.res) });
    }),

  /**
   * Get live prices for multiple symbols at once.
   */
  getBySymbols: publicProcedure
    .input(z.object({ symbols: z.array(z.string().trim()) }))
    .query(async ({ ctx, input }) => {
      if (input.symbols.length === 0) return [];
      // Sorted key so symbol order doesn't fragment the cache
      const key = `live_prices:symbols:${[...input.symbols].sort().join(",")}`;
      return cacheWrap(key, TTL.PRICE_FEED, async () => {
        try {
          const db = await getDb();
          if (!db) return [];
          return await measureDb("livePrices.getBySymbols", () =>
            db.select().from(livePrices).where(inArray(livePrices.symbol, input.symbols)));
        } catch {
          return [];
        }
      }, { staleTtl: 30, onStatus: setCacheHeader(ctx.res) });
    }),

  /**
   * Get live prices grouped by asset class.
   */
  getByAssetClass: publicProcedure
    .input(z.object({ assetClass: z.string().trim() }))
    .query(async ({ ctx, input }) => {
      return cacheWrap(`live_prices:asset_class:${input.assetClass}`, TTL.PRICE_FEED, async () => {
        try {
          const db = await getDb();
          if (!db) return [];
          return await measureDb("livePrices.getByAssetClass", () =>
            db.select().from(livePrices).where(eq(livePrices.assetClass, input.assetClass)));
        } catch {
          return [];
        }
      }, { staleTtl: 30, onStatus: setCacheHeader(ctx.res) });
    }),

  /**
   * Force-trigger the price feed job immediately (admin only).
   */
  triggerRefresh: adminProcedure
    .use(requireExchangeAdmin)
    .mutation(async () => {
    try {
      await runPriceFeedJob();
      // Invalidate all live-price cache entries so the next read is fresh
      cacheDel("live_prices:*").catch(() => {});
      cacheDel("commodities:live_price:*").catch(() => {});
      const db = await getDb();
      if (!db) return { success: true, updated: 0, fallback: 0 };
      const rows = await db.select().from(livePrices);
      const updated = rows.filter(r => r.source === "yahoo").length;
      const fallback = rows.filter(r => r.source !== "yahoo").length;
      return { success: true, updated, fallback };
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      throw new TRPCError({ code: "BAD_GATEWAY", message: `Price feed refresh failed: ${msg}` });
    }
  }),
  /**
   * Get price feed health status — used by the Markets page status indicator.
   */
  feedStatus: publicProcedure.query(async ({ ctx }) => {
    return cacheWrap("live_prices:feed_status", 10, async () => {
      try {
        const db = await getDb();
        if (!db) return { live: 0, fallback: 0, total: 0, lastUpdated: null, healthy: false };
        const rows = await measureDb("livePrices.feedStatus", () =>
          db.select({ source: livePrices.source, updatedAt: livePrices.updatedAt }).from(livePrices));
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
    }, { staleTtl: 60, onStatus: setCacheHeader(ctx.res) });
  }),

  createLivePrice: protectedProcedure
    .input(z.object({ data: z.record(z.string(), z.unknown()) }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "Database unavailable" });
      await writeAuditLog({ userId: ctx.user.id, action: "livePrice.create", details: input.data });
      return { success: true, message: "Created successfully" };
    }),

  deleteLivePrice: protectedProcedure
    .input(z.object({ symbol: z.union([z.string(), z.number()]) }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "Database unavailable" });
      await writeAuditLog({ userId: ctx.user.id, action: "livePrice.delete", details: { symbol: input.symbol } });
      return { success: true };
    }),
});
