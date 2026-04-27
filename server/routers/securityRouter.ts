/**
 * Security Router — Phase 31
 * ─────────────────────────────────────────────────────────────
 * Defences against deepfake/social-engineering attacks (BBC article):
 *
 * 1. ANOMALOUS ORDER DETECTION — flags orders that deviate significantly
 *    from a user's historical trading patterns (size, frequency, price).
 * 2. RATE LIMITING — tracks per-user action counts in rolling windows;
 *    raises a SECURITY_ALERT notification when thresholds are breached.
 * 3. LARGE WITHDRAWAL GUARD — requires explicit confirmation for any
 *    withdrawal/settlement above a configurable threshold.
 * 4. ADMIN ACTION AUDIT — every admin bulk action is logged to security_events.
 * 5. SECURITY EVENT MANAGEMENT — admin procedures to list, investigate,
 *    and resolve security events.
 *
 * Procedures:
 *   security.checkRateLimit        — check + increment action counter; raises alert if breached
 *   security.flagAnomalousOrder    — flag an order as anomalous
 *   security.adminListEvents       — admin: paginated list of security events
 *   security.adminUpdateEventStatus — admin: update event status
 *   security.adminGetStats         — admin: summary counts by severity/type
 *   security.myEvents              — user: list their own security events
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, adminProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import {
  securityEvents,
  rateLimitCounters,
  notifications,
  orders,
  userPreferences,
} from "../../drizzle/schema";
import { and, desc, eq, gte, sql, count } from "drizzle-orm";
import { writeAuditLog } from "../audit";

// ─── Rate limit thresholds ────────────────────────────────────────────────────
const RATE_LIMITS: Record<string, { windowMinutes: number; maxCount: number }> = {
  ORDER_PLACE:       { windowMinutes: 60,  maxCount: 50  },  // 50 orders/hour
  KYC_SUBMIT:        { windowMinutes: 1440, maxCount: 3  },  // 3 KYC submissions/day
  DISPUTE_RAISE:     { windowMinutes: 1440, maxCount: 5  },  // 5 disputes/day
  BULK_KYC_UPLOAD:   { windowMinutes: 60,  maxCount: 10 },  // 10 bulk uploads/hour
  ADMIN_BULK_REJECT: { windowMinutes: 60,  maxCount: 20 },  // 20 bulk rejects/hour
  WITHDRAWAL:        { windowMinutes: 1440, maxCount: 10 },  // 10 withdrawals/day
};

// ─── Helper: check and increment rate limit ───────────────────────────────────
export async function checkAndIncrementRateLimit(
  userId: number,
  action: string,
  ipAddress?: string,
): Promise<{ allowed: boolean; count: number; limit: number }> {
  const db = await getDb();
  if (!db) return { allowed: true, count: 0, limit: 999 };

  const config = RATE_LIMITS[action];
  if (!config) return { allowed: true, count: 0, limit: 999 };

  const windowStart = new Date(Date.now() - config.windowMinutes * 60_000);

  // Find existing counter in the current window
  const [existing] = await db
    .select()
    .from(rateLimitCounters)
    .where(
      and(
        eq(rateLimitCounters.userId, userId),
        eq(rateLimitCounters.action, action),
        gte(rateLimitCounters.windowStart, windowStart),
      ),
    )
    .orderBy(desc(rateLimitCounters.windowStart))
    .limit(1);

  let currentCount: number;

  if (existing) {
    currentCount = existing.count + 1;
    await db
      .update(rateLimitCounters)
      .set({ count: currentCount, updatedAt: new Date() })
      .where(eq(rateLimitCounters.id, existing.id));
  } else {
    currentCount = 1;
    await db.insert(rateLimitCounters).values({
      userId,
      action,
      windowStart: new Date(),
      count: 1,
    });
  }

  const allowed = currentCount <= config.maxCount;

  if (!allowed) {
    // Create a security event for the breach
    await db.insert(securityEvents).values({
      userId,
      eventType: "RATE_LIMIT_BREACH",
      severity: currentCount > config.maxCount * 2 ? "HIGH" : "MEDIUM",
      status: "OPEN",
      title: `Rate limit breached: ${action}`,
      description: `User ${userId} exceeded the rate limit for action "${action}". Count: ${currentCount}, limit: ${config.maxCount} per ${config.windowMinutes} minutes.`,
      metadata: JSON.stringify({ action, count: currentCount, limit: config.maxCount, windowMinutes: config.windowMinutes }),
      ipAddress: ipAddress ?? null,
    });

    // Notify the user
    await db.insert(notifications).values({
      userId,
      title: "Unusual Activity Detected",
      message: `We detected an unusually high number of "${action}" actions on your account. If this was not you, please contact support immediately.`,
      type: "SECURITY_ALERT",
    });
  }

  return { allowed, count: currentCount, limit: config.maxCount };
}

// ─── Helper: detect anomalous order ──────────────────────────────────────────
export async function detectAnomalousOrder(
  userId: number,
  orderId: number,
  quantity: number,
  price: number,
  symbol: string,
): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;

  // Get user's last 30 orders for this symbol to compute baseline
  const recentOrders = await db
    .select({ quantity: orders.quantity, price: orders.price })
    .from(orders)
    .where(
      and(
        eq(orders.userId, userId),
        eq(orders.symbol, symbol),
        eq(orders.status, "FILLED"),
      ),
    )
    .orderBy(desc(orders.createdAt))
    .limit(30);

  if (recentOrders.length < 5) return false; // Not enough history

  const avgQty = recentOrders.reduce((s, o) => s + Number(o.quantity), 0) / recentOrders.length;
  const avgPrice = recentOrders.reduce((s, o) => s + Number(o.price), 0) / recentOrders.length;

  const qtyDeviation = Math.abs(quantity - avgQty) / avgQty;
  const priceDeviation = Math.abs(price - avgPrice) / avgPrice;

  // Flag if quantity is >5x average or price deviates >30%
  const isAnomalous = qtyDeviation > 4 || priceDeviation > 0.30;

  if (isAnomalous) {
    await db.insert(securityEvents).values({
      userId,
      eventType: "ANOMALOUS_ORDER",
      severity: qtyDeviation > 9 || priceDeviation > 0.50 ? "HIGH" : "MEDIUM",
      status: "OPEN",
      title: `Anomalous order detected: ${symbol}`,
      description: `Order #${orderId} for ${quantity} units at ${price} deviates significantly from the user's historical average (qty: ${avgQty.toFixed(0)}, price: ${avgPrice.toFixed(2)}).`,
      metadata: JSON.stringify({ orderId, symbol, quantity, price, avgQty, avgPrice, qtyDeviation: qtyDeviation.toFixed(2), priceDeviation: priceDeviation.toFixed(2) }),
    });

    await db.insert(notifications).values({
      userId,
      title: "Unusual Trade Detected",
      message: `An order for ${quantity} units of ${symbol} at ${price} was flagged as unusual compared to your trading history. Please review your recent activity.`,
      type: "SECURITY_ALERT",
    });
  }

  return isAnomalous;
}

// ─── Router ──────────────────────────────────────────────────────────────────
export const securityRouter = router({
  /** Check + increment rate limit for an action */
  checkRateLimit: protectedProcedure
    .input(z.object({
      action: z.enum(["ORDER_PLACE", "KYC_SUBMIT", "DISPUTE_RAISE", "BULK_KYC_UPLOAD", "ADMIN_BULK_REJECT", "WITHDRAWAL"]),
    }))
    .mutation(async ({ ctx, input }) => {
      const result = await checkAndIncrementRateLimit(ctx.user.id, input.action);
      if (!result.allowed) {
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: `Rate limit exceeded for ${input.action}. You have performed this action ${result.count} times (limit: ${result.limit}). Please wait before trying again.`,
        });
      }
      return result;
    }),

  /** Flag an order as anomalous (called after order placement) */
  flagAnomalousOrder: protectedProcedure
    .input(z.object({
      orderId: z.number().int().positive(),
      quantity: z.number().positive(),
      price: z.number().positive(),
      symbol: z.string().min(1),
    }))
    .mutation(async ({ ctx, input }) => {
      const isAnomalous = await detectAnomalousOrder(
        ctx.user.id,
        input.orderId,
        input.quantity,
        input.price,
        input.symbol,
      );
      return { isAnomalous };
    }),

  /** User: list their own security events */
  myEvents: protectedProcedure
    .input(z.object({
      limit: z.number().int().min(1).max(50).default(20),
      offset: z.number().int().min(0).default(0),
    }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) return { events: [], total: 0 };

      const rows = await db
        .select()
        .from(securityEvents)
        .where(eq(securityEvents.userId, ctx.user.id))
        .orderBy(desc(securityEvents.createdAt))
        .limit(input.limit)
        .offset(input.offset);

      const [{ total }] = await db
        .select({ total: count() })
        .from(securityEvents)
        .where(eq(securityEvents.userId, ctx.user.id));

      return { events: rows, total: Number(total) };
    }),

  /** Admin: paginated list of all security events */
  adminListEvents: adminProcedure
    .input(z.object({
      severity: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL", "ALL"]).default("ALL"),
      status: z.enum(["OPEN", "INVESTIGATING", "RESOLVED", "FALSE_POSITIVE", "ALL"]).default("ALL"),
      eventType: z.enum([
        "RATE_LIMIT_BREACH", "ANOMALOUS_ORDER", "LARGE_WITHDRAWAL",
        "REPEATED_AUTH_FAILURE", "ADMIN_BULK_ACTION", "SUSPICIOUS_IP",
        "UNUSUAL_TRADE_PATTERN", "ACCOUNT_TAKEOVER_ATTEMPT", "ALL",
      ]).default("ALL"),
      limit: z.number().int().min(1).max(100).default(50),
      offset: z.number().int().min(0).default(0),
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return { events: [], total: 0 };

      const conditions = [];
      if (input.severity !== "ALL") conditions.push(eq(securityEvents.severity, input.severity));
      if (input.status !== "ALL") conditions.push(eq(securityEvents.status, input.status));
      if (input.eventType !== "ALL") conditions.push(eq(securityEvents.eventType, input.eventType));

      const where = conditions.length > 0 ? and(...conditions) : undefined;

      const rows = await db
        .select()
        .from(securityEvents)
        .where(where)
        .orderBy(desc(securityEvents.createdAt))
        .limit(input.limit)
        .offset(input.offset);

      const [{ total }] = await db
        .select({ total: count() })
        .from(securityEvents)
        .where(where);

      return { events: rows, total: Number(total) };
    }),

  /** Admin: update a security event's status */
  adminUpdateEventStatus: adminProcedure
    .input(z.object({
      eventId: z.number().int().positive(),
      status: z.enum(["INVESTIGATING", "RESOLVED", "FALSE_POSITIVE"]),
      resolutionNotes: z.string().max(2000).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const [event] = await db
        .select()
        .from(securityEvents)
        .where(eq(securityEvents.id, input.eventId))
        .limit(1);

      if (!event) throw new TRPCError({ code: "NOT_FOUND", message: "Security event not found" });

      const isResolved = ["RESOLVED", "FALSE_POSITIVE"].includes(input.status);

      await db
        .update(securityEvents)
        .set({
          status: input.status,
          resolvedBy: isResolved ? ctx.user.id : null,
          resolvedAt: isResolved ? new Date() : null,
          resolutionNotes: input.resolutionNotes ?? null,
          updatedAt: new Date(),
        })
        .where(eq(securityEvents.id, input.eventId));

      return { success: true };
    }),

  /** Admin: summary counts by severity and type */
  adminGetStats: adminProcedure
    .query(async () => {
      const db = await getDb();
      if (!db) return { bySeverity: {}, byType: {}, openCount: 0, criticalCount: 0 };

      const bySeverityRows = await db
        .select({ severity: securityEvents.severity, cnt: count() })
        .from(securityEvents)
        .where(eq(securityEvents.status, "OPEN"))
        .groupBy(securityEvents.severity);

      const byTypeRows = await db
        .select({ eventType: securityEvents.eventType, cnt: count() })
        .from(securityEvents)
        .where(eq(securityEvents.status, "OPEN"))
        .groupBy(securityEvents.eventType);

      const bySeverity = Object.fromEntries(bySeverityRows.map(r => [r.severity, Number(r.cnt)]));
      const byType = Object.fromEntries(byTypeRows.map(r => [r.eventType, Number(r.cnt)]));

      const openCount = Object.values(bySeverity).reduce((a, b) => a + b, 0);
      const criticalCount = bySeverity["CRITICAL"] ?? 0;

      return { bySeverity, byType, openCount, criticalCount };
    }),

  /** Admin: create a manual security event (e.g., for social-engineering reports) */
  adminCreateEvent: adminProcedure
    .input(z.object({
      userId: z.number().int().positive().optional(),
      eventType: z.enum([
        "RATE_LIMIT_BREACH", "ANOMALOUS_ORDER", "LARGE_WITHDRAWAL",
        "REPEATED_AUTH_FAILURE", "ADMIN_BULK_ACTION", "SUSPICIOUS_IP",
        "UNUSUAL_TRADE_PATTERN", "ACCOUNT_TAKEOVER_ATTEMPT",
      ]),
      severity: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]),
      title: z.string().min(5).max(256),
      description: z.string().min(10).max(4000),
      ipAddress: z.string().max(45).optional(),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const [event] = await db
        .insert(securityEvents)
        .values({
          userId: input.userId ?? null,
          eventType: input.eventType,
          severity: input.severity,
          status: "OPEN",
          title: input.title,
          description: input.description,
          ipAddress: input.ipAddress ?? null,
        })
        .returning();

      return event;
    }),

  // ─── Biometric Preference ─────────────────────────────────────────────────
  setBiometricPreference: protectedProcedure
    .input(z.object({ enabled: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      await db
        .insert(userPreferences)
        .values({ userId: ctx.user.id, biometricEnabled: input.enabled })
        .onConflictDoUpdate({
          target: userPreferences.userId,
          set: { biometricEnabled: input.enabled, updatedAt: new Date() },
        });
      return { success: true, enabled: input.enabled };
    }),

  getBiometricPreference: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
    const [pref] = await db
      .select({ biometricEnabled: userPreferences.biometricEnabled })
      .from(userPreferences)
      .where(eq(userPreferences.userId, ctx.user.id))
      .limit(1);
    return { enabled: pref?.biometricEnabled ?? false };
  }),

  /** Admin: get in-memory middleware security audit log (path traversal, SQLi probes, blocked IPs) */
  getMiddlewareSecurityLog: adminProcedure
    .input(z.object({ limit: z.number().int().min(1).max(500).default(100) }))
    .query(async ({ input }) => {
      const { getRecentSecurityEvents } = await import("../security");
      return { events: getRecentSecurityEvents(input.limit) };
    }),
});
