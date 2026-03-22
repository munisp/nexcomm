/**
 * Commodities router — price history and instrument data.
 * Generates deterministic 90-day OHLCV candles from the shared
 * seeded-random model so the chart looks realistic without a DB.
 */
import { z } from "zod";
import { publicProcedure, router } from "../_core/trpc";
import { COMMODITY_MAP, COMMODITIES, GRADE_SPECS, WAREHOUSES } from "@shared/commodities";

// ── Seeded random (mirrors shared/commodities.ts) ────────────────────────────
function seededRandom(seed: number): number {
  const x = Math.sin(seed + 1) * 10000;
  return x - Math.floor(x);
}

export interface OHLCVBar {
  time: number;   // Unix timestamp (ms, start of day UTC)
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/**
 * Generate `days` daily OHLCV bars ending today for the given symbol.
 * Uses a deterministic walk so the same symbol always produces the same
 * historical shape, while the last bar reflects "today's" simulated price.
 */
function generateDailyOHLCV(symbol: string, days: number): OHLCVBar[] {
  const commodity = COMMODITY_MAP.get(symbol);
  if (!commodity) return [];

  const bars: OHLCVBar[] = [];
  const now = Date.now();
  // Align to start of today UTC
  const todayStart = now - (now % 86_400_000);
  let price = commodity.basePrice;

  // Walk backwards then reverse so we get ascending order
  const rawBars: OHLCVBar[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const dayStart = todayStart - i * 86_400_000;
    const dayIndex = Math.floor(dayStart / 86_400_000);
    const symbolHash = symbol.split("").reduce((a, c) => a + c.charCodeAt(0), 0);

    const r1 = seededRandom(dayIndex * 7 + symbolHash);
    const r2 = seededRandom(dayIndex * 7 + symbolHash + 1);
    const r3 = seededRandom(dayIndex * 7 + symbolHash + 2);
    const r4 = seededRandom(dayIndex * 7 + symbolHash + 3);
    const r5 = seededRandom(dayIndex * 7 + symbolHash + 4);

    // Daily volatility: ±2.5% max
    const dailyVol = commodity.basePrice * 0.025;
    const dayChange = (r1 - 0.5) * 2 * dailyVol;
    // Seasonal trend: ginger peaks mid-year (harvest season)
    const dayOfYear = (dayStart / 86_400_000) % 365;
    const seasonal = Math.sin((dayOfYear / 365) * 2 * Math.PI) * commodity.basePrice * 0.04;

    const open = price;
    const close = Math.max(
      commodity.basePrice * 0.6,
      price + dayChange + seasonal * 0.1
    );
    const intraHigh = Math.max(open, close) * (1 + r2 * 0.015);
    const intraLow  = Math.min(open, close) * (1 - r3 * 0.015);
    const volume    = Math.floor((r4 * 800 + 200) * commodity.lotSize);

    rawBars.push({
      time:   dayStart,
      open:   +open.toFixed(2),
      high:   +intraHigh.toFixed(2),
      low:    +intraLow.toFixed(2),
      close:  +close.toFixed(2),
      volume,
    });

    price = close;
    void r5; // reserved for future use
  }

  // rawBars is already in ascending order (oldest first)
  return rawBars;
}

export const commoditiesRouter = router({
  /** List all available commodity instruments */
  list: publicProcedure.query(() => {
    return COMMODITIES.map(c => ({
      symbol:      c.symbol,
      name:        c.name,
      category:    c.category,
      unit:        c.unit,
      currency:    c.currency,
      basePrice:   c.basePrice,
      description: c.description,
      country:     c.country ?? null,
    }));
  }),

  /** Get OHLCV price history for a commodity symbol */
  priceHistory: publicProcedure
    .input(z.object({
      symbol: z.string().min(1),
      days:   z.number().int().min(7).max(365).default(90),
    }))
    .query(({ input }) => {
      const commodity = COMMODITY_MAP.get(input.symbol);
      if (!commodity) {
        return { symbol: input.symbol, bars: [], instrument: null };
      }
      const bars = generateDailyOHLCV(input.symbol, input.days);
      return {
        symbol:     input.symbol,
        instrument: {
          name:        commodity.name,
          category:    commodity.category,
          unit:        commodity.unit,
          currency:    commodity.currency,
          basePrice:   commodity.basePrice,
          description: commodity.description,
          country:     commodity.country ?? null,
        },
        bars,
      };
    }),

  /**
   * Get grade-adjusted daily close prices for all grades of a commodity.
   * Returns one array of {time, close} per grade, suitable for multi-line charts.
   */
  gradeSpread: publicProcedure
    .input(z.object({
      symbol: z.string().min(1),
      days:   z.number().int().min(7).max(365).default(90),
    }))
    .query(({ input }) => {
      const commodity = COMMODITY_MAP.get(input.symbol);
      if (!commodity) return { grades: [] };

      const baseBars = generateDailyOHLCV(input.symbol, input.days);

      // Collect all grades for this symbol
      const gradeList = (GRADE_SPECS as Array<{ commodity: string; code: string; name: string; description: string; premiumPct: number }>)
        .filter(g => g.commodity === input.symbol);

      // For each grade, apply the premium multiplier to the close price
      const gradeLines = gradeList.map(grade => ({
        code:       grade.code,
        name:       grade.name,
        premiumPct: grade.premiumPct,
        bars: baseBars.map(bar => ({
          time:  bar.time,
          close: +(bar.close * (1 + grade.premiumPct / 100)).toFixed(2),
        })),
      }));

      return { grades: gradeLines };
    }),

  /** Get related ginger grades and warehouses */
  gingerInfo: publicProcedure.query(() => {
    // GRADE_SPECS and WAREHOUSES are imported at the top of this file
    const gingerGrades = (GRADE_SPECS as Array<{ commodity: string; code: string; name: string; description: string; premiumPct: number }>)
      .filter(g => g.commodity.startsWith("GINGER"));
    const gingerWarehouses = (WAREHOUSES as Array<{ commodities: string[]; id: string; name: string; city: string; state: string; capacity: number; available: number; certified: boolean; manager: string }>)
      .filter(w => w.commodities.some((c: string) => c.startsWith("GINGER")));
    return { grades: gingerGrades, warehouses: gingerWarehouses };
  }),
});
