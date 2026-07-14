/**
 * NEXCOM Exchange — Market Assistant Router (R72)
 * AI-powered natural language queries about crop prices and trading trends.
 */
import { z } from "zod";
import { protectedProcedure, publicProcedure, router } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import { invokeLLM } from "../_core/llm";
import { getDb } from "../db";
import { livePrices, tradeFills } from "../../drizzle/schema";
import { desc, sql, gte } from "drizzle-orm";

const RATE_LIMIT_MS = 3000;
const lastRequestMap = new Map<string, number>();

export const marketAssistantRouter = router({
  /**
   * Ask a natural language question about crop prices or trading trends.
   */
  ask: protectedProcedure
    .input(
      z.object({
        question: z.string().min(1).max(500).trim(),
        history: z
          .array(
            z.object({
              role: z.enum(["user", "assistant"]),
              content: z.string().max(2000),
            })
          )
          .max(20)
          .default([]),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const userId = String(ctx.user.id);
      const now = Date.now();
      const last = lastRequestMap.get(userId) ?? 0;
      if (now - last < RATE_LIMIT_MS) {
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: "Please wait a moment before sending another message.",
        });
      }
      lastRequestMap.set(userId, now);

      const db = await getDb();
      let marketContext = "No live price data available.";
      let trendContext = "No recent trade data available.";

      if (db) {
        try {
          // Top 20 commodity prices
          const prices = await db
            .select({
              symbol: livePrices.symbol,
              name: livePrices.name,
              assetClass: livePrices.assetClass,
              price: livePrices.price,
              change: livePrices.change,
              changePct: livePrices.changePct,
              high: livePrices.high,
              low: livePrices.low,
              currency: livePrices.currency,
              updatedAt: livePrices.updatedAt,
            })
            .from(livePrices)
            .orderBy(desc(livePrices.updatedAt))
            .limit(20);

          if (prices.length > 0) {
            marketContext = prices
              .map(
                (p) =>
                  `${p.symbol} (${p.name}, ${p.assetClass}): price=${p.price} ${p.currency}, change=${p.change ?? "N/A"} (${p.changePct ?? "N/A"}%), high=${p.high ?? "N/A"}, low=${p.low ?? "N/A"}`
              )
              .join("\n");
          }

          // Recent 24h trade trends by symbol
          const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
          const trends = await db
            .select({
              symbol: tradeFills.symbol,
              tradeCount: sql<number>`count(*)::int`,
              totalQty: sql<number>`sum(${tradeFills.filledQty})::numeric`,
              avgPrice: sql<number>`avg(${tradeFills.fillPrice})::numeric`,
            })
            .from(tradeFills)
            .where(gte(tradeFills.createdAt, since))
            .groupBy(tradeFills.symbol)
            .orderBy(desc(sql`count(*)`))
            .limit(10);

          if (trends.length > 0) {
            trendContext = trends
              .map(
                (t) =>
                  `${t.symbol}: ${t.tradeCount} trades, avg_price=${Number(t.avgPrice).toFixed(2)}, total_qty=${Number(t.totalQty).toFixed(2)}`
              )
              .join("\n");
          }
        } catch {
          // Non-fatal — proceed with empty context
        }
      }

      const systemPrompt = `You are NEXCOM Market Assistant, an expert AI for the NEXCOM commodity exchange platform.
You help farmers, traders, and brokers understand crop prices, trading trends, market conditions, and exchange features.

CURRENT LIVE MARKET DATA (as of ${new Date().toISOString()}):
${marketContext}

RECENT 24H TRADING TRENDS (top symbols by trade count):
${trendContext}

GUIDELINES:
- Answer concisely and accurately based on the market data provided.
- If asked about a specific commodity not in the data, say it is not currently listed.
- Format prices with 2 decimal places and include units where relevant (e.g., USD/MT for metric tonnes).
- For trading advice, always note that past performance does not guarantee future results.
- If asked about platform features (how to place an order, KYC, etc.), explain clearly.
- Keep responses under 300 words unless a detailed breakdown is explicitly requested.
- Do not make up prices or data not present in the context above.`;

      const messages = [
        { role: "system" as const, content: systemPrompt },
        ...input.history.map((h) => ({
          role: h.role as "user" | "assistant",
          content: h.content,
        })),
        { role: "user" as const, content: input.question },
      ];

      try {
        const response = await invokeLLM({ messages });
        const rawAnswer = response?.choices?.[0]?.message?.content;
        const answer: string = typeof rawAnswer === "string"
          ? rawAnswer
          : Array.isArray(rawAnswer)
            ? (rawAnswer as Array<{ text?: string }>).map((c) => c.text ?? "").join("")
            : "I was unable to generate a response. Please try again.";
        return { answer, timestamp: new Date().toISOString() };
      } catch {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Market assistant is temporarily unavailable.",
        });
      }
    }),

  /**
   * Get suggested questions based on current market conditions.
   */
  suggestions: publicProcedure.query(async () => {
    const db = await getDb();
    const symbols: string[] = [];
    if (db) {
      try {
        const rows = await db
          .select({ symbol: livePrices.symbol })
          .from(livePrices)
          .orderBy(desc(livePrices.updatedAt))
          .limit(5);
        symbols.push(...rows.map((r) => r.symbol));
      } catch {
        // fallback
      }
    }
    const defaults = symbols.length > 0 ? symbols : ["MAIZE", "WHEAT", "SOYBEAN", "RICE", "COFFEE"];
    return [
      `What is the current price of ${defaults[0]}?`,
      `How has ${defaults[1] ?? "WHEAT"} been trading in the last 24 hours?`,
      `What are the top trending commodities today?`,
      `What is the price range for ${defaults[2] ?? "SOYBEAN"} today?`,
      `How do I place a limit order on NEXCOM?`,
      `What commodities are available on the exchange?`,
    ];
  }),
});
