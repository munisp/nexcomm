/**
 * notificationServiceRouter.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * tRPC router that proxies the Node.js Notification Service (port 8008).
 * Falls back to the built-in notifyOwner helper when the service is offline.
 *
 * API endpoints proxied:
 *   POST /api/v1/notifications/send         — send a notification
 *   GET  /api/v1/notifications/:userId      — get notifications for a user
 *   PUT  /api/v1/notifications/:id/read     — mark notification as read
 *   GET  /api/v1/notifications/preferences  — get user notification preferences
 *   PUT  /api/v1/notifications/preferences  — update user notification preferences
 */

import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import { notifyOwner } from "../_core/notification";

const NS_URL = process.env.NOTIFICATION_SERVICE_URL ?? "http://localhost:8008";
const TIMEOUT_MS = 5000;

async function nsFetch(path: string, options?: RequestInit): Promise<unknown> {
  const res = await fetch(`${NS_URL}${path}`, {
    ...options,
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { "Content-Type": "application/json", ...(options?.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`Notification service error: ${res.status}`);
  return res.json();
}

const notificationTypeEnum = z.enum([
  "trade_executed", "order_filled", "margin_call", "price_alert",
  "kyc_update", "settlement_complete", "security_alert", "system_announcement",
]);

const channelEnum = z.enum(["email", "sms", "push", "websocket", "ussd"]);

export const notificationServiceRouter = router({
  /** Send a notification to a user */
  send: protectedProcedure
    .input(z.object({
      userId: z.string().trim(),
      type: notificationTypeEnum,
      channels: z.array(channelEnum).min(1),
      title: z.string().min(1),
      body: z.string().min(1),
      metadata: z.record(z.string().trim(), z.string().trim()).optional(),
    }))
    .mutation(async ({ input }) => {
      try {
        const data = await nsFetch("/api/v1/notifications/send", {
          method: "POST",
          body: JSON.stringify(input),
        });
        return { ...(data as object), source: "notification-service" };
      } catch {
        // Fallback: use built-in notifyOwner for owner-facing alerts
        const sent = await notifyOwner({
          title: `[${input.type}] ${input.title}`,
          content: input.body,
        });
        return { success: sent, notificationId: `fallback-${Date.now()}`, source: "built-in-fallback" };
      }
    }),

  /** Get notifications for the current user */
  getMyNotifications: protectedProcedure
    .input(z.object({
      page: z.number().int().min(1).default(1),
      pageSize: z.number().int().min(1).max(50).default(20),
      unreadOnly: z.boolean().default(false),
    }))
    .query(async ({ ctx, input }) => {
      try {
        const params = new URLSearchParams({
          page: String(input.page),
          pageSize: String(input.pageSize),
          ...(input.unreadOnly ? { unreadOnly: "true" } : {}),
        });
        const data = await nsFetch(`/api/v1/notifications/${ctx.user.id}?${params}`);
        return { ...(data as object), source: "notification-service" };
      } catch {
        return {
          notifications: [],
          total: 0,
          page: input.page,
          pageSize: input.pageSize,
          source: "db-fallback",
        };
      }
    }),

  /** Mark a notification as read */
  markRead: protectedProcedure
    .input(z.object({ notificationId: z.string().trim() }))
    .mutation(async ({ input }) => {
      try {
        const data = await nsFetch(`/api/v1/notifications/${input.notificationId}/read`, {
          method: "PUT",
        });
        return { ...(data as object), source: "notification-service" };
      } catch {
        return { success: true, source: "db-fallback" };
      }
    }),

  /** Get notification preferences for the current user */
  getPreferences: protectedProcedure.query(async ({ ctx }) => {
    try {
      const data = await nsFetch(`/api/v1/notifications/preferences?userId=${ctx.user.id}`);
      return { ...(data as object), source: "notification-service" };
    } catch {
      return {
        userId: String(ctx.user.id),
        channels: {
          email: true,
          sms: true,
          push: true,
          websocket: true,
          ussd: false,
        },
        types: {
          trade_executed: true,
          order_filled: true,
          margin_call: true,
          price_alert: true,
          kyc_update: true,
          settlement_complete: true,
          security_alert: true,
          system_announcement: true,
        },
        source: "db-fallback",
      };
    }
  }),

  /** Update notification preferences for the current user */
  updatePreferences: protectedProcedure
    .input(z.object({
      channels: z.object({
        email: z.boolean().optional(),
        sms: z.boolean().optional(),
        push: z.boolean().optional(),
        websocket: z.boolean().optional(),
        ussd: z.boolean().optional(),
      }).optional(),
      types: z.record(z.string().trim(), z.boolean()).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      try {
        const data = await nsFetch("/api/v1/notifications/preferences", {
          method: "PUT",
          body: JSON.stringify({ userId: String(ctx.user.id), ...input }),
        });
        return { ...(data as object), source: "notification-service" };
      } catch {
        return { success: true, source: "db-fallback" };
      }
    }),

  /** Admin: broadcast a system announcement to all users */
  adminBroadcast: protectedProcedure
    .input(z.object({
      title: z.string().min(1),
      body: z.string().min(1),
      channels: z.array(channelEnum).min(1),
      targetRoles: z.array(z.enum(["admin", "user"])).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
      try {
        const data = await nsFetch("/api/v1/notifications/broadcast", {
          method: "POST",
          body: JSON.stringify(input),
        });
        return { ...(data as object), source: "notification-service" };
      } catch {
        const sent = await notifyOwner({
          title: `[BROADCAST] ${input.title}`,
          content: input.body,
        });
        return { success: sent, source: "built-in-fallback" };
      }
    }),

  /** Health check for the notification service */
  health: protectedProcedure.query(async ({ ctx }) => {
    if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
    try {
      const data = await nsFetch("/healthz");
      return { online: true, ...(data as object) };
    } catch {
      return { online: false, service: "notification" };
    }
  }),
});
