/**
 * warehouseRouter — in-app warehouse messaging
 * Replaces the mailto: fallback with a persistent, auditable on-platform channel.
 */
import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb, createNotification } from "../db";
import { warehouseMessages } from "../../drizzle/schema";
import { eq, and, desc, asc, sql } from "drizzle-orm";
import { writeAuditLog } from "../audit";

export const warehouseRouter = router({
  /**
   * Send a new message to a warehouse operator.
   * The message is stored in warehouse_messages and visible in the contact history.
   */
  sendMessage: protectedProcedure
    .input(z.object({
      warehouseId:   z.string().min(1).max(50),
      warehouseName: z.string().min(1).max(200),
      subject:       z.string().min(1).max(300),
      body:          z.string().min(1).max(4000),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("DB unavailable");
      const [row] = await db
        .insert(warehouseMessages)
        .values({
          userId:        ctx.user.id,
          warehouseId:   input.warehouseId,
          warehouseName: input.warehouseName,
          subject:       input.subject,
          body:          input.body,
          status:        "SENT",
        })
        .returning();
      return row;
    }),

  /**
   * List all messages sent by the current user to a specific warehouse.
   * Returns newest first.
   */
  listMessages: protectedProcedure
    .input(z.object({ warehouseId: z.string().min(1).max(50) }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) return [];
      return db
        .select()
        .from(warehouseMessages)
        .where(
          and(
            eq(warehouseMessages.userId, ctx.user.id),
            eq(warehouseMessages.warehouseId, input.warehouseId),
          ),
        )
        .orderBy(desc(warehouseMessages.createdAt));
    }),

  /**
   * List all messages sent by the current user across all warehouses.
   * Used for a global inbox view. Supports offset-based pagination.
   */
  listAllMessages: protectedProcedure
    .input(z.object({
      limit:  z.number().int().min(1).max(100).default(10),
      offset: z.number().int().min(0).default(0),
    }).optional())
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) return { messages: [], total: 0 };
      const limit = input?.limit ?? 10;
      const offset = input?.offset ?? 0;
      const [rows, countRows] = await Promise.all([
        db
          .select()
          .from(warehouseMessages)
          .where(eq(warehouseMessages.userId, ctx.user.id))
          .orderBy(desc(warehouseMessages.createdAt))
          .limit(limit)
          .offset(offset),
        db
          .select({ count: sql<number>`count(*)::int` })
          .from(warehouseMessages)
          .where(eq(warehouseMessages.userId, ctx.user.id)),
      ]);
      return { messages: rows, total: countRows[0]?.count ?? 0 };
    }),

  /**
   * Mark a message as read by the farmer (sets readAt timestamp).
   * Called when the farmer opens the History tab for a warehouse.
   */
  markRead: protectedProcedure
    .input(z.object({ messageId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("DB unavailable");
      const [row] = await db
        .update(warehouseMessages)
        .set({ readAt: new Date(), updatedAt: new Date() })
        .where(and(
          eq(warehouseMessages.id, input.messageId),
          eq(warehouseMessages.userId, ctx.user.id),
        ))
        .returning();
      return row;
    }),

  /**
   * Mark all messages for a specific warehouse as read by the farmer.
   * Called when the History tab is opened for a warehouse.
   */
  markAllRead: protectedProcedure
    .input(z.object({ warehouseId: z.string().min(1).max(50) }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("DB unavailable");
      await db
        .update(warehouseMessages)
        .set({ readAt: new Date(), updatedAt: new Date() })
        .where(and(
          eq(warehouseMessages.userId, ctx.user.id),
          eq(warehouseMessages.warehouseId, input.warehouseId),
        ));
      return { ok: true };
    }),

  /**
   * Admin: list all warehouse messages across all users.
   * Supports optional status filter and pagination.
   */
  adminListAll: protectedProcedure
    .input(z.object({
      status:  z.enum(["ALL", "SENT", "READ", "REPLIED", "CLOSED"]).default("ALL"),
      limit:   z.number().int().min(1).max(100).default(50),
      offset:  z.number().int().min(0).default(0),
    }))
    .query(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") throw new Error("Forbidden");
      const db = await getDb();
      if (!db) return [];
      const query = db
        .select()
        .from(warehouseMessages)
        .orderBy(desc(warehouseMessages.createdAt))
        .limit(input.limit)
        .offset(input.offset);
      if (input.status !== "ALL") {
        return query.where(eq(warehouseMessages.status, input.status));
      }
      return query;
    }),

  /**
   * Admin: mark all SENT messages as READ in bulk.
   * Called when the admin opens the warehouse messages inbox page.
   */
  adminMarkAllRead: protectedProcedure
    .mutation(async ({ ctx }) => {
      if (ctx.user.role !== "admin") throw new Error("Forbidden");
      const db = await getDb();
      if (!db) throw new Error("DB unavailable");
      await db
        .update(warehouseMessages)
        .set({ status: "READ", updatedAt: new Date() })
        .where(eq(warehouseMessages.status, "SENT"));
      return { ok: true };
    }),

  /**
   * Admin: count unread (SENT) messages — used for sidebar badge.
   */
  adminUnreadCount: protectedProcedure
    .query(async ({ ctx }) => {
      if (ctx.user.role !== "admin") throw new Error("Forbidden");
      const db = await getDb();
      if (!db) return { count: 0 };
      const rows = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(warehouseMessages)
        .where(eq(warehouseMessages.status, "SENT"));
      return { count: rows[0]?.count ?? 0 };
    }),

  /**
   * Admin: mark a message as READ.
   */
  adminMarkRead: protectedProcedure
    .input(z.object({ messageId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") throw new Error("Forbidden");
      const db = await getDb();
      if (!db) throw new Error("DB unavailable");
      const [row] = await db
        .update(warehouseMessages)
        .set({ status: "READ", updatedAt: new Date() })
        .where(and(
          eq(warehouseMessages.id, input.messageId),
          eq(warehouseMessages.status, "SENT"),
        ))
        .returning();
      return row;
    }),

  /**
   * Admin: close a message thread.
   */
  adminClose: protectedProcedure
    .input(z.object({ messageId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") throw new Error("Forbidden");
      const db = await getDb();
      if (!db) throw new Error("DB unavailable");
      const [row] = await db
        .update(warehouseMessages)
        .set({ status: "CLOSED", updatedAt: new Date() })
        .where(eq(warehouseMessages.id, input.messageId))
        .returning();
      return row;
    }),

  /**
   * Admin: reply to a warehouse message.
   * Sets status to REPLIED and stores the reply body.
   */
  adminReply: protectedProcedure
    .input(z.object({
      messageId: z.number().int().positive(),
      replyBody: z.string().min(1).max(4000),
    }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") throw new Error("Forbidden");
      const db = await getDb();
      if (!db) throw new Error("DB unavailable");
      const [row] = await db
        .update(warehouseMessages)
        .set({
          replyBody:  input.replyBody,
          repliedAt:  new Date(),
          status:     "REPLIED",
          updatedAt:  new Date(),
        })
        .where(eq(warehouseMessages.id, input.messageId))
        .returning();
      // Send in-app notification to the original message sender
      if (row) {
        await createNotification({
          userId:  row.userId,
          title:   `Reply from NEXCOM: ${row.subject}`,
          message: `Your message to ${row.warehouseName} has received a reply: "${input.replyBody.slice(0, 120)}${input.replyBody.length > 120 ? "…" : ""}". Visit Warehouses to view the full reply.`,
          type:    "SYSTEM",
          metadata: { warehouseId: row.warehouseId, messageId: row.id },
        });
      }
      return row;
    }),
});
