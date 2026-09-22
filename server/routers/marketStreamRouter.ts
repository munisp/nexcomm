/**
 * Market stream router (INNOV-C) — real order-book depth, recent trades and
 * ticker snapshots for the Market Depth UI.
 *
 * Data sources (ALL real tables — no fabricated levels):
 *   - order_book_levels : maintained by the matching engine (aggregated levels)
 *   - orders            : fallback — aggregate open orders by price level when
 *                         the matching engine hasn't published levels yet
 *   - trade_fills       : executed trades feed
 *   - live_prices       : last price / 24h change (Yahoo 5-min poller)
 *
 * Empty states are returned honestly (empty arrays / null fields) when a
 * symbol has no book or no trades yet — the UI renders an empty state.
 *
 * Transport: tRPC queries; the client polls at 5s (refetchInterval). A WS
 * order-book server also exists (server/ws/orderBookServer.ts) — these
 * procedures are the DB-backed, always-available counterpart.
 *
 * Register in server/routers.ts (see INNOV-C/MANIFEST.md):
 *   import { marketStreamRouter } from "./routers/marketStreamRouter";
 *   ... marketStream: marketStreamRouter,
 */
import { z } from "zod";
import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { publicProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { livePrices, orderBookLevels, orders, tradeFills } from "../../drizzle/schema";

const symbolInput = z.string().min(1).max(32).transform((s) => s.toUpperCase());

export interface DepthLevel {
  price: number;
  quantity: number;
  orderCount: number;
  cumulative: number;
}

function toNum(v: string | number | null | undefined): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function withCumulative(levels: Omit<DepthLevel, "cumulative">[]): DepthLevel[] {
  let acc = 0;
  return levels.map((l) => ({ ...l, cumulative: (acc += l.quantity) }));
}

export const marketStreamRouter = router({
  /**
   * Aggregated order book depth for a symbol. Prefers matching-engine levels
   * (order_book_levels); falls back to aggregating open orders. Sorted bids
   * desc / asks asc, with cumulative totals for the ladder UI.
   */
  orderBookDepth: publicProcedure
    .input(z.object({ symbol: symbolInput, levels: z.number().int().min(1).max(50).default(20) }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) {
        return { symbol: input.symbol, bids: [] as DepthLevel[], asks: [] as DepthLevel[], spread: null, midPrice: null, source: "unavailable" as const };
      }

      let source: "matching_engine" | "open_orders" = "matching_engine";
      let bids: DepthLevel[] = [];
      let asks: DepthLevel[] = [];

      const levelRows = await db
        .select()
        .from(orderBookLevels)
        .where(eq(orderBookLevels.symbol, input.symbol));

      if (levelRows.length > 0) {
        bids = withCumulative(
          levelRows
            .filter((r) => r.side === "BUY")
            .map((r) => ({ price: toNum(r.price), quantity: toNum(r.quantity), orderCount: r.orderCount ?? 0 }))
            .sort((a, b) => b.price - a.price)
            .slice(0, input.levels)
        );
        asks = withCumulative(
          levelRows
            .filter((r) => r.side === "SELL")
            .map((r) => ({ price: toNum(r.price), quantity: toNum(r.quantity), orderCount: r.orderCount ?? 0 }))
            .sort((a, b) => a.price - b.price)
            .slice(0, input.levels)
        );
      } else {
        // Fallback: aggregate the open-order book straight from the orders table
        source = "open_orders";
        const openRows = await db
          .select({
            side: orders.side,
            price: orders.price,
            qty: sql<string>`sum((${orders.quantity})::numeric - coalesce((${orders.filledQty})::numeric, 0))`,
            cnt: sql<number>`count(*)::int`,
          })
          .from(orders)
          .where(and(eq(orders.symbol, input.symbol), inArray(orders.status, ["OPEN", "PARTIALLY_FILLED"])))
          .groupBy(orders.side, orders.price);

        const toLevel = (r: { side: string; price: string | null; qty: string; cnt: number }) => ({
          price: toNum(r.price),
          quantity: toNum(r.qty),
          orderCount: r.cnt,
        });
        bids = withCumulative(
          openRows.filter((r) => r.side === "BUY" && r.price != null).map(toLevel).sort((a, b) => b.price - a.price).slice(0, input.levels)
        );
        asks = withCumulative(
          openRows.filter((r) => r.side === "SELL" && r.price != null).map(toLevel).sort((a, b) => a.price - b.price).slice(0, input.levels)
        );
      }

      const bestBid = bids[0]?.price ?? null;
      const bestAsk = asks[0]?.price ?? null;
      return {
        symbol: input.symbol,
        bids,
        asks,
        spread: bestBid != null && bestAsk != null ? bestAsk - bestBid : null,
        midPrice: bestBid != null && bestAsk != null ? (bestAsk + bestBid) / 2 : null,
        source,
      };
    }),

  /** Executed trades feed (real fills, newest first). */
  recentTrades: publicProcedure
    .input(z.object({ symbol: symbolInput, limit: z.number().int().min(1).max(100).default(25) }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return { symbol: input.symbol, trades: [] };
      const rows = await db
        .select()
        .from(tradeFills)
        .where(eq(tradeFills.symbol, input.symbol))
        .orderBy(desc(tradeFills.createdAt))
        .limit(input.limit);
      return {
        symbol: input.symbol,
        trades: rows.map((r) => ({
          fillId: r.id,
          price: toNum(r.fillPrice),
          quantity: toNum(r.filledQty),
          grossValue: toNum(r.grossValue),
          settlementStatus: r.settlementId != null ? ("SETTLED" as const) : ("PENDING" as const),
          executedAt: r.createdAt,
        })),
      };
    }),

  /**
   * Ticker snapshot per symbol (or all symbols): last price + 24h change from
   * live_prices, 24h traded volume from trade_fills. Missing data stays null —
   * no synthetic ticks.
   */
  tickerSnapshot: publicProcedure
    .input(z.object({ symbol: symbolInput.optional() }).optional())
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return { tickers: [] };

      const priceRows = input?.symbol
        ? await db.select().from(livePrices).where(eq(livePrices.symbol, input.symbol))
        : await db.select().from(livePrices);

      // 24h trade stats keyed by symbol (only symbols with real fills)
      const since = new Date(Date.now() - 24 * 3600 * 1000);
      const volRows = await db
        .select({
          symbol: tradeFills.symbol,
          volume: sql<string>`coalesce(sum((${tradeFills.filledQty})::numeric), 0)`,
          lastPrice: sql<string>`(array_agg(${tradeFills.fillPrice} ORDER BY ${tradeFills.createdAt} DESC))[1]`,
        })
        .from(tradeFills)
        .where(gte(tradeFills.createdAt, since))
        .groupBy(tradeFills.symbol);
      const volBySymbol = new Map(volRows.map((r) => [r.symbol, r]));

      const symbols = new Set<string>([
        ...priceRows.map((r) => r.symbol),
        ...volRows.map((r) => r.symbol),
      ]);

      return {
        tickers: [...symbols].sort().map((symbol) => {
          const lp = priceRows.find((r) => r.symbol === symbol);
          const vol = volBySymbol.get(symbol);
          return {
            symbol,
            name: lp?.name ?? null,
            currency: lp?.currency ?? null,
            lastPrice: vol?.lastPrice != null ? toNum(vol.lastPrice) : lp ? toNum(lp.price) : null,
            changePct24h: lp?.changePct != null ? toNum(lp.changePct) : null,
            volume24h: vol ? toNum(vol.volume) : 0,
            high: lp?.high != null ? toNum(lp.high) : null,
            low: lp?.low != null ? toNum(lp.low) : null,
            source: lp?.source ?? (vol ? "trade_fills" : null),
            updatedAt: lp?.updatedAt ?? null,
          };
        }),
      };
    }),
});
