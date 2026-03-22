/**
 * analyticsEngineRouter.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * tRPC router proxying the Analytics Engine (port 8011).
 * Provides real-time and historical analytics, market microstructure,
 * volume analysis, price discovery, and exchange-wide statistics.
 */

import { z } from "zod";
import { protectedProcedure, publicProcedure, adminProcedure, router } from "../_core/trpc";

const AE_URL = process.env.ANALYTICS_ENGINE_URL ?? "http://localhost:8006";
const TIMEOUT_MS = 10000;

async function aeFetch(path: string, options?: RequestInit): Promise<unknown> {
  const res = await fetch(`${AE_URL}${path}`, {
    ...options,
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { "Content-Type": "application/json", ...(options?.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`Analytics engine error: ${res.status} ${await res.text()}`);
  return res.json();
}

export const analyticsEngineRouter = router({
  /** Health check */
  health: publicProcedure.query(async () => {
    try {
      const data = await aeFetch("/health");
      return { online: true, ...(data as object) };
    } catch {
      return { online: false };
    }
  }),

  /** Get market microstructure data for a symbol */
  getMarketMicrostructure: publicProcedure
    .input(z.object({ symbol: z.string() }))
    .query(async ({ input }) => {
      try {
        return await aeFetch(`/api/v1/analytics/microstructure/${input.symbol}`);
      } catch {
        return { error: "Analytics engine offline" };
      }
    }),

  /** Get volume analysis for a symbol */
  getVolumeAnalysis: publicProcedure
    .input(z.object({
      symbol: z.string(),
      period: z.enum(["1h", "4h", "1d", "1w", "1m"]).default("1d"),
    }))
    .query(async ({ input }) => {
      try {
        return await aeFetch(`/api/v1/analytics/volume/${input.symbol}?period=${input.period}`);
      } catch {
        return { error: "Analytics engine offline" };
      }
    }),

  /** Get price discovery data */
  getPriceDiscovery: publicProcedure
    .input(z.object({ symbol: z.string() }))
    .query(async ({ input }) => {
      try {
        return await aeFetch(`/api/v1/analytics/price-discovery/${input.symbol}`);
      } catch {
        return { error: "Analytics engine offline" };
      }
    }),

  /** Get exchange-wide statistics */
  getExchangeStats: publicProcedure.query(async () => {
    try {
      return await aeFetch("/api/v1/analytics/exchange/stats");
    } catch {
      return { error: "Analytics engine offline" };
    }
  }),

  /** Get top movers (by price change) */
  getTopMovers: publicProcedure
    .input(z.object({
      limit: z.number().int().min(1).max(50).default(10),
      direction: z.enum(["gainers", "losers", "both"]).default("both"),
    }))
    .query(async ({ input }) => {
      try {
        return await aeFetch(`/api/v1/analytics/top-movers?limit=${input.limit}&direction=${input.direction}`);
      } catch {
        return { gainers: [], losers: [], error: "Analytics engine offline" };
      }
    }),

  /** Get most active symbols by volume */
  getMostActive: publicProcedure
    .input(z.object({ limit: z.number().int().min(1).max(50).default(10) }))
    .query(async ({ input }) => {
      try {
        return await aeFetch(`/api/v1/analytics/most-active?limit=${input.limit}`);
      } catch {
        return { symbols: [], error: "Analytics engine offline" };
      }
    }),

  /** Get OHLCV candles for a symbol */
  getOhlcv: publicProcedure
    .input(z.object({
      symbol: z.string(),
      interval: z.enum(["1m", "5m", "15m", "1h", "4h", "1d", "1w"]).default("1d"),
      from: z.number().int().optional(),
      to: z.number().int().optional(),
      limit: z.number().int().min(1).max(1000).default(100),
    }))
    .query(async ({ input }) => {
      try {
        const params = new URLSearchParams({
          interval: input.interval,
          limit: String(input.limit),
          ...(input.from ? { from: String(input.from) } : {}),
          ...(input.to ? { to: String(input.to) } : {}),
        });
        return await aeFetch(`/api/v1/analytics/ohlcv/${input.symbol}?${params}`);
      } catch {
        return { candles: [], error: "Analytics engine offline" };
      }
    }),

  /** Get trade history for a symbol */
  getTradeHistory: publicProcedure
    .input(z.object({
      symbol: z.string(),
      limit: z.number().int().min(1).max(500).default(50),
    }))
    .query(async ({ input }) => {
      try {
        return await aeFetch(`/api/v1/analytics/trades/${input.symbol}?limit=${input.limit}`);
      } catch {
        return { trades: [], error: "Analytics engine offline" };
      }
    }),

  /** Get portfolio analytics for the current user */
  getPortfolioAnalytics: protectedProcedure
    .input(z.object({
      period: z.enum(["1d", "1w", "1m", "3m", "6m", "1y", "all"]).default("1m"),
    }))
    .query(async ({ ctx, input }) => {
      try {
        return await aeFetch(`/api/v1/analytics/portfolio/${ctx.user.id}?period=${input.period}`);
      } catch {
        return { error: "Analytics engine offline" };
      }
    }),

  /** Get liquidity metrics for a symbol */
  getLiquidityMetrics: publicProcedure
    .input(z.object({ symbol: z.string() }))
    .query(async ({ input }) => {
      try {
        return await aeFetch(`/api/v1/analytics/liquidity/${input.symbol}`);
      } catch {
        return { error: "Analytics engine offline" };
      }
    }),

  /** Get market impact analysis */
  getMarketImpact: protectedProcedure
    .input(z.object({
      symbol: z.string(),
      side: z.enum(["BUY", "SELL"]),
      quantity: z.number().positive(),
    }))
    .query(async ({ input }) => {
      try {
        return await aeFetch("/api/v1/analytics/market-impact", {
          method: "POST",
          body: JSON.stringify(input),
        });
      } catch {
        return { estimated_impact: 0, error: "Analytics engine offline" };
      }
    }),

  /** Get exchange-wide report (admin) */
  getExchangeReport: adminProcedure
    .input(z.object({
      from: z.number().int(),
      to: z.number().int(),
      format: z.enum(["json", "csv"]).default("json"),
    }))
    .query(async ({ input }) => {
      try {
        return await aeFetch(`/api/v1/analytics/exchange/report?from=${input.from}&to=${input.to}&format=${input.format}`);
      } catch {
        return { error: "Analytics engine offline" };
      }
    }),
});
