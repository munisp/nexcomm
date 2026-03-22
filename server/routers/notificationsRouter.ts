import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { notifications } from "../../drizzle/schema";
import { eq, and, desc } from "drizzle-orm";
import { TRPCError } from "@trpc/server";

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
});
