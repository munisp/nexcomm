import { z } from "zod";
import { timingSafeEqual } from "crypto";
import { protectedProcedure, publicProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { notifications, priceAlerts, pushTokens } from "../../drizzle/schema";
import { eq, and, desc } from "drizzle-orm";
import { TRPCError } from "@trpc/server";

// ─── Expo Push Notification Helper ───────────────────────────
interface ExpoPushMessage {
  to: string; title: string; body: string;
  data?: Record<string, unknown>; sound?: string; channelId?: string; priority?: string;
}
async function sendExpoPushNotification(messages: ExpoPushMessage[]): Promise<void> {
  try {
    await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(messages),
    });
  } catch (err) {
    console.error('[Expo Push] Failed:', err);
  }
}

export const notificationsRouter = router({
  // LIST notifications for current user
  list: protectedProcedure
    .input(z.object({
      page: z.number().min(1).default(1),
      limit: z.number().min(1).max(100).default(20),
      unreadOnly: z.boolean().default(false),
    }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) return { notifications: [], total: 0, unreadCount: 0 };
      const offset = (input.page - 1) * input.limit;

      const items = await db.select().from(notifications)
        .where(
          input.unreadOnly
            ? and(eq(notifications.userId, ctx.user.id), eq(notifications.read, false))
            : eq(notifications.userId, ctx.user.id)
        )
        .orderBy(desc(notifications.createdAt))
        .limit(input.limit)
        .offset(offset);

      // Count unread
      const allForUser = await db.select().from(notifications)
        .where(and(eq(notifications.userId, ctx.user.id), eq(notifications.read, false)));

      return { notifications: items, total: items.length, unreadCount: allForUser.length };
    }),

  // GET unread count only (for badge)
  unreadCount: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) return 0;
    const result = await db.select().from(notifications)
      .where(and(eq(notifications.userId, ctx.user.id), eq(notifications.read, false)));
    return result.length;
  }),

  // MARK single notification as read
  markRead: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
      await db.update(notifications)
        .set({ read: true })
        .where(and(eq(notifications.id, input.id), eq(notifications.userId, ctx.user.id)));
      return { success: true };
    }),

  // MARK ALL notifications as read
  markAllRead: protectedProcedure.mutation(async ({ ctx }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
    await db.update(notifications)
      .set({ read: true })
      .where(eq(notifications.userId, ctx.user.id));
    return { success: true };
  }),

  // DELETE a notification
  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
      await db.delete(notifications)
        .where(and(eq(notifications.id, input.id), eq(notifications.userId, ctx.user.id)));
      return { success: true };
    }),

  // DELETE ALL notifications for current user
  deleteAll: protectedProcedure.mutation(async ({ ctx }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
    await db.delete(notifications).where(eq(notifications.userId, ctx.user.id));
    return { success: true };
  }),

  // CREATE notification (admin only, or system)
  create: protectedProcedure
    .input(z.object({
      userId: z.number(),
      title: z.string().max(256),
      message: z.string(),
      type: z.enum(["TRADE", "SETTLEMENT", "KYC", "ALERT", "SYSTEM"]).default("SYSTEM"),
      metadata: z.record(z.string(), z.unknown()).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
      await db.insert(notifications).values({
        userId: input.userId,
        title: input.title,
        message: input.message,
        type: input.type,
        metadata: input.metadata ?? null,
      });
      return { success: true };
    }),

  // ─── Push Token Registration ────────────────────────────────

  /** Register an Expo push token for the authenticated user (persisted to DB). */
  registerPushToken: protectedProcedure
    .input(z.object({
      token: z.string().min(1),
      platform: z.enum(['ios', 'android', 'web']),
      deviceName: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) return { success: false };
      // Upsert: update token if already exists for this user+platform
      await db
        .insert(pushTokens)
        .values({
          userId: ctx.user.id,
          token: input.token,
          platform: input.platform as any,
          deviceName: input.deviceName ?? 'Unknown',
          isActive: true,
        })
        .onConflictDoUpdate({
          target: pushTokens.token,
          set: {
            userId: ctx.user.id,
            platform: input.platform as any,
            deviceName: input.deviceName ?? 'Unknown',
            isActive: true,
            updatedAt: new Date(),
          },
        });
      return { success: true };
    }),

  /** Unregister a push token on logout (marks inactive in DB). */
  unregisterPushToken: protectedProcedure
    .input(z.object({ token: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) return { success: false };
      await db
        .update(pushTokens)
        .set({ isActive: false, updatedAt: new Date() })
        .where(and(eq(pushTokens.token, input.token), eq(pushTokens.userId, ctx.user.id)));
      return { success: true };
    }),

  // ─── Price Alerts ───────────────────────────────────────────

  /** List all price alerts for the current user. */
  listAlerts: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) return [];
    return db.select().from(priceAlerts).where(eq(priceAlerts.userId, ctx.user.id));
  }),

  /** Create a new price alert. */
  createAlert: protectedProcedure
    .input(z.object({
      symbol: z.string().min(1).max(20),
      condition: z.enum(['ABOVE', 'BELOW', 'CROSS_ABOVE', 'CROSS_BELOW']),
      targetPrice: z.number().positive(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Database unavailable' });
      const [alert] = await db
        .insert(priceAlerts)
        .values({
          userId: ctx.user.id,
          symbol: input.symbol,
          condition: input.condition as any,
          targetPrice: String(input.targetPrice),
          triggered: false,
          notified: false,
        })
        .returning({ id: priceAlerts.id });
      return { id: alert?.id, success: true };
    }),

  /** Delete a price alert. */
  deleteAlert: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Database unavailable' });
      const [existing] = await db.select().from(priceAlerts)
        .where(and(eq(priceAlerts.id, input.id), eq(priceAlerts.userId, ctx.user.id)));
      if (!existing) throw new TRPCError({ code: 'NOT_FOUND', message: 'Alert not found' });
      await db.delete(priceAlerts).where(eq(priceAlerts.id, input.id));
      return { success: true };
    }),

  /** Internal: evaluate active alerts against current prices and send push notifications. */
  evaluateAlerts: publicProcedure
    .input(z.object({
      prices: z.record(z.string(), z.number()),
      secret: z.string(),
    }))
    .mutation(async ({ input }) => {
      const expectedSecret = process.env.INTERNAL_JOB_SECRET;
      if (!expectedSecret || expectedSecret.length < 32) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'INTERNAL_JOB_SECRET env var must be at least 32 characters' });
      }
      // Timing-safe comparison to prevent timing attacks
      const a = Buffer.from(input.secret);
      const b = Buffer.from(expectedSecret);
      const match = a.length === b.length && timingSafeEqual(a, b);
      if (!match) throw new TRPCError({ code: 'UNAUTHORIZED' });
      const db = await getDb();
      if (!db) return { triggered: 0, alertIds: [] };

      const activeAlerts = await db.select().from(priceAlerts)
        .where(eq(priceAlerts.triggered, false));

      const triggeredIds: number[] = [];
      for (const alert of activeAlerts) {
        const currentPrice = input.prices[alert.symbol];
        if (currentPrice === undefined) continue;
        const target = parseFloat(String(alert.targetPrice));
        let shouldTrigger = false;
        if (alert.condition === 'ABOVE' || alert.condition === 'CROSS_ABOVE') shouldTrigger = currentPrice >= target;
        else if (alert.condition === 'BELOW' || alert.condition === 'CROSS_BELOW') shouldTrigger = currentPrice <= target;
        if (!shouldTrigger) continue;

        const direction = (alert.condition === 'ABOVE' || alert.condition === 'CROSS_ABOVE') ? '▲' : '▼';
        // Look up all active push tokens for this user
        const userTokens = await db.select().from(pushTokens)
          .where(and(eq(pushTokens.userId, alert.userId), eq(pushTokens.isActive, true)));
        if (userTokens.length === 0) continue; // no registered devices
        const messages = userTokens.map(t => ({
          to: t.token,
          title: `${alert.symbol} Price Alert 🔔`,
          body: `${alert.symbol} is now ₦${currentPrice.toLocaleString()} ${direction} your target of ₦${target.toLocaleString()}`,
          data: { type: 'PRICE_ALERT', symbol: alert.symbol, currentPrice, targetPrice: target },
          sound: 'default', channelId: 'price-alerts', priority: 'high',
        }));
        await sendExpoPushNotification(messages);

        await db.update(priceAlerts)
          .set({ triggered: true, notified: true })
          .where(eq(priceAlerts.id, alert.id));
        triggeredIds.push(alert.id);
      }
      return { triggered: triggeredIds.length, alertIds: triggeredIds };
    }),
});
