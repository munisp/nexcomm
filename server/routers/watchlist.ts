/**
 * NEXCOM Exchange — Watchlist Router
 * Manages per-user instrument watchlists with add/remove/list/check.
 */
import { z } from "zod";
import { eq, and } from "drizzle-orm";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { watchlist } from "../../drizzle/schema";

export const watchlistRouter = router({
  /** List all symbols on the current user's watchlist */
  list: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) return [] as string[];
    const rows = await db
      .select()
      .from(watchlist)
      .where(eq(watchlist.userId, ctx.user.id));
    return rows.map(r => r.symbol);
  }),

  /** Add a symbol to the watchlist (idempotent) */
  add: protectedProcedure
    .input(z.object({ symbol: z.string().min(1).max(32) }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database unavailable");
      // Check if already exists
      const existing = await db
        .select()
        .from(watchlist)
        .where(and(eq(watchlist.userId, ctx.user.id), eq(watchlist.symbol, input.symbol)))
        .limit(1);
      if (existing.length > 0) return { added: false };
      await db.insert(watchlist).values({ userId: ctx.user.id, symbol: input.symbol });
      return { added: true };
    }),

  /** Remove a symbol from the watchlist */
  remove: protectedProcedure
    .input(z.object({ symbol: z.string().min(1).max(32) }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database unavailable");
      await db
        .delete(watchlist)
        .where(and(eq(watchlist.userId, ctx.user.id), eq(watchlist.symbol, input.symbol)));
      return { removed: true };
    }),

  /** Check if a symbol is on the watchlist */
  has: protectedProcedure
    .input(z.object({ symbol: z.string().min(1).max(32) }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) return { watching: false };
      const rows = await db
        .select()
        .from(watchlist)
        .where(and(eq(watchlist.userId, ctx.user.id), eq(watchlist.symbol, input.symbol)))
        .limit(1);
      return { watching: rows.length > 0 };
    }),
});
