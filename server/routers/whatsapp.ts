/**
 * NEXCOM Exchange — WhatsApp tRPC Router
 * ========================================
 * Procedures:
 *   whatsapp.getStats          — Admin: message volume, contact counts
 *   whatsapp.getContacts       — Admin: list WhatsApp contacts
 *   whatsapp.getMessages       — Admin: message history for a contact
 *   whatsapp.sendMessage       — Admin: send an outbound message
 *   whatsapp.updateContactStatus — Admin: opt-out / block a contact
 *   whatsapp.linkAccount       — Protected: link WhatsApp to NEXCOM account
 *   whatsapp.getMyContact      — Protected: get own WhatsApp contact info
 *   whatsapp.unlinkAccount     — Protected: unlink WhatsApp from account
 */

import { z } from "zod";
import { router, protectedProcedure } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import { getDb } from "../db";
import {
  whatsappContacts,
  whatsappMessages,
} from "../../drizzle/schema";
import { eq, and, desc, count, gte, like } from "drizzle-orm";
import crypto from "crypto";
import { writeAuditLog } from "../audit";

export const whatsappRouter = router({
  // ─── Admin: Stats ─────────────────────────────────────────────────────────────
  getStats: protectedProcedure.query(async ({ ctx }) => {
    if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

    const [[contactStats], [verifiedStats], [msgStats], [inboundStats], [recentStats]] = await Promise.all([
      db.select({ total: count() }).from(whatsappContacts),
      db.select({ total: count() }).from(whatsappContacts).where(eq(whatsappContacts.verifiedAt, null as any)),
      db.select({ total: count() }).from(whatsappMessages),
      db.select({ total: count() }).from(whatsappMessages).where(eq(whatsappMessages.direction, "INBOUND")),
      db.select({ total: count() }).from(whatsappMessages).where(gte(whatsappMessages.createdAt, new Date(Date.now() - 86400000))),
    ]);

    const totalContacts = Number(contactStats?.total ?? 0);
    const totalMessages = Number(msgStats?.total ?? 0);
    const inbound = Number(inboundStats?.total ?? 0);

    return {
      totalContacts,
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
        status: z.enum(["ACTIVE", "OPTED_OUT", "BLOCKED"]).optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const offset = (input.page - 1) * input.limit;
      const conditions = [];
      if (input.status) conditions.push(eq(whatsappContacts.status, input.status));
      if (input.search) conditions.push(like(whatsappContacts.phoneNumber, `%${input.search}%`));

      const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

      const [contacts, [totalRow]] = await Promise.all([
        db
          .select({
            id: whatsappContacts.id,
            phoneNumber: whatsappContacts.phoneNumber,
            waId: whatsappContacts.waId,
            displayName: whatsappContacts.displayName,
            status: whatsappContacts.status,
            verifiedAt: whatsappContacts.verifiedAt,
            totalMessages: whatsappContacts.totalMessages,
            lastMessageAt: whatsappContacts.lastMessageAt,
            userId: whatsappContacts.userId,
            createdAt: whatsappContacts.createdAt,
          })
          .from(whatsappContacts)
          .where(whereClause)
          .orderBy(desc(whatsappContacts.lastMessageAt))
          .limit(input.limit)
          .offset(offset),
        db.select({ count: count() }).from(whatsappContacts).where(whereClause),
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
          .from(whatsappMessages)
          .where(eq(whatsappMessages.contactId, input.contactId))
          .orderBy(desc(whatsappMessages.createdAt))
          .limit(input.limit)
          .offset(offset),
        db
          .select({ count: count() })
          .from(whatsappMessages)
          .where(eq(whatsappMessages.contactId, input.contactId)),
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
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const [contact] = await db
        .select()
        .from(whatsappContacts)
        .where(eq(whatsappContacts.id, input.contactId))
        .limit(1);

      if (!contact) throw new TRPCError({ code: "NOT_FOUND" });
      if (contact.status !== "ACTIVE") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Contact is not active" });
      }

      const [msg] = await db
        .insert(whatsappMessages)
        .values({
          contactId: input.contactId,
          direction: "OUTBOUND",
          messageType: "text",
          body: input.message,
          status: "QUEUED",
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .returning();

      return { success: true, messageId: msg.id };
    }),

  // ─── Admin: Update Contact Status ─────────────────────────────────────────────
  updateContactStatus: protectedProcedure
    .input(
      z.object({
        contactId: z.number().int(),
        status: z.enum(["ACTIVE", "OPTED_OUT", "BLOCKED"]),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      await db
        .update(whatsappContacts)
        .set({ status: input.status, updatedAt: new Date() })
        .where(eq(whatsappContacts.id, input.contactId));

      return { success: true };
    }),

  // ─── Protected: Link Account ──────────────────────────────────────────────────
  linkAccount: protectedProcedure
    .input(z.object({ phoneNumber: z.string().min(10).max(20) }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const token = crypto.randomBytes(4).toString("hex").toUpperCase();
      const waId = input.phoneNumber.replace(/\D/g, "");

      await db
        .insert(whatsappContacts)
        .values({
          userId: ctx.user.id,
          phoneNumber: input.phoneNumber,
          waId,
          status: "ACTIVE",
          verificationToken: token,
          totalMessages: 0,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: whatsappContacts.waId,
          set: {
            userId: ctx.user.id,
            verificationToken: token,
            verifiedAt: null,
            updatedAt: new Date(),
          },
        });

      return {
        success: true,
        verificationCode: token,
        instructions: `Send "VERIFY ${token}" to +234 800 NEXCOM on WhatsApp to link your account.`,
      };
    }),

  // ─── Protected: Get My Contact ────────────────────────────────────────────────
  getMyContact: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

    const [contact] = await db
      .select({
        id: whatsappContacts.id,
        phoneNumber: whatsappContacts.phoneNumber,
        displayName: whatsappContacts.displayName,
        status: whatsappContacts.status,
        verifiedAt: whatsappContacts.verifiedAt,
        totalMessages: whatsappContacts.totalMessages,
        lastMessageAt: whatsappContacts.lastMessageAt,
        createdAt: whatsappContacts.createdAt,
      })
      .from(whatsappContacts)
      .where(eq(whatsappContacts.userId, ctx.user.id))
      .limit(1);

    return contact ?? null;
  }),

  // ─── Protected: Unlink Account ────────────────────────────────────────────────
  unlinkAccount: protectedProcedure.mutation(async ({ ctx }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

    await db
      .update(whatsappContacts)
      .set({ userId: null, verifiedAt: null, updatedAt: new Date() })
      .where(eq(whatsappContacts.userId, ctx.user.id));

    return { success: true };
  }),


  deleteContact: protectedProcedure
    .input(z.object({ contactId: z.number().int() }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "Database unavailable" });
      const [contact] = await db.update(whatsappContacts)
        .set({ status: "BLOCKED", updatedAt: new Date() })
        .where(eq(whatsappContacts.id, input.contactId))
        .returning();
      if (!contact) throw new TRPCError({ code: "NOT_FOUND", message: "Contact not found" });
      return { success: true };
    }),


});
