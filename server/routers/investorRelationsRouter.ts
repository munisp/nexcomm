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
import { writeAuditLog } from "../audit";


// ─── In-memory fallback stores ────────────────────────────────────────────────
type MemIREvent = { id: number; companySymbol: string; companyName: string; eventType: string; title: string; eventDate: string; description: string | null; epsActual: string | null; epsEstimate: string | null; revenueActual: string | null; revenueEstimate: string | null; dividendAmount: string | null; dividendPayDate: string | null; dividendPerShare: string | null; dividendCurrency: string | null; exDividendDate: string | null; paymentDate: string | null; isAllDay: boolean; venue: string | null; webcastUrl: string | null; isPublished: boolean; publishedAt: Date | null; createdBy: number | null; createdAt: Date; updatedAt: Date; };
type MemIRDoc = { id: number; companySymbol: string; companyName: string; documentType: string; title: string; description: string | null; fiscalYear: number | null; fiscalPeriod: string | null; fileUrl: string; fileKey: string; fileSizeBytes: number | null; isPublished: boolean; publishedAt: Date | null; downloadCount: number; createdBy: number | null; createdAt: Date; updatedAt: Date; };
type MemIRShareholder = { id: number; companySymbol: string; userId: number | null; shareholderName: string; shareholderType: string; sharesHeld: string; totalShares: string; holdingPct: string; asOfDate: string | null; createdAt: Date; updatedAt: Date; };
type MemIRSub = { id: number; userId: number; companySymbol: string; notifyEarnings: boolean; notifyDividends: boolean; notifyAGM: boolean; notifyAnnualReport: boolean; createdAt: Date; updatedAt: Date; };
const _irEvents = new Map<number, MemIREvent>();
const _irDocs = new Map<number, MemIRDoc>();
const _irShareholders = new Map<number, MemIRShareholder>();
const _irSubs = new Map<number, MemIRSub>();
let _irEvSeq = 1; let _irDocSeq = 1; let _irShSeq = 1; let _irSubSeq = 1;

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
      if (!db) {
        let events = Array.from(_irEvents.values());
        if (input?.companySymbol) events = events.filter(e => e.companySymbol === input.companySymbol);
        if (input?.eventType && input.eventType !== "ALL") events = events.filter(e => e.eventType === input.eventType);
        if (input?.publishedOnly !== false) events = events.filter(e => e.isPublished);
        return { events: events.slice(input?.offset ?? 0, (input?.offset ?? 0) + (input?.limit ?? 50)), total: events.length };
      }

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
      if (!db) {
        const event = _irEvents.get(input.id);
        if (!event) throw new TRPCError({ code: "NOT_FOUND", message: "Event not found" });
        return event;
      }
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
      if (!db) {
        let docs = Array.from(_irDocs.values());
        if (input?.companySymbol) docs = docs.filter(d => d.companySymbol === input.companySymbol);
        if (input?.documentType && input.documentType !== "ALL") docs = docs.filter(d => d.documentType === input.documentType);
        if (input?.publishedOnly !== false) docs = docs.filter(d => d.isPublished);
        return { documents: docs.slice(input?.offset ?? 0, (input?.offset ?? 0) + (input?.limit ?? 50)), total: docs.length };
      }

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
            if (!db) throw new TRPCError({ code: "NOT_FOUND", message: "Not found" });
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
      if (!db) {
        let shareholders = Array.from(_irShareholders.values()).filter(s => s.companySymbol === input.companySymbol);
        if (input.shareholderType !== "ALL") shareholders = shareholders.filter(s => s.shareholderType === input.shareholderType);
        return { shareholders: shareholders.slice(input.offset, input.offset + input.limit), totalShares: 0, topHoldersPct: "0" };
      }

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
      if (!db) {
        let holdings = Array.from(_irShareholders.values()).filter(s => s.userId === ctx.user.id);
        if (input.companySymbol) holdings = holdings.filter(s => s.companySymbol === input.companySymbol);
        return holdings;
      }

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
      if (!db) return Array.from(_irSubs.values()).filter(s => s.userId === ctx.user.id);
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
      if (!db) {
        const existing = Array.from(_irSubs.values()).find(s => s.userId === ctx.user.id && s.companySymbol === input.companySymbol);
        if (existing) {
          existing.notifyEarnings = input.notifyEarnings;
          existing.notifyDividends = input.notifyDividends;
          existing.updatedAt = new Date();
          return existing;
        }
        const id = _irSubSeq++;
        const sub: MemIRSub = {
          id, userId: ctx.user.id, companySymbol: input.companySymbol,
          notifyEarnings: input.notifyEarnings, notifyDividends: input.notifyDividends,
          notifyAGM: (input as any).notifyAGM ?? false, notifyAnnualReport: (input as any).notifyAnnualReport ?? false,
          createdAt: new Date(), updatedAt: new Date(),
        };
        _irSubs.set(id, sub);
        return sub;
      }

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
      if (!db) {
        const sub = Array.from(_irSubs.values()).find(s => s.userId === ctx.user.id && s.companySymbol === input.companySymbol);
        if (sub) _irSubs.delete(sub.id);
        return { success: true };
      }
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
      if (!db) {
        const id = _irEvSeq++;
        const now = new Date();
        const event: MemIREvent = {
          id, companySymbol: input.companySymbol, companyName: input.companyName,
          eventType: input.eventType, title: input.title,
          eventDate: input.eventDate,
          description: input.description ?? null,
          epsActual: input.epsActual ?? null, epsEstimate: input.epsEstimate ?? null,
          revenueActual: input.revenueActual ?? null, revenueEstimate: input.revenueEstimate ?? null,
          dividendAmount: input.dividendPerShare ?? null, dividendPayDate: input.paymentDate ?? null,
          dividendPerShare: input.dividendPerShare ?? null, dividendCurrency: input.dividendCurrency ?? null,
          exDividendDate: input.exDividendDate ?? null, paymentDate: input.paymentDate ?? null,
          isAllDay: input.isAllDay ?? true, venue: input.venue ?? null, webcastUrl: input.webcastUrl ?? null,
          isPublished: false, publishedAt: null, createdBy: ctx.user.id,
          createdAt: now, updatedAt: now,
        };
        _irEvents.set(id, event);
        return event;
      }

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
      if (!db) {
        const event = _irEvents.get(input.id);
        if (!event) throw new TRPCError({ code: "NOT_FOUND" });
        if (input.title !== undefined) event.title = input.title;
        if (input.description !== undefined) event.description = input.description ?? null;
        event.updatedAt = new Date();
        return event;
      }

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
      if (!db) {
        const event = _irEvents.get(input.id);
        if (!event) throw new TRPCError({ code: "NOT_FOUND" });
        event.isPublished = input.publish;
        event.publishedAt = input.publish ? new Date() : null;
        event.updatedAt = new Date();
        return event;
      }

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
      if (!db) {
        _irEvents.delete(input.id);
        return { success: true };
      }
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
      if (!db) {
        let events = Array.from(_irEvents.values());
        if (input?.companySymbol) events = events.filter(e => e.companySymbol === input.companySymbol);
        return { events, total: events.length };
      }

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
            if (!db) {
        const id = _irDocSeq++;
        const now = new Date();
        const doc: MemIRDoc = {
          id, companySymbol: input.companySymbol, companyName: input.companyName,
          documentType: input.documentType, title: input.title, description: (input as any).description ?? null,
          fiscalYear: input.fiscalYear ?? null, fiscalPeriod: input.fiscalPeriod ?? null,
          fileUrl: input.fileUrl, fileKey: input.fileKey,
          fileSizeBytes: input.fileSizeBytes ?? null,
          isPublished: false, publishedAt: null, downloadCount: 0,
          createdBy: (ctx as any).user?.id ?? null, createdAt: now, updatedAt: now,
        };
        _irDocs.set(id, doc);
        return doc;
      }

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
      if (!db) {
        const doc = _irDocs.get(input.id);
        if (!doc) throw new TRPCError({ code: "NOT_FOUND" });
        doc.isPublished = input.publish;
        doc.publishedAt = input.publish ? new Date() : null;
        doc.updatedAt = new Date();
        return doc;
      }

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
      if (!db) {
        _irDocs.delete(input.id);
        return { success: true };
      }
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
      if (!db) {
        let docs = Array.from(_irDocs.values());
        if (input?.companySymbol) docs = docs.filter(d => d.companySymbol === input.companySymbol);
        return docs;
      }

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
      if (!db) {
        const sharesHeld = parseFloat(input.sharesHeld);
        const totalShares = parseFloat(input.totalShares);
        const holdingPct = (sharesHeld / totalShares * 100).toFixed(6);
        const existing = Array.from(_irShareholders.values()).find(s => s.companySymbol === input.companySymbol && s.userId === input.userId);
        if (existing) {
          existing.shareholderType = input.shareholderType;
          existing.sharesHeld = input.sharesHeld;
          existing.totalShares = input.totalShares;
          existing.holdingPct = holdingPct;
          existing.updatedAt = new Date();
          return existing;
        }
        const id = _irShSeq++;
        const sh: MemIRShareholder = {
          id, companySymbol: input.companySymbol, userId: input.userId,
          shareholderName: input.shareholderName, shareholderType: input.shareholderType,
          sharesHeld: input.sharesHeld, totalShares: input.totalShares,
          holdingPct, asOfDate: null, createdAt: new Date(), updatedAt: new Date(),
        };
        _irShareholders.set(id, sh);
        return sh;
      }

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
      if (!db) {
        _irShareholders.delete(input.id);
        return { success: true };
      }
      await db.delete(shareholderRegistry).where(eq(shareholderRegistry.id, input.id));
      return { success: true };
    }),

  adminGetStats: adminProcedure
    .query(async () => {
      const db = await getDb();
      if (!db) {
        const events = Array.from(_irEvents.values());
        const docs = Array.from(_irDocs.values());
        return {
          totalEvents: events.length,
          publishedEvents: events.filter(e => e.isPublished).length,
          draftEvents: events.filter(e => !e.isPublished).length,
          totalDocuments: docs.length,
          publishedDocuments: docs.filter(d => d.isPublished).length,
          draftDocuments: docs.filter(d => !d.isPublished).length,
          totalDownloads: 0,
          totalShareholders: _irShareholders.size,
          totalSubscriptions: _irSubs.size,
        };
      }

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
