/**
 * NEXCOM Exchange — Price Alerts tRPC Router
 * Handles create, list, delete, and server-side price polling with notifyOwner triggers.
 * Prices come from the livePrices table (populated by priceFeedJob) — no Math.random().
 */
import { z } from "zod";
import { eq, and, desc, inArray } from "drizzle-orm";
import { protectedProcedure, publicProcedure, router } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import { getDb } from "../db";
import { priceAlerts, livePrices } from "../../drizzle/schema";
import { notifyOwner } from "../_core/notification";
import { createNotification } from "../db";
import { pushToUser } from "./pushNotificationsRouter";
import { FX_PAIRS, EQUITIES, CRYPTO_ASSETS, type FxPair, type Equity, type CryptoAsset } from "../../shared/instruments";
import { COMMODITIES } from "../../shared/commodities";
import { writeAuditLog } from "../audit";
import { smartAlertCheck } from "./forecastRouter";
import { measureDb } from "../_core/perfMiddleware";

// ============================================================
// Helpers
// ============================================================

/** Deterministic base price from shared instrument catalogues (no DB, no randomness). */
function basePriceFor(symbol: string): number | null {
  const commodity = COMMODITIES.find(c => c.symbol === symbol);
  if (commodity) return commodity.basePrice;
  const fxInstrument = FX_PAIRS.find((i: FxPair) => i.symbol === symbol);
  if (fxInstrument) return fxInstrument.basePrice;
  const equity = EQUITIES.find((i: Equity) => i.symbol === symbol);
  if (equity) return equity.basePrice;
  const crypto = CRYPTO_ASSETS.find((i: CryptoAsset) => i.symbol === symbol);
  if (crypto) return crypto.basePrice;
  return null;
}

/** Get the current price for a symbol from the livePrices table, falling back to base price */
async function getCurrentPrice(symbol: string): Promise<number | null> {
  // Try live prices table first (populated by priceFeedJob)
  try {
    const db = await getDb();
    if (db) {
      const rows = await db.select().from(livePrices).where(eq(livePrices.symbol, symbol)).limit(1);
      if (rows.length > 0 && rows[0].price) return Number(rows[0].price);
    }
  } catch {
    // fall through to base price
  }
  return basePriceFor(symbol);
}

/**
 * Batch-fetch current prices for many symbols in ONE inArray query, falling
 * back to catalogue base prices for symbols missing from live_prices.
 *
 * N+1 fix: the polling job and nearTriggerCount previously issued one SELECT
 * per alert symbol; with N active alerts that was N round-trips every 30s.
 */
async function getCurrentPrices(symbols: string[]): Promise<Map<string, number | null>> {
  const prices = new Map<string, number | null>();
  const distinct = [...new Set(symbols)];
  if (distinct.length === 0) return prices;
  try {
    const db = await getDb();
    if (db) {
      const rows = await measureDb("priceAlerts.batchPrices", () =>
        db
          .select({ symbol: livePrices.symbol, price: livePrices.price })
          .from(livePrices)
          .where(inArray(livePrices.symbol, distinct)));
      for (const row of rows) {
        if (row.price) prices.set(row.symbol, Number(row.price));
      }
    }
  } catch {
    // fall through to base prices
  }
  for (const symbol of distinct) {
    if (!prices.has(symbol)) prices.set(symbol, basePriceFor(symbol));
  }
  return prices;
}

// ============================================================
// Server-side polling job — checks alerts every 30 seconds
// ============================================================

let pollingInterval: ReturnType<typeof setInterval> | null = null;

export function startAlertPollingJob() {
  if (pollingInterval) return; // Already running
  pollingInterval = setInterval(async () => {
    const db = await getDb();
    if (!db) return;
    try {
      // Get all untriggered alerts
      const activeAlerts = await db
        .select()
        .from(priceAlerts)
        .where(and(
          eq(priceAlerts.triggered, false),
          eq(priceAlerts.notified, false)
        ));

      // ONE batch query for all alert symbols (was: one SELECT per alert)
      const prices = await getCurrentPrices(activeAlerts.map(a => a.symbol));

      for (const alert of activeAlerts) {
        const currentPrice = prices.get(alert.symbol) ?? null;
        if (currentPrice === null) continue;

        const target = parseFloat(alert.targetPrice);
        let triggered = false;

        if (alert.condition === "ABOVE" && currentPrice >= target) triggered = true;
        if (alert.condition === "BELOW" && currentPrice <= target) triggered = true;
        if (alert.condition === "CROSS_ABOVE" && currentPrice >= target) triggered = true;
        if (alert.condition === "CROSS_BELOW" && currentPrice <= target) triggered = true;

        if (triggered) {
          // Mark as triggered and notified
          await db
            .update(priceAlerts)
            .set({ triggered: true, notified: true })
            .where(eq(priceAlerts.id, alert.id));

          const conditionText = alert.condition.replace("_", " ").toLowerCase();
          const priceStr = currentPrice.toLocaleString(undefined, { maximumFractionDigits: 6 });
          const targetStr = target.toLocaleString(undefined, { maximumFractionDigits: 6 });

          // ── Smart alert: attach ML forecast context (never blocks notification) ─────────────
          const forecastCtx = await smartAlertCheck(
            alert.symbol, target, alert.condition,
          ).catch(() => null);
          const forecastSuffix = forecastCtx?.available && forecastCtx.assessment
            ? `\nForecast: ${forecastCtx.assessment}`
            : "";
          const forecastMetadata = forecastCtx?.available
            ? {
                forecast: {
                  expectedPrice: forecastCtx.expectedPrice,
                  ci95: forecastCtx.ci95,
                  modelVersion: forecastCtx.modelVersion,
                },
              }
            : {};

          // ── In-app notification for the alert owner ─────────────────────────────────────────
          await createNotification({
            userId: alert.userId,
            type: "ALERT",
            title: `🔔 Price Alert: ${alert.symbol}`,
            message: `${alert.symbol} is ${conditionText} ${targetStr} — now at ${priceStr}${forecastSuffix}`,
            metadata: { link: "/alerts", symbol: alert.symbol, triggeredPrice: currentPrice, ...forecastMetadata },
          }).catch(e => console.warn("[PriceAlerts] In-app notification failed:", (e as Error).message));

          // ── Browser Push: notify the trader directly ─────────────────────────────────────────
          pushToUser(
            alert.userId,
            {
              title: `🔔 Price Alert: ${alert.symbol}`,
              body: `${alert.symbol} is ${conditionText} ${targetStr} — now at ${priceStr}${forecastSuffix}`,
              url: "/alerts",
              tag: `price-alert-${alert.id}`,
            },
            "priceAlerts",
          ).catch(e => console.warn("[PriceAlerts] Push failed:", (e as Error).message));

          // ── Owner notification (operational audit trail) ───────────────────────────
          await notifyOwner({
            title: `🔔 Price Alert Triggered: ${alert.symbol}`,
            content: `Alert for ${alert.symbol} triggered!\n\nCondition: Price ${conditionText} ${targetStr}\nCurrent Price: ${priceStr}\n\nAlert ID: ${alert.id} | User ID: ${alert.userId}`,
          });
        }
      }
    } catch (err) {
      console.error("[PriceAlerts] Polling job error:", err);
    }
  }, 30_000); // Check every 30 seconds

  console.log("[PriceAlerts] Polling job started (30s interval)");
}

// ============================================================
// Router
// ============================================================

export const priceAlertsRouter = router({
  /** List all active (untriggered) alerts for the current user */
  list: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) return { active: [], triggered: [] };

    const userId = ctx.user.id;
    const all = await db
      .select()
      .from(priceAlerts)
      .where(eq(priceAlerts.userId, userId))
      .orderBy(desc(priceAlerts.createdAt));

    return {
      active: all.filter(a => !a.triggered),
      triggered: all.filter(a => a.triggered),
    };
  }),

  /** Create a new price alert */
  create: protectedProcedure
    .input(z.object({
      symbol: z.string().min(1).max(32),
      condition: z.enum(["ABOVE", "BELOW", "CROSS_ABOVE", "CROSS_BELOW"]),
      targetPrice: z.number().positive(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });

      const userId = ctx.user.id;

      // Check for duplicate active alert on same symbol + condition
      const existing = await db
        .select()
        .from(priceAlerts)
        .where(and(
          eq(priceAlerts.userId, userId),
          eq(priceAlerts.symbol, input.symbol),
          eq(priceAlerts.condition, input.condition),
          eq(priceAlerts.triggered, false)
        ))
        .limit(1);

      if (existing.length > 0) {
        throw new TRPCError({ code: "CONFLICT", message: `You already have an active ${input.condition} alert for ${input.symbol}` });
      }

      const [created] = await db
        .insert(priceAlerts)
        .values({
          userId,
          symbol: input.symbol,
          condition: input.condition,
          targetPrice: String(input.targetPrice),
          triggered: false,
          notified: false,
        })
        .returning();

      return created;
    }),

  /** Delete multiple price alerts at once (only the owner can delete) */
  deleteMany: protectedProcedure
    .input(z.object({ ids: z.array(z.number()).min(1).max(100) }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
      const userId = ctx.user.id;
      // Verify ownership of all alerts before deleting
      const owned = await db
        .select({ id: priceAlerts.id })
        .from(priceAlerts)
        .where(and(eq(priceAlerts.userId, userId)));
      const ownedIds = new Set(owned.map(r => r.id));
      const toDelete = input.ids.filter(id => ownedIds.has(id));
      if (toDelete.length === 0) throw new TRPCError({ code: "NOT_FOUND", message: "No matching alerts found" });
      await db.delete(priceAlerts).where(inArray(priceAlerts.id, toDelete));
      return { deleted: toDelete.length };
    }),

  /** Count active (untriggered) alerts grouped by symbol — used for Watchlist bell badge */
  countBySymbols: protectedProcedure
    .input(z.object({ symbols: z.array(z.string().trim()) }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) return {} as Record<string, number>;
      if (input.symbols.length === 0) return {} as Record<string, number>;
      const rows = await db
        .select()
        .from(priceAlerts)
        .where(
          and(
            eq(priceAlerts.userId, ctx.user.id),
            eq(priceAlerts.triggered, false),
            inArray(priceAlerts.symbol, input.symbols)
          )
        );
      const counts: Record<string, number> = {};
      for (const row of rows) {
        counts[row.symbol] = (counts[row.symbol] ?? 0) + 1;
      }
      return counts;
    }),

  /** Update an existing price alert (target price and/or condition) */
  update: protectedProcedure
    .input(z.object({
      id: z.number().int().positive(),
      condition: z.enum(["ABOVE", "BELOW", "CROSS_ABOVE", "CROSS_BELOW"]).optional(),
      targetPrice: z.number().positive().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
            if (!db) throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "Database unavailable" });
      // Verify ownership
      const [existing] = await db
        .select()
        .from(priceAlerts)
        .where(and(eq(priceAlerts.id, input.id), eq(priceAlerts.userId, ctx.user.id)))
        .limit(1);
      if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "Alert not found" });
      const updates: Record<string, unknown> = {};
      if (input.condition !== undefined) updates.condition = input.condition;
      if (input.targetPrice !== undefined) updates.targetPrice = String(input.targetPrice);
      if (Object.keys(updates).length === 0) return existing;
      const [updated] = await db
        .update(priceAlerts)
        .set(updates)
        .where(eq(priceAlerts.id, input.id))
        .returning();
      return updated;
    }),

  /** Delete a price alert (only the owner can delete) */
  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });

      const userId = ctx.user.id;

      const [alert] = await db
        .select()
        .from(priceAlerts)
        .where(and(eq(priceAlerts.id, input.id), eq(priceAlerts.userId, userId)))
        .limit(1);

      if (!alert) throw new TRPCError({ code: "NOT_FOUND", message: "Alert not found or not authorized" });

      await db.delete(priceAlerts).where(eq(priceAlerts.id, input.id));
      return { success: true };
    }),

  /** Get current price for a symbol from livePrices table (for the create form preview) */
  currentPrice: publicProcedure
    .input(z.object({ symbol: z.string().trim() }))
    .query(async ({ input }) => {
      const price = await getCurrentPrice(input.symbol);
      return { symbol: input.symbol, price };
    }),

  /**
   * Count active alerts that are within `thresholdPct` (default 2%) of their
   * target price. Used by the nav badge to warn traders of imminent triggers.
   */
  nearTriggerCount: protectedProcedure
    .input(z.object({ thresholdPct: z.number().min(0).max(50).default(2) }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) return { count: 0 };
      const active = await db
        .select()
        .from(priceAlerts)
        .where(
          and(
            eq(priceAlerts.userId, ctx.user.id),
            eq(priceAlerts.triggered, false)
          )
        );
      const threshold = input.thresholdPct / 100;
      // ONE batch query for all alert symbols (was: one SELECT per alert)
      const prices = await getCurrentPrices(active.map(a => a.symbol));
      let count = 0;
      for (const alert of active) {
        const current = prices.get(alert.symbol) ?? null;
        if (current == null) continue;
        const target = Number(alert.targetPrice);
        const pctDiff = Math.abs(current - target) / target;
        if (pctDiff <= threshold) count++;
      }
      return { count };
    }),
});
