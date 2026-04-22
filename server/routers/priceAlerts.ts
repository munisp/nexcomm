/**
 * NEXCOM Exchange — Price Alerts tRPC Router
 * Handles create, list, delete, and server-side price polling with notifyOwner triggers.
 * Prices come from the livePrices table (populated by priceFeedJob) — no Math.random().
 */
import { z } from "zod";
import { eq, and, desc, inArray } from "drizzle-orm";
import { protectedProcedure, publicProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { priceAlerts, livePrices } from "../../drizzle/schema";
import { notifyOwner } from "../_core/notification";
import { createNotification } from "../db";
import { pushToUser } from "./pushNotificationsRouter";
import { FX_PAIRS, EQUITIES, CRYPTO_ASSETS, type FxPair, type Equity, type CryptoAsset } from "../../shared/instruments";
import { COMMODITIES } from "../../shared/commodities";

// ============================================================
// Helpers
// ============================================================

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
  // Fallback: use base price from shared instruments (deterministic, no randomness)
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

      for (const alert of activeAlerts) {
        const currentPrice = await getCurrentPrice(alert.symbol);
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
          // ── In-app notification for the alert owner ─────────────────────────────────────────
          await createNotification({
            userId: alert.userId,
            type: "ALERT",
            title: `🔔 Price Alert: ${alert.symbol}`,
            message: `${alert.symbol} is ${conditionText} ${targetStr} — now at ${priceStr}`,
            metadata: { link: "/alerts", symbol: alert.symbol, triggeredPrice: currentPrice },
          }).catch(e => console.warn("[PriceAlerts] In-app notification failed:", (e as Error).message));

          // ── Browser Push: notify the trader directly ─────────────────────────────────────────
          pushToUser(
            alert.userId,
            {
              title: `🔔 Price Alert: ${alert.symbol}`,
              body: `${alert.symbol} is ${conditionText} ${targetStr} — now at ${priceStr}`,
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
      if (!db) throw new Error("Database not available");

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
        throw new Error(`You already have an active ${input.condition} alert for ${input.symbol}`);
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
      if (!db) throw new Error("Database not available");
      const userId = ctx.user.id;
      // Verify ownership of all alerts before deleting
      const owned = await db
        .select({ id: priceAlerts.id })
        .from(priceAlerts)
        .where(and(eq(priceAlerts.userId, userId)));
      const ownedIds = new Set(owned.map(r => r.id));
      const toDelete = input.ids.filter(id => ownedIds.has(id));
      if (toDelete.length === 0) throw new Error("No matching alerts found");
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
      if (!db) throw new Error("DB unavailable");
      // Verify ownership
      const [existing] = await db
        .select()
        .from(priceAlerts)
        .where(and(eq(priceAlerts.id, input.id), eq(priceAlerts.userId, ctx.user.id)))
        .limit(1);
      if (!existing) throw new Error("Alert not found");
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
      if (!db) throw new Error("Database not available");

      const userId = ctx.user.id;

      const [alert] = await db
        .select()
        .from(priceAlerts)
        .where(and(eq(priceAlerts.id, input.id), eq(priceAlerts.userId, userId)))
        .limit(1);

      if (!alert) throw new Error("Alert not found or not authorized");

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
      let count = 0;
      for (const alert of active) {
        const current = await getCurrentPrice(alert.symbol);
        if (current == null) continue;
        const target = Number(alert.targetPrice);
        const pctDiff = Math.abs(current - target) / target;
        if (pctDiff <= threshold) count++;
      }
      return { count };
    }),
});
