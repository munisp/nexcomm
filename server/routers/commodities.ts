/**
 * Commodities router — authoritative instrument and market-data access.
 *
 * Historical OHLCV and grade-spread data are deliberately unavailable until the
 * lakehouse/live market feed provides durable source records. This router never
 * synthesizes financial prices, candles, volume, or grade-adjusted history.
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { publicProcedure, router } from "../_core/trpc";
import { COMMODITY_MAP, COMMODITIES, GRADE_SPECS, WAREHOUSES } from '../../shared/commodities';
import { getReadDb } from "../db";
import { livePrices } from "../../drizzle/schema";
import { getOrSet, CacheKeys, TTL } from "../cache";

export interface OHLCVBar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

async function getAuthoritativeLivePrice(symbol: string) {
  let db;
  try {
    db = await getReadDb();
  } catch (cause) {
    throw new TRPCError({
      code: "SERVICE_UNAVAILABLE",
      message: "Authoritative commodity market data is unavailable",
      cause,
    });
  }
  if (!db) {
    throw new TRPCError({
      code: "SERVICE_UNAVAILABLE",
      message: "Authoritative commodity market data is unavailable",
    });
  }

  try {
    const [row] = await db
      .select()
      .from(livePrices)
      .where(eq(livePrices.symbol, symbol))
      .limit(1);
    if (!row) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: `No authoritative live price is available for ${symbol}`,
      });
    }
    return {
      price: parseFloat(row.price),
      changePct: row.changePct ? parseFloat(row.changePct) : 0,
      updatedAt: row.updatedAt,
    };
  } catch (cause) {
    if (cause instanceof TRPCError) throw cause;
    throw new TRPCError({
      code: "SERVICE_UNAVAILABLE",
      message: "Authoritative commodity market data query failed",
      cause,
    });
  }
}

export const commoditiesRouter = router({
  /** List declared commodity instruments; this is static catalogue metadata, not market data. */
  list: publicProcedure.query(() => {
    return getOrSet(CacheKeys.commodities(), TTL.COMMODITIES, async () =>
      COMMODITIES.map(c => ({
        symbol: c.symbol,
        name: c.name,
        category: c.category,
        unit: c.unit,
        currency: c.currency,
        description: c.description,
        country: c.country ?? null,
      }))
    );
  }),

  /**
   * Return only the current authoritative live price. Historical bars stay empty
   * until a durable OHLCV data source is integrated; no chart-shaped fallback is
   * generated in the application process.
   */
  priceHistory: publicProcedure
    .input(z.object({
      symbol: z.string().min(1),
      days: z.number().int().min(7).max(365).default(90),
    }))
    .query(async ({ input }) => {
      const commodity = COMMODITY_MAP.get(input.symbol);
      if (!commodity) {
        throw new TRPCError({ code: "NOT_FOUND", message: `Unknown commodity ${input.symbol}` });
      }
      const livePrice = await getAuthoritativeLivePrice(input.symbol);
      return {
        symbol: input.symbol,
        instrument: {
          name: commodity.name,
          category: commodity.category,
          unit: commodity.unit,
          currency: commodity.currency,
          description: commodity.description,
          country: commodity.country ?? null,
        },
        livePrice,
        bars: [] as OHLCVBar[],
        historyStatus: "UNAVAILABLE",
        historyMessage: "Historical OHLCV is unavailable until a durable market-data source is configured.",
      };
    }),

  /**
   * Grade premium metadata is static catalogue information, but historical grade
   * prices require authoritative OHLCV records and therefore fail closed here.
   */
  gradeSpread: publicProcedure
    .input(z.object({
      symbol: z.string().min(1),
      days: z.number().int().min(7).max(365).default(90),
    }))
    .query(async ({ input }) => {
      if (!COMMODITY_MAP.has(input.symbol)) {
        throw new TRPCError({ code: "NOT_FOUND", message: `Unknown commodity ${input.symbol}` });
      }
      await getAuthoritativeLivePrice(input.symbol);
      return {
        grades: [] as Array<{ code: string; name: string; premiumPct: number; bars: Array<{ time: number; close: number }> }>,
        historyStatus: "UNAVAILABLE",
        historyMessage: "Authoritative historical grade pricing is unavailable.",
      };
    }),

  /** Get related grade and warehouse catalogue metadata. */
  gingerInfo: publicProcedure.query(() => {
    const gingerGrades = (GRADE_SPECS as Array<{ commodity: string; code: string; name: string; description: string; premiumPct: number }>)
      .filter(g => g.commodity.startsWith("GINGER"));
    const gingerWarehouses = (WAREHOUSES as Array<{ commodities: string[]; id: string; name: string; city: string; state: string; capacity: number; available: number; certified: boolean; manager: string }>)
      .filter(w => w.commodities.some((c: string) => c.startsWith("GINGER")));
    return { grades: gingerGrades, warehouses: gingerWarehouses };
  }),
});
