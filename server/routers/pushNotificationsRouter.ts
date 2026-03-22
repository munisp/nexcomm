/**
 * pushNotificationsRouter.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * tRPC router for Web Push API subscription management.
 *
 * Procedures:
 *   pushNotifications.subscribe        — save a PushSubscription from the browser
 *   pushNotifications.unsubscribe      — remove a subscription by endpoint
 *   pushNotifications.getMyDevices     — list all subscribed devices for the user
 *   pushNotifications.updatePrefs      — toggle per-topic notification preferences
 *   pushNotifications.sendTest         — send a test push to the user's devices (admin or self)
 *   pushNotifications.getVapidPublicKey — return the VAPID public key for the browser
 *
 * VAPID keys must be set as environment variables:
 *   VAPID_PUBLIC_KEY  — base64url-encoded 65-byte uncompressed EC public key
 *   VAPID_PRIVATE_KEY — base64url-encoded 32-byte EC private key
 *   VAPID_SUBJECT     — mailto: or https: URI identifying the sender
 *
 * If VAPID keys are not set, push sending is simulated (logged only).
 */

import { z } from "zod";
import { router, protectedProcedure, publicProcedure } from "../_core/trpc";
import { getDb } from "../db";
import { pushSubscriptions } from "../../drizzle/schema";
import { eq, and } from "drizzle-orm";
import { TRPCError } from "@trpc/server";

// ── VAPID config ──────────────────────────────────────────────────────────────

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY ?? "";
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY ?? "";
const VAPID_SUBJECT = process.env.VAPID_SUBJECT ?? "mailto:admin@nexcom.exchange";

/**
 * Send a Web Push notification to a single subscription endpoint.
 * Uses the `web-push` npm package if available; otherwise logs a simulation.
 */
async function sendWebPush(
  endpoint: string,
  p256dh: string,
  auth: string,
  payload: { title: string; body: string; url?: string; tag?: string },
): Promise<boolean> {
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    console.log(`[WebPush] SIMULATED push to ${endpoint.slice(0, 60)}... — ${payload.title}: ${payload.body}`);
    return true;
  }

  try {
    // Dynamically import web-push to avoid hard dependency at startup
    const webpush = await import("web-push").catch(() => null);
    if (!webpush) {
      console.warn("[WebPush] web-push package not installed. Run: pnpm add web-push");
      return false;
    }

    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

    await webpush.sendNotification(
      { endpoint, keys: { p256dh, auth } },
      JSON.stringify({
        title: payload.title,
        body: payload.body,
        url: payload.url ?? "/",
        tag: payload.tag ?? "nexcom",
        icon: "/icon-192.png",
        badge: "/icon-192.png",
      }),
    );
    return true;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    // 410 Gone means the subscription is no longer valid — caller should delete it
    if (message.includes("410") || message.includes("Gone")) {
      return false;
    }
    console.error("[WebPush] Send error:", message);
    return false;
  }
}

// ── Router ────────────────────────────────────────────────────────────────────

export const pushNotificationsRouter = router({
  /**
   * getVapidPublicKey — returns the VAPID public key for applicationServerKey.
   * Public procedure — called before the user subscribes.
   */
  getVapidPublicKey: publicProcedure.query(() => {
    return {
      publicKey: VAPID_PUBLIC_KEY || null,
      supported: Boolean(VAPID_PUBLIC_KEY),
    };
  }),

  /**
   * subscribe — saves a PushSubscription from the browser.
   * The browser calls navigator.serviceWorker.ready then
   * registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey })
   * and sends the resulting PushSubscription JSON to this endpoint.
   */
  subscribe: protectedProcedure
    .input(
      z.object({
        endpoint: z.string().url(),
        p256dh: z.string().min(1),
        auth: z.string().min(1),
        deviceLabel: z.string().max(100).optional(),
        userAgent: z.string().max(512).optional(),
        enablePriceAlerts: z.boolean().optional().default(true),
        enableTradeFills: z.boolean().optional().default(true),
        enableSystemAlerts: z.boolean().optional().default(false),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      // Upsert — if the endpoint already exists, update its preferences
      const existing = await db
        .select({ id: pushSubscriptions.id })
        .from(pushSubscriptions)
        .where(eq(pushSubscriptions.endpoint, input.endpoint))
        .limit(1);

      if (existing.length > 0) {
        await db
          .update(pushSubscriptions)
          .set({
            p256dh: input.p256dh,
            auth: input.auth,
            enablePriceAlerts: input.enablePriceAlerts,
            enableTradeFills: input.enableTradeFills,
            enableSystemAlerts: input.enableSystemAlerts,
            deviceLabel: input.deviceLabel,
            userAgent: input.userAgent,
            updatedAt: new Date(),
          })
          .where(eq(pushSubscriptions.endpoint, input.endpoint));
        return { action: "updated" as const };
      }

      await db.insert(pushSubscriptions).values({
        userId: ctx.user.id,
        endpoint: input.endpoint,
        p256dh: input.p256dh,
        auth: input.auth,
        enablePriceAlerts: input.enablePriceAlerts,
        enableTradeFills: input.enableTradeFills,
        enableSystemAlerts: input.enableSystemAlerts,
        deviceLabel: input.deviceLabel,
        userAgent: input.userAgent,
      });

      return { action: "created" as const };
    }),

  /**
   * unsubscribe — removes a subscription by endpoint.
   */
  unsubscribe: protectedProcedure
    .input(z.object({ endpoint: z.string().url() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      await db
        .delete(pushSubscriptions)
        .where(
          and(
            eq(pushSubscriptions.endpoint, input.endpoint),
            eq(pushSubscriptions.userId, ctx.user.id),
          ),
        );

      return { success: true };
    }),

  /**
   * getMyDevices — lists all subscribed devices for the current user.
   */
  getMyDevices: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) return [];

    return db
      .select({
        id: pushSubscriptions.id,
        endpoint: pushSubscriptions.endpoint,
        deviceLabel: pushSubscriptions.deviceLabel,
        userAgent: pushSubscriptions.userAgent,
        enablePriceAlerts: pushSubscriptions.enablePriceAlerts,
        enableTradeFills: pushSubscriptions.enableTradeFills,
        enableSystemAlerts: pushSubscriptions.enableSystemAlerts,
        createdAt: pushSubscriptions.createdAt,
      })
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.userId, ctx.user.id))
      .orderBy(pushSubscriptions.createdAt);
  }),

  /**
   * updatePrefs — toggle per-topic notification preferences for a device.
   */
  updatePrefs: protectedProcedure
    .input(
      z.object({
        subscriptionId: z.number().int(),
        enablePriceAlerts: z.boolean().optional(),
        enableTradeFills: z.boolean().optional(),
        enableSystemAlerts: z.boolean().optional(),
        deviceLabel: z.string().max(100).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const { subscriptionId, ...prefs } = input;
      const [updated] = await db
        .update(pushSubscriptions)
        .set({ ...prefs, updatedAt: new Date() })
        .where(
          and(
            eq(pushSubscriptions.id, subscriptionId),
            eq(pushSubscriptions.userId, ctx.user.id),
          ),
        )
        .returning({ id: pushSubscriptions.id });

      if (!updated) throw new TRPCError({ code: "NOT_FOUND", message: "Subscription not found" });
      return { success: true };
    }),

  /**
   * sendTest — sends a test push notification to all of the user's devices.
   */
  sendTest: protectedProcedure.mutation(async ({ ctx }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

    const devices = await db
      .select()
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.userId, ctx.user.id));

    if (devices.length === 0) {
      throw new TRPCError({ code: "NOT_FOUND", message: "No subscribed devices found" });
    }

    let sent = 0;
    const stale: number[] = [];

    for (const device of devices) {
      const ok = await sendWebPush(device.endpoint, device.p256dh, device.auth, {
        title: "NEXCOM Exchange — Test Notification",
        body: "Push notifications are working correctly on this device.",
        url: "/",
        tag: "nexcom-test",
      });

      if (ok) {
        sent++;
      } else {
        // Subscription expired — remove it
        stale.push(device.id);
      }
    }

    // Clean up stale subscriptions
    for (const id of stale) {
      await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, id));
    }

    return { sent, staleRemoved: stale.length };
  }),
});

/**
 * Exported helper for other routers (e.g., priceAlerts, traderRouter) to
 * push a notification to all subscribed devices of a given user.
 */
export async function pushToUser(
  userId: number,
  payload: { title: string; body: string; url?: string; tag?: string },
  topic: "priceAlerts" | "tradeFills" | "systemAlerts" = "tradeFills",
): Promise<void> {
  try {
    const db = await getDb();
    if (!db) return;

    const topicField = {
      priceAlerts: pushSubscriptions.enablePriceAlerts,
      tradeFills: pushSubscriptions.enableTradeFills,
      systemAlerts: pushSubscriptions.enableSystemAlerts,
    }[topic];

    const devices = await db
      .select()
      .from(pushSubscriptions)
      .where(and(eq(pushSubscriptions.userId, userId), eq(topicField, true)));

    for (const device of devices) {
      const ok = await sendWebPush(device.endpoint, device.p256dh, device.auth, payload);
      if (!ok) {
        // Remove stale subscription silently
        await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, device.id));
      }
    }
  } catch {
    // Non-critical — never throw from push helper
  }
}
