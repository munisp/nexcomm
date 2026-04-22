import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { eq, and, desc, asc, gte, lte, like, or } from "drizzle-orm";
import { router, protectedProcedure, publicProcedure, adminProcedure } from "../_core/trpc";
import { getDb } from "../db";
import {
  irEvents,
  irDocuments,
  shareholderRegistry,
  irSubscriptions,
} from "../../drizzle/schema";
import { notifyOwner } from "../_core/notification";

export const investorRelationsRouter = router({
  // ─── Public: Event Calendar ──────────────────────────────────────────────────

  listEvents: publicProcedure
    .input(z.object({
      companySymbol: z.string().max(16).optional(),
      eventType: z.enum([
        "EARNINGS_RELEASE", "DIVIDEND_ANNOUNCEMENT", "AGM", "EGM",
        "RIGHTS_ISSUE", "BONUS_ISSUE", "STOCK_SPLIT", "MERGER_ACQUISITION",
        "REGULATORY_FILING", "INVESTOR_PRESENTATION", "ROADSHOW", "OTHER", "ALL",
      ]).default("ALL"),
      fromDate: z.string().optional(), // ISO date string
      toDate: z.string().optional(),
      publishedOnly: z.boolean().default(true),
      limit: z.number().int().min(1).max(200).default(50),
      offset: z.number().int().min(0).default(0),
    }).optional())
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const conditions: ReturnType<typeof eq>[] = [];
      if (input?.companySymbol) conditions.push(eq(irEvents.companySymbol, input.companySymbol));
      if (input?.eventType && input.eventType !== "ALL") {
        conditions.push(eq(irEvents.eventType, input.eventType as any));
      }
      if (input?.fromDate) conditions.push(gte(irEvents.eventDate, new Date(input.fromDate)));
      if (input?.toDate) conditions.push(lte(irEvents.eventDate, new Date(input.toDate)));
      if (input?.publishedOnly !== false) conditions.push(eq(irEvents.isPublished, true));

      const query = db.select().from(irEvents);
      const rows = conditions.length > 0
        ? await query.where(and(...conditions)).orderBy(asc(irEvents.eventDate)).limit(input?.limit ?? 50).offset(input?.offset ?? 0)
        : await query.orderBy(asc(irEvents.eventDate)).limit(input?.limit ?? 50).offset(input?.offset ?? 0);

      return { events: rows, total: rows.length };
    }),

  getEvent: publicProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      const [event] = await db.select().from(irEvents).where(eq(irEvents.id, input.id));
      if (!event) throw new TRPCError({ code: "NOT_FOUND", message: "Event not found" });
      return event;
    }),

  // ─── Public: Document Library ────────────────────────────────────────────────

  listDocuments: publicProcedure
    .input(z.object({
      companySymbol: z.string().max(16).optional(),
      documentType: z.enum([
        "ANNUAL_REPORT", "INTERIM_REPORT", "QUARTERLY_REPORT",
        "PROSPECTUS", "CIRCULAR", "PRESS_RELEASE", "PRESENTATION",
        "FINANCIAL_STATEMENT", "REGULATORY_FILING", "OTHER", "ALL",
      ]).default("ALL"),
      fiscalYear: z.number().int().optional(),
      searchQuery: z.string().max(128).optional(),
      publishedOnly: z.boolean().default(true),
      limit: z.number().int().min(1).max(200).default(50),
      offset: z.number().int().min(0).default(0),
    }).optional())
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const conditions: ReturnType<typeof eq>[] = [];
      if (input?.companySymbol) conditions.push(eq(irDocuments.companySymbol, input.companySymbol));
      if (input?.documentType && input.documentType !== "ALL") {
        conditions.push(eq(irDocuments.documentType, input.documentType as any));
      }
      if (input?.fiscalYear) conditions.push(eq(irDocuments.fiscalYear, input.fiscalYear));
      if (input?.publishedOnly !== false) conditions.push(eq(irDocuments.isPublished, true));

      const query = db.select().from(irDocuments);
      const rows = conditions.length > 0
        ? await query.where(and(...conditions)).orderBy(desc(irDocuments.createdAt)).limit(input?.limit ?? 50).offset(input?.offset ?? 0)
        : await query.orderBy(desc(irDocuments.createdAt)).limit(input?.limit ?? 50).offset(input?.offset ?? 0);

      return { documents: rows, total: rows.length };
    }),

  downloadDocument: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      const [doc] = await db.select().from(irDocuments).where(eq(irDocuments.id, input.id));
      if (!doc) throw new TRPCError({ code: "NOT_FOUND", message: "Document not found" });
      if (!doc.isPublished) throw new TRPCError({ code: "FORBIDDEN", message: "Document not published" });

      // Increment download count
      await db.update(irDocuments)
        .set({ downloadCount: doc.downloadCount + 1 })
        .where(eq(irDocuments.id, input.id));

      return { fileUrl: doc.fileUrl, title: doc.title, mimeType: doc.mimeType };
    }),

  // ─── Public: Shareholder Registry ────────────────────────────────────────────

  listShareholders: publicProcedure
    .input(z.object({
      companySymbol: z.string().max(16),
      shareholderType: z.enum(["INDIVIDUAL", "INSTITUTIONAL", "INSIDER", "GOVERNMENT", "ALL"]).default("ALL"),
      limit: z.number().int().min(1).max(200).default(50),
      offset: z.number().int().min(0).default(0),
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const conditions: ReturnType<typeof eq>[] = [eq(shareholderRegistry.companySymbol, input.companySymbol)];
      if (input.shareholderType !== "ALL") {
        conditions.push(eq(shareholderRegistry.shareholderType, input.shareholderType));
      }

      const rows = await db.select().from(shareholderRegistry)
        .where(and(...conditions))
        .orderBy(desc(shareholderRegistry.holdingPct))
        .limit(input.limit)
        .offset(input.offset);

      const totalShares = rows.length > 0 ? parseFloat(rows[0].totalShares) : 0;
      const topHoldersPct = rows.reduce((sum, r) => sum + parseFloat(r.holdingPct), 0);

      return { shareholders: rows, totalShares, topHoldersPct: topHoldersPct.toFixed(4) };
    }),

  getMyHoldings: protectedProcedure
    .input(z.object({ companySymbol: z.string().max(16).optional() }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const conditions: ReturnType<typeof eq>[] = [eq(shareholderRegistry.userId, ctx.user.id)];
      if (input.companySymbol) conditions.push(eq(shareholderRegistry.companySymbol, input.companySymbol));

      return db.select().from(shareholderRegistry)
        .where(and(...conditions))
        .orderBy(desc(shareholderRegistry.holdingPct));
    }),

  // ─── User: Subscriptions ─────────────────────────────────────────────────────

  getMySubscriptions: protectedProcedure
    .query(async ({ ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      return db.select().from(irSubscriptions)
        .where(eq(irSubscriptions.userId, ctx.user.id))
        .orderBy(asc(irSubscriptions.companySymbol));
    }),

  upsertSubscription: protectedProcedure
    .input(z.object({
      companySymbol: z.string().min(1).max(16),
      notifyEarnings: z.boolean().default(true),
      notifyDividends: z.boolean().default(true),
      notifyDocuments: z.boolean().default(true),
      notifyEvents: z.boolean().default(true),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const [existing] = await db.select().from(irSubscriptions)
        .where(and(
          eq(irSubscriptions.userId, ctx.user.id),
          eq(irSubscriptions.companySymbol, input.companySymbol)
        ));

      if (existing) {
        const [updated] = await db.update(irSubscriptions)
          .set({
            notifyEarnings: input.notifyEarnings,
            notifyDividends: input.notifyDividends,
            notifyDocuments: input.notifyDocuments,
            notifyEvents: input.notifyEvents,
          })
          .where(eq(irSubscriptions.id, existing.id))
          .returning();
        return updated;
      }

      const [created] = await db.insert(irSubscriptions).values({
        userId: ctx.user.id,
        companySymbol: input.companySymbol,
        notifyEarnings: input.notifyEarnings,
        notifyDividends: input.notifyDividends,
        notifyDocuments: input.notifyDocuments,
        notifyEvents: input.notifyEvents,
      }).returning();
      return created;
    }),

  removeSubscription: protectedProcedure
    .input(z.object({ companySymbol: z.string().min(1).max(16) }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      await db.delete(irSubscriptions)
        .where(and(
          eq(irSubscriptions.userId, ctx.user.id),
          eq(irSubscriptions.companySymbol, input.companySymbol)
        ));
      return { success: true };
    }),

  // ─── Admin: Event Management ─────────────────────────────────────────────────

  adminCreateEvent: adminProcedure
    .input(z.object({
      companySymbol: z.string().min(1).max(16),
      companyName: z.string().min(1).max(128),
      eventType: z.enum([
        "EARNINGS_RELEASE", "DIVIDEND_ANNOUNCEMENT", "AGM", "EGM",
        "RIGHTS_ISSUE", "BONUS_ISSUE", "STOCK_SPLIT", "MERGER_ACQUISITION",
        "REGULATORY_FILING", "INVESTOR_PRESENTATION", "ROADSHOW", "OTHER",
      ]),
      title: z.string().min(1).max(256),
      description: z.string().optional(),
      eventDate: z.string().trim(), // ISO datetime string
      isAllDay: z.boolean().default(true),
      venue: z.string().max(256).optional(),
      webcastUrl: z.string().url().optional(),
      dividendPerShare: z.string().optional(),
      dividendCurrency: z.string().max(8).optional(),
      exDividendDate: z.string().optional(),
      recordDate: z.string().optional(),
      paymentDate: z.string().optional(),
      epsActual: z.string().optional(),
      epsEstimate: z.string().optional(),
      revenueActual: z.string().optional(),
      revenueEstimate: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const [event] = await db.insert(irEvents).values({
        companySymbol: input.companySymbol,
        companyName: input.companyName,
        eventType: input.eventType,
        title: input.title,
        description: input.description,
        eventDate: new Date(input.eventDate),
        isAllDay: input.isAllDay,
        venue: input.venue,
        webcastUrl: input.webcastUrl,
        dividendPerShare: input.dividendPerShare,
        dividendCurrency: input.dividendCurrency,
        exDividendDate: input.exDividendDate ? new Date(input.exDividendDate) : undefined,
        recordDate: input.recordDate ? new Date(input.recordDate) : undefined,
        paymentDate: input.paymentDate ? new Date(input.paymentDate) : undefined,
        epsActual: input.epsActual,
        epsEstimate: input.epsEstimate,
        revenueActual: input.revenueActual,
        revenueEstimate: input.revenueEstimate,
        createdBy: ctx.user.id,
      }).returning();
      return event;
    }),

  adminUpdateEvent: adminProcedure
    .input(z.object({
      id: z.number().int().positive(),
      title: z.string().min(1).max(256).optional(),
      description: z.string().optional(),
      eventDate: z.string().optional(),
      venue: z.string().max(256).optional(),
      webcastUrl: z.string().url().optional(),
      dividendPerShare: z.string().optional(),
      exDividendDate: z.string().optional(),
      recordDate: z.string().optional(),
      paymentDate: z.string().optional(),
      epsActual: z.string().optional(),
      revenueActual: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const updates: Record<string, any> = { updatedAt: new Date() };
      if (input.title !== undefined) updates.title = input.title;
      if (input.description !== undefined) updates.description = input.description;
      if (input.eventDate !== undefined) updates.eventDate = new Date(input.eventDate);
      if (input.venue !== undefined) updates.venue = input.venue;
      if (input.webcastUrl !== undefined) updates.webcastUrl = input.webcastUrl;
      if (input.dividendPerShare !== undefined) updates.dividendPerShare = input.dividendPerShare;
      if (input.exDividendDate !== undefined) updates.exDividendDate = new Date(input.exDividendDate);
      if (input.recordDate !== undefined) updates.recordDate = new Date(input.recordDate);
      if (input.paymentDate !== undefined) updates.paymentDate = new Date(input.paymentDate);
      if (input.epsActual !== undefined) updates.epsActual = input.epsActual;
      if (input.revenueActual !== undefined) updates.revenueActual = input.revenueActual;

      const [updated] = await db.update(irEvents).set(updates).where(eq(irEvents.id, input.id)).returning();
      if (!updated) throw new TRPCError({ code: "NOT_FOUND", message: "Event not found" });
      return updated;
    }),

  adminPublishEvent: adminProcedure
    .input(z.object({ id: z.number().int().positive(), publish: z.boolean() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const [updated] = await db.update(irEvents).set({
        isPublished: input.publish,
        publishedAt: input.publish ? new Date() : null,
        updatedAt: new Date(),
      }).where(eq(irEvents.id, input.id)).returning();
      if (!updated) throw new TRPCError({ code: "NOT_FOUND", message: "Event not found" });

      if (input.publish) {
        await notifyOwner({
          title: `IR Event Published: ${updated.title}`,
          content: `${updated.companySymbol} — ${updated.eventType} on ${new Date(updated.eventDate).toLocaleDateString()}`,
        });
      }
      return updated;
    }),

  adminDeleteEvent: adminProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      await db.delete(irEvents).where(eq(irEvents.id, input.id));
      return { success: true };
    }),

  adminListAllEvents: adminProcedure
    .input(z.object({
      companySymbol: z.string().max(16).optional(),
      limit: z.number().int().min(1).max(200).default(100),
    }).optional())
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

       const conditions: ReturnType<typeof eq>[] = [];
      if (input?.companySymbol) conditions.push(eq(irEvents.companySymbol, input.companySymbol));
      const rows = conditions.length > 0
        ? await db.select().from(irEvents).where(and(...conditions)).orderBy(desc(irEvents.eventDate)).limit(input?.limit ?? 100)
        : await db.select().from(irEvents).orderBy(desc(irEvents.eventDate)).limit(input?.limit ?? 100);
      return { events: rows, total: rows.length };
    }),

  // ─── Admin: Document Library Management ──────────────────────────────────────

  adminCreateDocument: adminProcedure
    .input(z.object({
      companySymbol: z.string().min(1).max(16),
      companyName: z.string().min(1).max(128),
      documentType: z.enum([
        "ANNUAL_REPORT", "INTERIM_REPORT", "QUARTERLY_REPORT",
        "PROSPECTUS", "CIRCULAR", "PRESS_RELEASE", "PRESENTATION",
        "FINANCIAL_STATEMENT", "REGULATORY_FILING", "OTHER",
      ]),
      title: z.string().min(1).max(256),
      description: z.string().optional(),
      fiscalYear: z.number().int().optional(),
      fiscalPeriod: z.string().max(16).optional(),
      fileUrl: z.string().url(),
      fileKey: z.string().min(1).max(512),
      fileSizeBytes: z.number().int().optional(),
      mimeType: z.string().max(64).default("application/pdf"),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const [doc] = await db.insert(irDocuments).values({
        companySymbol: input.companySymbol,
        companyName: input.companyName,
        documentType: input.documentType,
        title: input.title,
        description: input.description,
        fiscalYear: input.fiscalYear,
        fiscalPeriod: input.fiscalPeriod,
        fileUrl: input.fileUrl,
        fileKey: input.fileKey,
        fileSizeBytes: input.fileSizeBytes,
        mimeType: input.mimeType,
        createdBy: ctx.user.id,
      }).returning();
      return doc;
    }),

  adminPublishDocument: adminProcedure
    .input(z.object({ id: z.number().int().positive(), publish: z.boolean() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const [updated] = await db.update(irDocuments).set({
        isPublished: input.publish,
        publishedAt: input.publish ? new Date() : null,
        updatedAt: new Date(),
      }).where(eq(irDocuments.id, input.id)).returning();
      if (!updated) throw new TRPCError({ code: "NOT_FOUND", message: "Document not found" });
      return updated;
    }),

  adminDeleteDocument: adminProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      await db.delete(irDocuments).where(eq(irDocuments.id, input.id));
      return { success: true };
    }),

  adminListAllDocuments: adminProcedure
    .input(z.object({
      companySymbol: z.string().max(16).optional(),
      limit: z.number().int().min(1).max(200).default(100),
    }).optional())
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const conditions: ReturnType<typeof eq>[] = [];
      if (input?.companySymbol) conditions.push(eq(irDocuments.companySymbol, input.companySymbol));

      return conditions.length > 0
        ? db.select().from(irDocuments).where(and(...conditions)).orderBy(desc(irDocuments.createdAt)).limit(input?.limit ?? 100)
        : db.select().from(irDocuments).orderBy(desc(irDocuments.createdAt)).limit(input?.limit ?? 100);
    }),

  // ─── Admin: Shareholder Registry Management ───────────────────────────────────

  adminUpsertShareholder: adminProcedure
    .input(z.object({
      companySymbol: z.string().min(1).max(16),
      userId: z.number().int().positive(),
      shareholderName: z.string().min(1).max(128),
      shareholderType: z.enum(["INDIVIDUAL", "INSTITUTIONAL", "INSIDER", "GOVERNMENT"]).default("INDIVIDUAL"),
      sharesHeld: z.string().trim(), // numeric string
      totalShares: z.string().trim(), // numeric string
      acquisitionDate: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const sharesHeld = parseFloat(input.sharesHeld);
      const totalShares = parseFloat(input.totalShares);
      if (totalShares <= 0) throw new TRPCError({ code: "BAD_REQUEST", message: "totalShares must be > 0" });
      const holdingPct = (sharesHeld / totalShares) * 100;

      const [existing] = await db.select().from(shareholderRegistry)
        .where(and(
          eq(shareholderRegistry.companySymbol, input.companySymbol),
          eq(shareholderRegistry.userId, input.userId)
        ));

      if (existing) {
        const [updated] = await db.update(shareholderRegistry).set({
          shareholderName: input.shareholderName,
          shareholderType: input.shareholderType,
          sharesHeld: input.sharesHeld,
          totalShares: input.totalShares,
          holdingPct: String(holdingPct.toFixed(6)),
          acquisitionDate: input.acquisitionDate ? new Date(input.acquisitionDate) : existing.acquisitionDate,
          lastUpdatedAt: new Date(),
        }).where(eq(shareholderRegistry.id, existing.id)).returning();
        return updated;
      }

      const [created] = await db.insert(shareholderRegistry).values({
        companySymbol: input.companySymbol,
        userId: input.userId,
        shareholderName: input.shareholderName,
        shareholderType: input.shareholderType,
        sharesHeld: input.sharesHeld,
        totalShares: input.totalShares,
        holdingPct: String(holdingPct.toFixed(6)),
        acquisitionDate: input.acquisitionDate ? new Date(input.acquisitionDate) : undefined,
      }).returning();
      return created;
    }),

  adminDeleteShareholder: adminProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      await db.delete(shareholderRegistry).where(eq(shareholderRegistry.id, input.id));
      return { success: true };
    }),

  adminGetStats: adminProcedure
    .query(async () => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const [totalEvents, totalDocs, totalShareholders, totalSubscriptions] = await Promise.all([
        db.select().from(irEvents),
        db.select().from(irDocuments),
        db.select().from(shareholderRegistry),
        db.select().from(irSubscriptions),
      ]);

      const publishedEvents = totalEvents.filter((e) => e.isPublished).length;
      const publishedDocs = totalDocs.filter((d) => d.isPublished).length;
      const totalDownloads = totalDocs.reduce((sum, d) => sum + d.downloadCount, 0);

      return {
        totalEvents: totalEvents.length,
        publishedEvents,
        draftEvents: totalEvents.length - publishedEvents,
        totalDocuments: totalDocs.length,
        publishedDocuments: publishedDocs,
        draftDocuments: totalDocs.length - publishedDocs,
        totalDownloads,
        totalShareholders: totalShareholders.length,
        totalSubscriptions: totalSubscriptions.length,
      };
    }),
});
