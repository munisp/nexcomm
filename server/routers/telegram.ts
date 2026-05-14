/**
 * NEXCOM Exchange — Telegram tRPC Router
 * =========================================
 * Procedures:
 *   telegram.getStats          — Admin: message volume, contact counts
 *   telegram.getContacts       — Admin: list Telegram contacts
 *   telegram.getMessages       — Admin: message history for a contact
 *   telegram.sendMessage       — Admin: send an outbound message
 *   telegram.updateContactStatus — Admin: block / opt-out a contact
 *   telegram.linkAccount       — Protected: initiate Telegram account link
 *   telegram.verifyLink        — Protected: verify Telegram link with code
 *   telegram.getMyContact      — Protected: get own Telegram contact info
 *   telegram.updatePreferences — Protected: update notification preferences
 *   telegram.unlinkAccount     — Protected: unlink Telegram from account
 */

import { z } from "zod";
import { router, protectedProcedure } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import { getDb } from "../db";
import {
  telegramContacts,
  telegramMessages,
  priceAlerts,
} from "../../drizzle/schema";
import { eq, and, desc, count, gte, like } from "drizzle-orm";
import * as crypto from "crypto";
import { writeAuditLog } from "../audit";

export const telegramRouter = router({
  // ─── Admin: Stats ─────────────────────────────────────────────────────────────
  getStats: protectedProcedure.query(async ({ ctx }) => {
    if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

    const [[contactStats], [verifiedStats], [msgStats], [inboundStats], [recentStats]] = await Promise.all([
      db.select({ total: count() }).from(telegramContacts),
      db.select({ total: count() }).from(telegramContacts).where(eq(telegramContacts.isVerified, true)),
      db.select({ total: count() }).from(telegramMessages),
      db.select({ total: count() }).from(telegramMessages).where(eq(telegramMessages.direction, "INBOUND")),
      db.select({ total: count() }).from(telegramMessages).where(gte(telegramMessages.createdAt, new Date(Date.now() - 86400000))),
    ]);

    const totalMessages = Number(msgStats?.total ?? 0);
    const inbound = Number(inboundStats?.total ?? 0);

    return {
      totalContacts: Number(contactStats?.total ?? 0),
      verifiedContacts: Number(verifiedStats?.total ?? 0),
      totalMessages,
      inboundMessages: inbound,
      outboundMessages: totalMessages - inbound,
      messagesLast24h: Number(recentStats?.total ?? 0),
    };
  }),

  // ─── Admin: List Contacts ─────────────────────────────────────────────────────
  getContacts: protectedProcedure
    .input(
      z.object({
        page: z.number().int().min(1).default(1),
        limit: z.number().int().min(1).max(100).default(20),
        search: z.string().optional(),
        status: z.enum(["ACTIVE", "BLOCKED", "OPTED_OUT"]).optional(),
        verified: z.boolean().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const offset = (input.page - 1) * input.limit;
      const conditions = [];
      if (input.status) conditions.push(eq(telegramContacts.status, input.status));
      if (input.verified !== undefined) conditions.push(eq(telegramContacts.isVerified, input.verified));
      if (input.search) {
        conditions.push(like(telegramContacts.username, `%${input.search}%`));
      }

      const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

      const [contacts, [totalRow]] = await Promise.all([
        db
          .select({
            id: telegramContacts.id,
            telegramId: telegramContacts.telegramId,
            username: telegramContacts.username,
            firstName: telegramContacts.firstName,
            lastName: telegramContacts.lastName,
            status: telegramContacts.status,
            isVerified: telegramContacts.isVerified,
            alertsEnabled: telegramContacts.alertsEnabled,
            priceAlertsEnabled: telegramContacts.priceAlertsEnabled,
            tradeNotificationsEnabled: telegramContacts.tradeNotificationsEnabled,
            totalCommands: telegramContacts.totalCommands,
            lastInteractionAt: telegramContacts.lastInteractionAt,
            userId: telegramContacts.userId,
            createdAt: telegramContacts.createdAt,
          })
          .from(telegramContacts)
          .where(whereClause)
          .orderBy(desc(telegramContacts.lastInteractionAt))
          .limit(input.limit)
          .offset(offset),
        db.select({ count: count() }).from(telegramContacts).where(whereClause),
      ]);

      return {
        contacts,
        total: Number(totalRow?.count ?? 0),
        page: input.page,
        limit: input.limit,
      };
    }),

  // ─── Admin: Message History ────────────────────────────────────────────────────
  getMessages: protectedProcedure
    .input(
      z.object({
        contactId: z.number().int(),
        page: z.number().int().min(1).default(1),
        limit: z.number().int().min(1).max(100).default(50),
      })
    )
    .query(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const offset = (input.page - 1) * input.limit;

      const [messages, [totalRow]] = await Promise.all([
        db
          .select()
          .from(telegramMessages)
          .where(eq(telegramMessages.contactId, input.contactId))
          .orderBy(desc(telegramMessages.createdAt))
          .limit(input.limit)
          .offset(offset),
        db
          .select({ count: count() })
          .from(telegramMessages)
          .where(eq(telegramMessages.contactId, input.contactId)),
      ]);

      return {
        messages,
        total: Number(totalRow?.count ?? 0),
        page: input.page,
        limit: input.limit,
      };
    }),

  // ─── Admin: Send Message ───────────────────────────────────────────────────────
  sendMessage: protectedProcedure
    .input(
      z.object({
        contactId: z.number().int(),
        message: z.string().min(1).max(4096),
        parseMode: z.enum(["Markdown", "HTML", "MarkdownV2"]).default("Markdown"),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const [contact] = await db
        .select()
        .from(telegramContacts)
        .where(eq(telegramContacts.id, input.contactId))
        .limit(1);

      if (!contact) throw new TRPCError({ code: "NOT_FOUND" });
      if (contact.status !== "ACTIVE") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Contact is not active" });
      }

      const [msg] = await db
        .insert(telegramMessages)
        .values({
          contactId: input.contactId,
          direction: "OUTBOUND",
          text: input.message,
          parseMode: input.parseMode,
          createdAt: new Date(),
        })
        .returning();

      return { success: true, messageId: msg.id };
    }),

  // ─── Admin: Update Contact Status ─────────────────────────────────────────────
  updateContactStatus: protectedProcedure
    .input(
      z.object({
        contactId: z.number().int(),
        status: z.enum(["ACTIVE", "BLOCKED", "OPTED_OUT"]),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      await db
        .update(telegramContacts)
        .set({ status: input.status, updatedAt: new Date() })
        .where(eq(telegramContacts.id, input.contactId));

      return { success: true };
    }),

  // ─── Protected: Initiate Account Link ────────────────────────────────────────
  linkAccount: protectedProcedure.mutation(async ({ ctx }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

    const code = crypto.randomBytes(3).toString("hex").toUpperCase();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 min

    // Store pending verification code in a temp telegram contact record
    // The Go channel-gateway will match this code when user sends /verify CODE
    await db
      .insert(telegramContacts)
      .values({
        telegramId: `PENDING_${ctx.user.id}`,
        userId: ctx.user.id,
        status: "ACTIVE",
        isVerified: false,
        verificationCode: code,
        verificationExpiresAt: expiresAt,
        alertsEnabled: true,
        priceAlertsEnabled: true,
        tradeNotificationsEnabled: true,
        totalCommands: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: telegramContacts.telegramId,
        set: {
          verificationCode: code,
          verificationExpiresAt: expiresAt,
          updatedAt: new Date(),
        },
      });

    return {
      success: true,
      verificationCode: code,
      instructions: `Open Telegram and send "/verify ${code}" to @NEXCOMExchangeBot to link your account.`,
      botUsername: "@NEXCOMExchangeBot",
      expiresAt,
    };
  }),

  // ─── Protected: Get My Contact ────────────────────────────────────────────────
  getMyContact: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

    const [contact] = await db
      .select({
        id: telegramContacts.id,
        telegramId: telegramContacts.telegramId,
        username: telegramContacts.username,
        firstName: telegramContacts.firstName,
        status: telegramContacts.status,
        isVerified: telegramContacts.isVerified,
        alertsEnabled: telegramContacts.alertsEnabled,
        priceAlertsEnabled: telegramContacts.priceAlertsEnabled,
        tradeNotificationsEnabled: telegramContacts.tradeNotificationsEnabled,
        totalCommands: telegramContacts.totalCommands,
        lastInteractionAt: telegramContacts.lastInteractionAt,
        createdAt: telegramContacts.createdAt,
      })
      .from(telegramContacts)
      .where(and(
        eq(telegramContacts.userId, ctx.user.id),
        eq(telegramContacts.isVerified, true),
      ))
      .limit(1);

    return contact ?? null;
  }),

  // ─── Protected: Update Notification Preferences ───────────────────────────────
  updatePreferences: protectedProcedure
    .input(
      z.object({
        alertsEnabled: z.boolean().optional(),
        priceAlertsEnabled: z.boolean().optional(),
        tradeNotificationsEnabled: z.boolean().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const updateData: Record<string, unknown> = { updatedAt: new Date() };
      if (input.alertsEnabled !== undefined) updateData.alertsEnabled = input.alertsEnabled;
      if (input.priceAlertsEnabled !== undefined) updateData.priceAlertsEnabled = input.priceAlertsEnabled;
      if (input.tradeNotificationsEnabled !== undefined) updateData.tradeNotificationsEnabled = input.tradeNotificationsEnabled;

      await db
        .update(telegramContacts)
        .set(updateData as any)
        .where(and(
          eq(telegramContacts.userId, ctx.user.id),
          eq(telegramContacts.isVerified, true),
        ));

      return { success: true };
    }),

  // ─── Protected: Get My Price Alerts ────────────────────────────────────────────────
  getAlerts: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
    const alerts = await db
      .select()
      .from(priceAlerts)
      .where(eq(priceAlerts.userId, ctx.user.id))
      .orderBy(desc(priceAlerts.createdAt))
      .limit(50);
    return alerts;
  }),

  // ─── Protected: Create Price Alert via Telegram ──────────────────────────────────────
  createAlert: protectedProcedure
    .input(
      z.object({
        symbol: z.string().min(1).max(20),
        targetPrice: z.number().positive(),
        condition: z.enum(["ABOVE", "BELOW", "CROSS_ABOVE", "CROSS_BELOW"]).default("ABOVE"),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const [alert] = await db
        .insert(priceAlerts)
        .values({
          userId: ctx.user.id,
          symbol: input.symbol.toUpperCase(),
          targetPrice: String(input.targetPrice),
          condition: input.condition,
          triggered: false,
          notified: false,
          createdAt: new Date(),
        })
        .returning();
      return alert;
    }),

  // ─── Protected: Delete Price Alert ──────────────────────────────────────────────────────────────
  deleteAlert: protectedProcedure
    .input(z.object({ alertId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const [deleted] = await db
        .delete(priceAlerts)
        .where(and(
          eq(priceAlerts.id, input.alertId),
          eq(priceAlerts.userId, ctx.user.id), // ensure ownership
        ))
        .returning();
      if (!deleted) throw new TRPCError({ code: "NOT_FOUND", message: "Alert not found" });
      return { success: true, deletedId: input.alertId };
    }),

    // ─── Protected: Unlink Account ────────────────────────────────────────────────
  unlinkAccount: protectedProcedure.mutation(async ({ ctx }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
    await db
      .update(telegramContacts)
      .set({ userId: null, isVerified: false, updatedAt: new Date() })
      .where(eq(telegramContacts.userId, ctx.user.id));
    return { success: true };
  }),

  // ─── Protected: Market Broadcast Subscription ─────────────────────────────────
  /**
   * Enable daily market open/close Telegram broadcasts for the current user.
   * The scheduler in app/telegram/market_broadcast.py checks this flag before
   * sending each broadcast.
   */
  subscribeMarketBroadcasts: protectedProcedure.mutation(async ({ ctx }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
    const [contact] = await db
      .select({ id: telegramContacts.id, isVerified: telegramContacts.isVerified })
      .from(telegramContacts)
      .where(eq(telegramContacts.userId, ctx.user.id))
      .limit(1);
    if (!contact) throw new TRPCError({ code: "NOT_FOUND", message: "No linked Telegram account found. Link your Telegram account first." });
    if (!contact.isVerified) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Telegram account not verified. Complete verification first." });
    await db
      .update(telegramContacts)
      .set({ marketBroadcasts: true, updatedAt: new Date() })
      .where(eq(telegramContacts.userId, ctx.user.id));
    return { success: true, marketBroadcasts: true };
  }),

  /**
   * Disable daily market open/close Telegram broadcasts for the current user.
   */
  unsubscribeMarketBroadcasts: protectedProcedure.mutation(async ({ ctx }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
    const [contact] = await db
      .select({ id: telegramContacts.id })
      .from(telegramContacts)
      .where(eq(telegramContacts.userId, ctx.user.id))
      .limit(1);
    if (!contact) throw new TRPCError({ code: "NOT_FOUND", message: "No linked Telegram account found." });
    await db
      .update(telegramContacts)
      .set({ marketBroadcasts: false, updatedAt: new Date() })
      .where(eq(telegramContacts.userId, ctx.user.id));
    return { success: true, marketBroadcasts: false };
  }),

  /**
   * Get the current market broadcast subscription status for the current user.
   */
  getMarketBroadcastStatus: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
    const [contact] = await db
      .select({
        isLinked: telegramContacts.id,
        isVerified: telegramContacts.isVerified,
        marketBroadcasts: telegramContacts.marketBroadcasts,
        username: telegramContacts.username,
      })
      .from(telegramContacts)
      .where(eq(telegramContacts.userId, ctx.user.id))
      .limit(1);
    if (!contact) {
      return { isLinked: false, isVerified: false, marketBroadcasts: false, username: null };
    }
    return {
      isLinked: true,
      isVerified: contact.isVerified,
      marketBroadcasts: contact.marketBroadcasts ?? true,
      username: contact.username,
    };
  }),
});
