/**
 * NEXCOM Exchange — AI Market Copilot Router (INNOV-A / Innovation 5)
 *
 * Grounded assistant: every answer is built from REAL data assembled at
 * request time — live prices (livePrices table), 24h trade trends
 * (tradeFills), the caller's portfolio positions, and ml-platform price
 * forecasts for symbols mentioned in the question.
 *
 * Modes:
 *  - LLM mode: when LLM_API_KEY (or OPENAI_API_KEY) is configured, the
 *    grounding context is passed to an OpenAI-compatible endpoint
 *    (LLM_BASE_URL / LLM_MODEL) with a domain-constrained system prompt that
 *    forbids inventing numbers.
 *  - Rules mode: WITHOUT a key, a deterministic answer is composed from the
 *    same grounding data — never a fabricated generic answer. Responses carry
 *    mode="rules" so the UI can badge them.
 *
 * Rate limiting: in-memory per-user token bucket (5 burst, 1 refill / 5s).
 * Audit: each query is logged via writeAuditLog (action ASSISTANT_QUERY).
 */
import { z } from "zod";
import { protectedProcedure, publicProcedure, router } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import { invokeLLM } from "../_core/llm";
import { getDb } from "../db";
import { livePrices, tradeFills, positions } from "../../drizzle/schema";
import { desc, sql, gte, eq } from "drizzle-orm";
import { COMMODITIES } from "../../shared/commodities";
import { writeAuditLog } from "../audit";
import { fetchPriceForecast, type PriceForecast } from "./forecastRouter";

// ─── Rate limiting (per-user in-memory token bucket) ─────────────────────────
const BUCKET_CAPACITY = 5;
const REFILL_INTERVAL_MS = 5_000;
const buckets = new Map<string, { tokens: number; lastRefill: number }>();

function takeToken(userId: string): boolean {
  const now = Date.now();
  let b = buckets.get(userId);
  if (!b) {
    b = { tokens: BUCKET_CAPACITY, lastRefill: now };
    buckets.set(userId, b);
  }
  const refill = Math.floor((now - b.lastRefill) / REFILL_INTERVAL_MS);
  if (refill > 0) {
    b.tokens = Math.min(BUCKET_CAPACITY, b.tokens + refill);
    b.lastRefill = now;
  }
  if (b.tokens <= 0) return false;
  b.tokens -= 1;
  return true;
}

// ─── Grounding context assembly ───────────────────────────────────────────────

interface GroundingSource {
  kind: "live-prices" | "trade-trends" | "portfolio" | "ml-forecast";
  detail: string;
}

interface GroundingContext {
  marketLines: string[];
  trendLines: string[];
  portfolioLines: string[];
  forecasts: PriceForecast[];
  mentionedSymbols: string[];
  pricesBySymbol: Map<string, { price: number; changePct: number | null; currency: string; name: string }>;
  sources: GroundingSource[];
}

/** Detect commodity symbols mentioned in free text (symbol or name match). */
function detectSymbols(question: string): string[] {
  const q = question.toUpperCase();
  const hits: string[] = [];
  for (const c of COMMODITIES) {
    if (q.includes(c.symbol.toUpperCase())) {
      hits.push(c.symbol);
      continue;
    }
    // Name match on any significant word (e.g. "maize", "sorghum").
    const words = c.name.toUpperCase().split(/[^A-Z]+/).filter((w) => w.length >= 4);
    if (words.some((w) => q.includes(w))) hits.push(c.symbol);
  }
  return [...new Set(hits)].slice(0, 3);
}

async function assembleGrounding(userId: number, question: string): Promise<GroundingContext> {
  const ctx: GroundingContext = {
    marketLines: [],
    trendLines: [],
    portfolioLines: [],
    forecasts: [],
    mentionedSymbols: detectSymbols(question),
    pricesBySymbol: new Map(),
    sources: [],
  };

  const db = await getDb();
  if (db) {
    // Live prices (top 20 by recency) — same source as livePricesRouter.
    try {
      const prices = await db
        .select({
          symbol: livePrices.symbol,
          name: livePrices.name,
          price: livePrices.price,
          changePct: livePrices.changePct,
          currency: livePrices.currency,
        })
        .from(livePrices)
        .orderBy(desc(livePrices.updatedAt))
        .limit(20);
      for (const p of prices) {
        const price = Number(p.price);
        const changePct = p.changePct != null ? Number(p.changePct) : null;
        ctx.pricesBySymbol.set(p.symbol, { price, changePct, currency: p.currency ?? "NGN", name: p.name ?? p.symbol });
        ctx.marketLines.push(
          `${p.symbol} (${p.name}): ${price} ${p.currency ?? "NGN"}, 24h change ${changePct != null ? changePct + "%" : "n/a"}`,
        );
      }
      if (prices.length > 0) ctx.sources.push({ kind: "live-prices", detail: `${prices.length} live prices` });
    } catch { /* non-fatal */ }

    // 24h trade trends by symbol.
    try {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const trends = await db
        .select({
          symbol: tradeFills.symbol,
          tradeCount: sql<number>`count(*)::int`,
          avgPrice: sql<number>`avg(${tradeFills.fillPrice})::numeric`,
        })
        .from(tradeFills)
        .where(gte(tradeFills.createdAt, since))
        .groupBy(tradeFills.symbol)
        .orderBy(desc(sql`count(*)`))
        .limit(10);
      for (const t of trends) {
        ctx.trendLines.push(
          `${t.symbol}: ${t.tradeCount} trades in 24h, avg fill ${Number(t.avgPrice).toFixed(2)}`,
        );
      }
      if (trends.length > 0) ctx.sources.push({ kind: "trade-trends", detail: "24h trade fills" });
    } catch { /* non-fatal */ }

    // Caller's portfolio positions.
    try {
      const pos = await db.select().from(positions).where(eq(positions.userId, userId));
      for (const p of pos) {
        ctx.portfolioLines.push(
          `${p.symbol}: qty ${Number(p.quantity)}, avg cost ${Number(p.avgCost)}, realized PnL ${Number(p.realizedPnl)}`,
        );
      }
      if (pos.length > 0) ctx.sources.push({ kind: "portfolio", detail: `${pos.length} open positions` });
    } catch { /* non-fatal */ }
  }

  // ml-platform forecasts for mentioned symbols (best effort, 800ms each).
  for (const symbol of ctx.mentionedSymbols.slice(0, 2)) {
    const f = await fetchPriceForecast(symbol, 7);
    if (f && f.expectedPrice != null && f.ci95) {
      ctx.forecasts.push(f);
    }
  }
  if (ctx.forecasts.length > 0) {
    ctx.sources.push({ kind: "ml-forecast", detail: `ml-platform ${ctx.forecasts[0].modelVersion}` });
  }

  return ctx;
}

// ─── Rules-mode answer (deterministic, grounded, no LLM) ─────────────────────

function rulesModeAnswer(g: GroundingContext, question: string): string {
  const parts: string[] = [];

  if (g.mentionedSymbols.length > 0) {
    for (const sym of g.mentionedSymbols) {
      const p = g.pricesBySymbol.get(sym);
      const f = g.forecasts.find((x) => x.symbol === sym);
      if (p) {
        const chg = p.changePct != null ? `${p.changePct > 0 ? "up" : p.changePct < 0 ? "down" : "flat"} ${Math.abs(p.changePct).toFixed(1)}% today` : "no 24h change data";
        parts.push(`${sym} is ${chg} at ${p.currency} ${p.price.toLocaleString(undefined, { maximumFractionDigits: 2 })}.`);
      } else {
        parts.push(`I don't have a live price for ${sym} right now.`);
      }
      if (f && f.expectedPrice != null && f.ci95) {
        parts.push(
          `The 7-day model forecast (${f.modelVersion}) expects ≈${f.expectedPrice.toLocaleString(undefined, { maximumFractionDigits: 2 })} with a 95% band of ${f.ci95[0].toLocaleString(undefined, { maximumFractionDigits: 2 })}–${f.ci95[1].toLocaleString(undefined, { maximumFractionDigits: 2 })}.`,
        );
      }
      const exposure = g.portfolioLines.find((l) => l.startsWith(sym));
      if (exposure) parts.push(`Your exposure: ${exposure}.`);
    }
  } else if (g.marketLines.length > 0) {
    // No symbol mentioned → market overview from real movers.
    const movers = [...g.pricesBySymbol.entries()]
      .filter(([, v]) => v.changePct != null)
      .sort((a, b) => Math.abs(b[1].changePct!) - Math.abs(a[1].changePct!))
      .slice(0, 3);
    if (movers.length > 0) {
      parts.push("Top movers today: " + movers
        .map(([s, v]) => `${s} ${v.changePct! > 0 ? "+" : ""}${v.changePct!.toFixed(1)}% at ${v.currency} ${v.price.toLocaleString(undefined, { maximumFractionDigits: 2 })}`)
        .join("; ") + ".");
    } else {
      parts.push(`Tracking ${g.marketLines.length} commodities live; no 24h change data to rank movers yet.`);
    }
    if (g.trendLines.length > 0) parts.push(`Most traded (24h): ${g.trendLines[0]}.`);
  } else {
    parts.push("Live market data is currently unavailable, so I cannot quote prices. Please try again shortly.");
  }

  parts.push("(Rules mode — no LLM key configured; answers are composed deterministically from live exchange data. Not investment advice.)");
  void question;
  return parts.join(" ");
}

// ─── Router ───────────────────────────────────────────────────────────────────

export const marketAssistantRouter = router({
  /**
   * Ask the copilot a question. Grounded in live prices, trade trends, the
   * caller's portfolio, and ml-platform forecasts. LLM mode when a key is
   * configured; deterministic rules mode otherwise.
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
      const userKey = String(ctx.user.id);
      if (!takeToken(userKey)) {
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: "Rate limit: please wait a few seconds between copilot questions.",
        });
      }

      const grounding = await assembleGrounding(ctx.user.id, input.question);
      const llmConfigured = Boolean(process.env.LLM_API_KEY || process.env.OPENAI_API_KEY);

      let answer: string;
      let mode: "llm" | "rules";

      if (!llmConfigured) {
        mode = "rules";
        answer = rulesModeAnswer(grounding, input.question);
      } else {
        mode = "llm";
        const forecastLines = grounding.forecasts.map(
          (f) =>
            `${f.symbol} 7d forecast (${f.modelVersion}): expected ${f.expectedPrice}, 95% band ${f.ci95?.[0]}–${f.ci95?.[1]}`,
        );
        const systemPrompt = `You are the NEXCOM Market Copilot for a Nigerian commodity exchange (maize, sorghum, soybeans, sesame, cocoa, cotton, ginger, groundnut, paddy rice, etc.).
Answer ONLY about Nigerian/African commodity markets, exchange trading, and the user's portfolio. Decline unrelated topics politely.
Use ONLY the numbers in the grounding context below — cite them explicitly. NEVER invent prices, statistics, or forecasts.

GROUNDING CONTEXT (as of ${new Date().toISOString()}):
LIVE PRICES:
${grounding.marketLines.join("\n") || "unavailable"}
24H TRADE TRENDS:
${grounding.trendLines.join("\n") || "unavailable"}
USER PORTFOLIO:
${grounding.portfolioLines.join("\n") || "no open positions"}
ML FORECASTS:
${forecastLines.join("\n") || "no forecast for mentioned symbols"}

RULES:
- Keep answers under 250 words, plain language, ₦/USD with 2 decimals.
- End with "Not investment advice." when discussing price direction.
- If the data needed is not in the context, say so honestly.`;

        try {
          const response = await invokeLLM({
            messages: [
              { role: "system", content: systemPrompt },
              ...input.history.map((h) => ({ role: h.role as "user" | "assistant", content: h.content })),
              { role: "user", content: input.question },
            ],
          });
          const raw = response?.choices?.[0]?.message?.content;
          answer =
            typeof raw === "string"
              ? raw
              : Array.isArray(raw)
                ? (raw as Array<{ text?: string }>).map((c) => c.text ?? "").join("")
                : "";
          if (!answer) throw new Error("empty LLM response");
        } catch {
          // Honest degradation: fall back to rules mode rather than a 500 or a
          // fabricated answer, and SAY we degraded.
          mode = "rules";
          answer =
            "(LLM endpoint unreachable — answering in rules mode from live data.)\n\n" +
            rulesModeAnswer(grounding, input.question);
        }
      }

      // Audit trail (non-blocking).
      void writeAuditLog({
        userId: ctx.user.id,
        action: "ASSISTANT_QUERY",
        resource: "market_assistant",
        details: {
          mode,
          symbols: grounding.mentionedSymbols,
          sources: grounding.sources.map((s) => s.kind),
          questionLen: input.question.length,
        },
      }).catch(() => {});

      return {
        answer,
        mode,
        sources: grounding.sources,
        modelVersion: grounding.forecasts[0]?.modelVersion ?? null,
        timestamp: new Date().toISOString(),
      };
    }),

  /**
   * Suggested questions based on current live market data.
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
        // fallback below
      }
    }
    const defaults = symbols.length > 0 ? symbols : ["MAIZE", "SORGHUM", "SOYBEANS", "PADDY RICE", "SESAME"];
    return [
      `What is the current price of ${defaults[0]}?`,
      `How has ${defaults[1] ?? "SORGHUM"} been trading in the last 24 hours?`,
      `What are the top trending commodities today?`,
      `What is the 7-day forecast for ${defaults[2] ?? "SOYBEANS"}?`,
      `What is my current exposure?`,
      `How do I place a limit order on NEXCOM?`,
    ];
  }),
});
