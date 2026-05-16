/**
 * Market Maker Obligations Engine Router
 * Manages market maker profiles, obligations, quote snapshots, and performance reports.
 * Includes automated penalty calculation and admin review workflow.
 */
import { z } from "zod";
import { eq, and, desc, gte, lte, sql, inArray } from "drizzle-orm";
import { protectedProcedure, publicProcedure, router } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import { getDb } from "../db";
import {
  marketMakerProfiles,
  marketMakerObligations,
  marketMakerQuoteSnapshots,
  marketMakerPerformanceReports,
} from "../../drizzle/schema";
import { notifyOwner } from "../_core/notification";
import { writeAuditLog } from "../audit";

// ─── Admin guard ─────────────────────────────────────────────────────────────
const adminProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (ctx.user.role !== "admin")
    throw new TRPCError({ code: "FORBIDDEN", message: "Admin access required" });
  return next({ ctx });
});

// ─── Helpers ─────────────────────────────────────────────────────────────────
function calcSpreadBps(bid: number, ask: number): number {
  if (bid <= 0 || ask <= 0) return 9999;
  return Math.round(((ask - bid) / bid) * 10000);
}

function evaluateQuoteCompliance(
  bid: number | null,
  ask: number | null,
  bidSize: number | null,
  askSize: number | null,
  obligation: { maxSpreadBps: number; minBidSize: string; minAskSize: string }
): { isCompliant: boolean; breachType: string | null; spreadBps: number | null } {
  if (bid === null || ask === null || bidSize === null || askSize === null) {
    return { isCompliant: false, breachType: "ABSENT", spreadBps: null };
  }
  const spreadBps = calcSpreadBps(bid, ask);
  const minBid = parseFloat(obligation.minBidSize);
  const minAsk = parseFloat(obligation.minAskSize);

  if (spreadBps > obligation.maxSpreadBps) {
    return { isCompliant: false, breachType: "SPREAD_TOO_WIDE", spreadBps };
  }
  if (bidSize < minBid || askSize < minAsk) {
    return { isCompliant: false, breachType: "SIZE_TOO_SMALL", spreadBps };
  }
  return { isCompliant: true, breachType: null, spreadBps };
}

// ─── In-memory fallback stores ────────────────────────────────────────────────
type MemProfile = {
  id: number; userId: number; firmName: string; licenseNumber: string | null;
  assetClasses: string; instruments: string; status: string;
  approvedBy: number | null; approvedAt: Date | null;
  suspendedAt: Date | null; suspensionReason: string | null;
  createdAt: Date; updatedAt: Date;
};
type MemObligation = {
  id: number; marketMakerId: number; instrument: string; assetClass: string;
  minBidSize: string; minAskSize: string; maxSpreadBps: number; minUptimePct: string;
  penaltyPerBreachNgn: string; effectiveFrom: Date; effectiveTo: Date | null;
  isActive: boolean; createdBy: number | null; createdAt: Date; updatedAt: Date;
};
type MemSnapshot = {
  id: number; marketMakerId: number; obligationId: number; instrument: string;
  bidPrice: string | null; askPrice: string | null; bidSize: string | null; askSize: string | null;
  spreadBps: number | null; isCompliant: boolean; breachType: string | null;
  tradingSessionDate: string; snapshotAt: Date;
};
type MemPerfReport = {
  id: number; marketMakerId: number; obligationId: number; instrument: string;
  reportDate: string; totalSnapshots: number; compliantSnapshots: number;
  uptimePct: string; avgSpreadBps: number; maxSpreadBps: number;
  spreadBreaches: number; sizeBreaches: number; absenceBreaches: number;
  totalBreaches: number; penaltyAmount: string; penaltyStatus: string;
  notes: string | null; reviewedBy: number | null; reviewedAt: Date | null;
  generatedAt: Date;
};

const _memProfiles = new Map<number, MemProfile>();
const _memObligations = new Map<number, MemObligation>();
const _memSnapshots = new Map<number, MemSnapshot>();
const _memPerfReports = new Map<number, MemPerfReport>();
let _profSeq = 1;
let _oblSeq = 1;
let _snapSeq = 1;
let _repSeq = 1;

function parseProfile(p: MemProfile) {
  return {
    ...p,
    assetClasses: JSON.parse(p.assetClasses) as string[],
    instruments: JSON.parse(p.instruments) as string[],
  };
}

export const marketMakerRouter = router({
  // ─── Admin: Profile Management ─────────────────────────────────────────────
  adminCreateProfile: adminProcedure
    .input(z.object({
      userId: z.number().int().positive(),
      firmName: z.string().min(2).max(128),
      licenseNumber: z.string().max(64).optional(),
      assetClasses: z.array(z.enum(["COMMODITY", "EQUITY", "FOREX", "BOND"])).min(1),
      instruments: z.array(z.string().min(1)).min(1),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) {
        const id = _profSeq++;
        const now = new Date();
        const profile: MemProfile = {
          id, userId: input.userId, firmName: input.firmName,
          licenseNumber: input.licenseNumber ?? null,
          assetClasses: JSON.stringify(input.assetClasses),
          instruments: JSON.stringify(input.instruments),
          status: "ACTIVE", approvedBy: ctx.user.id, approvedAt: now,
          suspendedAt: null, suspensionReason: null, createdAt: now, updatedAt: now,
        };
        _memProfiles.set(id, profile);
        return parseProfile(profile);
      }
      const [profile] = await db.insert(marketMakerProfiles).values({
        userId: input.userId,
        firmName: input.firmName,
        licenseNumber: input.licenseNumber ?? null,
        assetClasses: JSON.stringify(input.assetClasses),
        instruments: JSON.stringify(input.instruments),
        status: "ACTIVE",
        approvedBy: ctx.user.id,
        approvedAt: new Date(),
      }).returning();
      await notifyOwner({
        title: "New Market Maker Registered",
        content: `${input.firmName} (User #${input.userId}) has been registered as a market maker.`,
      });
      return profile;
    }),

  adminListProfiles: adminProcedure
    .input(z.object({
      status: z.enum(["ACTIVE", "SUSPENDED", "REVOKED", "ALL"]).default("ALL"),
    }).optional())
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) {
        const status = input?.status ?? "ALL";
        let results = Array.from(_memProfiles.values());
        if (status !== "ALL") results = results.filter(p => p.status === status);
        return results.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).map(parseProfile);
      }
      const status = input?.status ?? "ALL";
      const rows = await db.select().from(marketMakerProfiles)
        .where(status !== "ALL" ? eq(marketMakerProfiles.status, status) : undefined)
        .orderBy(desc(marketMakerProfiles.createdAt));
      return rows.map(r => ({
        ...r,
        assetClasses: JSON.parse(r.assetClasses) as string[],
        instruments: JSON.parse(r.instruments) as string[],
      }));
    }),

  adminGetProfile: adminProcedure
    .input(z.object({ profileId: z.number().int().positive() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) {
        const p = _memProfiles.get(input.profileId);
        if (!p) throw new TRPCError({ code: "NOT_FOUND", message: "Profile not found" });
        return parseProfile(p);
      }
      const [profile] = await db.select().from(marketMakerProfiles)
        .where(eq(marketMakerProfiles.id, input.profileId));
      if (!profile) throw new TRPCError({ code: "NOT_FOUND", message: "Profile not found" });
      return {
        ...profile,
        assetClasses: JSON.parse(profile.assetClasses) as string[],
        instruments: JSON.parse(profile.instruments) as string[],
      };
    }),

  adminUpdateProfileStatus: adminProcedure
    .input(z.object({
      profileId: z.number().int().positive(),
      status: z.enum(["ACTIVE", "SUSPENDED", "REVOKED"]),
      reason: z.string().max(512).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) {
        const p = _memProfiles.get(input.profileId);
        if (!p) throw new TRPCError({ code: "NOT_FOUND", message: "Profile not found" });
        p.status = input.status;
        p.updatedAt = new Date();
        if (input.status === "SUSPENDED") {
          p.suspendedAt = new Date();
          p.suspensionReason = input.reason ?? null;
        }
        return parseProfile(p);
      }
      const updates: Record<string, unknown> = {
        status: input.status,
        updatedAt: new Date(),
      };
      if (input.status === "SUSPENDED") {
        updates.suspendedAt = new Date();
        updates.suspensionReason = input.reason ?? null;
      }
      const [updated] = await db.update(marketMakerProfiles)
        .set(updates)
        .where(eq(marketMakerProfiles.id, input.profileId))
        .returning();
      if (!updated) throw new TRPCError({ code: "NOT_FOUND", message: "Profile not found" });
      if (input.status === "SUSPENDED") {
        await notifyOwner({
          title: "Market Maker Suspended",
          content: `${updated.firmName} has been suspended. Reason: ${input.reason ?? "Not specified"}`,
        });
      }
      return updated;
    }),

  // ─── Admin: Obligation Management ──────────────────────────────────────────
  adminCreateObligation: adminProcedure
    .input(z.object({
      marketMakerId: z.number().int().positive(),
      instrument: z.string().min(1).max(32),
      assetClass: z.enum(["COMMODITY", "EQUITY", "FOREX", "BOND"]),
      minBidSize: z.number().positive(),
      minAskSize: z.number().positive(),
      maxSpreadBps: z.number().int().positive().max(10000),
      minUptimePct: z.number().min(0).max(100).default(90),
      penaltyPerBreachNgn: z.number().positive().default(50000),
      effectiveFrom: z.date().default(() => new Date()),
      effectiveTo: z.date().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) {
        const id = _oblSeq++;
        const now = new Date();
        const obl: MemObligation = {
          id, marketMakerId: input.marketMakerId, instrument: input.instrument,
          assetClass: input.assetClass, minBidSize: String(input.minBidSize),
          minAskSize: String(input.minAskSize), maxSpreadBps: input.maxSpreadBps,
          minUptimePct: String(input.minUptimePct),
          penaltyPerBreachNgn: String(input.penaltyPerBreachNgn),
          effectiveFrom: input.effectiveFrom, effectiveTo: input.effectiveTo ?? null,
          isActive: true, createdBy: ctx.user.id, createdAt: now, updatedAt: now,
        };
        _memObligations.set(id, obl);
        return obl;
      }
      const [obligation] = await db.insert(marketMakerObligations).values({
        marketMakerId: input.marketMakerId,
        instrument: input.instrument,
        assetClass: input.assetClass,
        minBidSize: String(input.minBidSize),
        minAskSize: String(input.minAskSize),
        maxSpreadBps: input.maxSpreadBps,
        minUptimePct: String(input.minUptimePct),
        penaltyPerBreachNgn: String(input.penaltyPerBreachNgn),
        effectiveFrom: input.effectiveFrom,
        effectiveTo: input.effectiveTo ?? null,
        createdBy: ctx.user.id,
      }).returning();
      return obligation;
    }),

  adminListObligations: adminProcedure
    .input(z.object({
      marketMakerId: z.number().int().positive().optional(),
      activeOnly: z.boolean().default(true),
    }).optional())
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) {
        let results = Array.from(_memObligations.values());
        if (input?.marketMakerId) results = results.filter(o => o.marketMakerId === input.marketMakerId);
        if (input?.activeOnly !== false) results = results.filter(o => o.isActive);
        return results.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      }
      const conditions = [];
      if (input?.marketMakerId) conditions.push(eq(marketMakerObligations.marketMakerId, input.marketMakerId));
      if (input?.activeOnly !== false) conditions.push(eq(marketMakerObligations.isActive, true));
      return db.select().from(marketMakerObligations)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(marketMakerObligations.createdAt));
    }),

  adminDeactivateObligation: adminProcedure
    .input(z.object({ obligationId: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) {
        const o = _memObligations.get(input.obligationId);
        if (!o) throw new TRPCError({ code: "NOT_FOUND", message: "Obligation not found" });
        o.isActive = false;
        o.effectiveTo = new Date();
        o.updatedAt = new Date();
        return o;
      }
      const [updated] = await db.update(marketMakerObligations)
        .set({ isActive: false, effectiveTo: new Date(), updatedAt: new Date() })
        .where(eq(marketMakerObligations.id, input.obligationId))
        .returning();
      if (!updated) throw new TRPCError({ code: "NOT_FOUND", message: "Obligation not found" });
      return updated;
    }),

  // ─── Quote Snapshot Recording ───────────────────────────────────────────────
  recordQuoteSnapshot: protectedProcedure
    .input(z.object({
      obligationId: z.number().int().positive(),
      bidPrice: z.number().positive().optional(),
      askPrice: z.number().positive().optional(),
      bidSize: z.number().positive().optional(),
      askSize: z.number().positive().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) {
        // Find the user's active profile
        const profile = Array.from(_memProfiles.values()).find(
          p => p.userId === ctx.user.id && p.status === "ACTIVE"
        );
        if (!profile) throw new TRPCError({ code: "FORBIDDEN", message: "No active market maker profile" });
        const obligation = _memObligations.get(input.obligationId);
        if (!obligation || obligation.marketMakerId !== profile.id || !obligation.isActive) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Obligation not found" });
        }
        const { isCompliant, breachType, spreadBps } = evaluateQuoteCompliance(
          input.bidPrice ?? null, input.askPrice ?? null,
          input.bidSize ?? null, input.askSize ?? null, obligation
        );
        const id = _snapSeq++;
        const today = new Date().toISOString().slice(0, 10);
        const snap: MemSnapshot = {
          id, marketMakerId: profile.id, obligationId: input.obligationId,
          instrument: obligation.instrument,
          bidPrice: input.bidPrice ? String(input.bidPrice) : null,
          askPrice: input.askPrice ? String(input.askPrice) : null,
          bidSize: input.bidSize ? String(input.bidSize) : null,
          askSize: input.askSize ? String(input.askSize) : null,
          spreadBps, isCompliant, breachType: breachType ?? null,
          tradingSessionDate: today, snapshotAt: new Date(),
        };
        _memSnapshots.set(id, snap);
        return snap;
      }

      // Verify market maker profile exists for this user
      const [profile] = await db.select().from(marketMakerProfiles)
        .where(and(eq(marketMakerProfiles.userId, ctx.user.id), eq(marketMakerProfiles.status, "ACTIVE")));
      if (!profile) throw new TRPCError({ code: "FORBIDDEN", message: "No active market maker profile" });

      const [obligation] = await db.select().from(marketMakerObligations)
        .where(and(
          eq(marketMakerObligations.id, input.obligationId),
          eq(marketMakerObligations.marketMakerId, profile.id),
          eq(marketMakerObligations.isActive, true),
        ));
      if (!obligation) throw new TRPCError({ code: "NOT_FOUND", message: "Obligation not found" });

      const { isCompliant, breachType, spreadBps } = evaluateQuoteCompliance(
        input.bidPrice ?? null,
        input.askPrice ?? null,
        input.bidSize ?? null,
        input.askSize ?? null,
        obligation,
      );

      const today = new Date().toISOString().slice(0, 10);
      const [snapshot] = await db.insert(marketMakerQuoteSnapshots).values({
        marketMakerId: profile.id,
        obligationId: input.obligationId,
        instrument: obligation.instrument,
        bidPrice: input.bidPrice ? String(input.bidPrice) : null,
        askPrice: input.askPrice ? String(input.askPrice) : null,
        bidSize: input.bidSize ? String(input.bidSize) : null,
        askSize: input.askSize ? String(input.askSize) : null,
        spreadBps,
        isCompliant,
        breachType: breachType ?? null,
        tradingSessionDate: today,
      }).returning();
      return snapshot;
    }),

  // ─── Admin: Quote Snapshots ─────────────────────────────────────────────────
  adminListSnapshots: adminProcedure
    .input(z.object({
      marketMakerId: z.number().int().positive().optional(),
      obligationId: z.number().int().positive().optional(),
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      limit: z.number().int().min(1).max(500).default(100),
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) {
        let results = Array.from(_memSnapshots.values());
        if (input.marketMakerId) results = results.filter(s => s.marketMakerId === input.marketMakerId);
        if (input.obligationId) results = results.filter(s => s.obligationId === input.obligationId);
        if (input.date) results = results.filter(s => s.tradingSessionDate === input.date);
        return results.sort((a, b) => b.snapshotAt.getTime() - a.snapshotAt.getTime()).slice(0, input.limit);
      }
      const conditions = [];
      if (input.marketMakerId) conditions.push(eq(marketMakerQuoteSnapshots.marketMakerId, input.marketMakerId));
      if (input.obligationId) conditions.push(eq(marketMakerQuoteSnapshots.obligationId, input.obligationId));
      if (input.date) conditions.push(eq(marketMakerQuoteSnapshots.tradingSessionDate, input.date));
      return db.select().from(marketMakerQuoteSnapshots)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(marketMakerQuoteSnapshots.snapshotAt))
        .limit(input.limit);
    }),

  // ─── Performance Report Generation ─────────────────────────────────────────
  adminGeneratePerformanceReport: adminProcedure
    .input(z.object({
      marketMakerId: z.number().int().positive(),
      obligationId: z.number().int().positive(),
      reportDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) {
        const obligation = _memObligations.get(input.obligationId);
        if (!obligation) throw new TRPCError({ code: "NOT_FOUND", message: "Obligation not found" });
        const snapshots = Array.from(_memSnapshots.values()).filter(
          s => s.marketMakerId === input.marketMakerId &&
               s.obligationId === input.obligationId &&
               s.tradingSessionDate === input.reportDate
        );
        const total = snapshots.length;
        const compliant = snapshots.filter(s => s.isCompliant).length;
        const spreadBreaches = snapshots.filter(s => s.breachType === "SPREAD_TOO_WIDE").length;
        const sizeBreaches = snapshots.filter(s => s.breachType === "SIZE_TOO_SMALL").length;
        const absenceBreaches = snapshots.filter(s => s.breachType === "ABSENT").length;
        const totalBreaches = spreadBreaches + sizeBreaches + absenceBreaches;
        const uptimePct = total > 0 ? (compliant / total) * 100 : 0;
        const validSpreads = snapshots.filter(s => s.spreadBps !== null).map(s => s.spreadBps as number);
        const avgSpreadBps = validSpreads.length > 0
          ? Math.round(validSpreads.reduce((a, b) => a + b, 0) / validSpreads.length) : 0;
        const maxSpreadBps = validSpreads.length > 0 ? Math.max(...validSpreads) : 0;
        const penaltyAmount = totalBreaches * parseFloat(obligation.penaltyPerBreachNgn);
        const id = _repSeq++;
        const report: MemPerfReport = {
          id, marketMakerId: input.marketMakerId, obligationId: input.obligationId,
          instrument: obligation.instrument, reportDate: input.reportDate,
          totalSnapshots: total, compliantSnapshots: compliant,
          uptimePct: uptimePct.toFixed(2), avgSpreadBps, maxSpreadBps,
          spreadBreaches, sizeBreaches, absenceBreaches, totalBreaches,
          penaltyAmount: penaltyAmount.toFixed(2), penaltyStatus: "PENDING",
          notes: null, reviewedBy: null, reviewedAt: null, generatedAt: new Date(),
        };
        _memPerfReports.set(id, report);
        return report;
      }

      const [obligation] = await db.select().from(marketMakerObligations)
        .where(eq(marketMakerObligations.id, input.obligationId));
      if (!obligation) throw new TRPCError({ code: "NOT_FOUND", message: "Obligation not found" });

      // Aggregate snapshots for the given date
      const snapshots = await db.select().from(marketMakerQuoteSnapshots)
        .where(and(
          eq(marketMakerQuoteSnapshots.marketMakerId, input.marketMakerId),
          eq(marketMakerQuoteSnapshots.obligationId, input.obligationId),
          eq(marketMakerQuoteSnapshots.tradingSessionDate, input.reportDate),
        ));

      const total = snapshots.length;
      const compliant = snapshots.filter(s => s.isCompliant).length;
      const spreadBreaches = snapshots.filter(s => s.breachType === "SPREAD_TOO_WIDE").length;
      const sizeBreaches = snapshots.filter(s => s.breachType === "SIZE_TOO_SMALL").length;
      const absenceBreaches = snapshots.filter(s => s.breachType === "ABSENT").length;
      const totalBreaches = spreadBreaches + sizeBreaches + absenceBreaches;
      const uptimePct = total > 0 ? (compliant / total) * 100 : 0;
      const validSpreads = snapshots.filter(s => s.spreadBps !== null).map(s => s.spreadBps as number);
      const avgSpreadBps = validSpreads.length > 0
        ? Math.round(validSpreads.reduce((a, b) => a + b, 0) / validSpreads.length)
        : 0;
      const maxSpreadBps = validSpreads.length > 0 ? Math.max(...validSpreads) : 0;
      const penaltyAmount = totalBreaches * parseFloat(obligation.penaltyPerBreachNgn);

      const [report] = await db.insert(marketMakerPerformanceReports).values({
        marketMakerId: input.marketMakerId,
        obligationId: input.obligationId,
        instrument: obligation.instrument,
        reportDate: input.reportDate,
        totalSnapshots: total,
        compliantSnapshots: compliant,
        uptimePct: String(uptimePct.toFixed(2)),
        avgSpreadBps,
        maxSpreadBps,
        spreadBreaches,
        sizeBreaches,
        absenceBreaches,
        totalBreaches,
        penaltyAmount: String(penaltyAmount.toFixed(2)),
        penaltyStatus: "PENDING",
      }).returning();

      if (totalBreaches > 0) {
        await notifyOwner({
          title: "Market Maker Obligation Breaches Detected",
          content: `Market Maker #${input.marketMakerId} had ${totalBreaches} breach(es) on ${input.reportDate} for ${obligation.instrument}. Penalty: ₦${penaltyAmount.toLocaleString()}`,
        });
      }
      return report;
    }),

  adminListPerformanceReports: adminProcedure
    .input(z.object({
      marketMakerId: z.number().int().positive().optional(),
      penaltyStatus: z.enum(["PENDING", "INVOICED", "PAID", "WAIVED", "ALL"]).default("ALL"),
      limit: z.number().int().min(1).max(200).default(50),
    }).optional())
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) {
        let results = Array.from(_memPerfReports.values());
        if (input?.marketMakerId) results = results.filter(r => r.marketMakerId === input.marketMakerId);
        const ps = input?.penaltyStatus ?? "ALL";
        if (ps !== "ALL") results = results.filter(r => r.penaltyStatus === ps);
        return results.sort((a, b) => b.generatedAt.getTime() - a.generatedAt.getTime()).slice(0, input?.limit ?? 50);
      }
      const conditions = [];
      if (input?.marketMakerId) conditions.push(eq(marketMakerPerformanceReports.marketMakerId, input.marketMakerId));
      const ps = input?.penaltyStatus ?? "ALL";
      if (ps !== "ALL") conditions.push(eq(marketMakerPerformanceReports.penaltyStatus, ps));
      return db.select().from(marketMakerPerformanceReports)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(marketMakerPerformanceReports.generatedAt))
        .limit(input?.limit ?? 50);
    }),

  adminUpdatePenaltyStatus: adminProcedure
    .input(z.object({
      reportId: z.number().int().positive(),
      penaltyStatus: z.enum(["INVOICED", "PAID", "WAIVED"]),
      notes: z.string().max(1024).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) {
        const r = _memPerfReports.get(input.reportId);
        if (!r) throw new TRPCError({ code: "NOT_FOUND", message: "Report not found" });
        r.penaltyStatus = input.penaltyStatus;
        r.notes = input.notes ?? null;
        r.reviewedBy = ctx.user.id;
        r.reviewedAt = new Date();
        return r;
      }
      const [updated] = await db.update(marketMakerPerformanceReports)
        .set({
          penaltyStatus: input.penaltyStatus,
          notes: input.notes ?? null,
          reviewedBy: ctx.user.id,
          reviewedAt: new Date(),
        })
        .where(eq(marketMakerPerformanceReports.id, input.reportId))
        .returning();
      if (!updated) throw new TRPCError({ code: "NOT_FOUND", message: "Report not found" });
      return updated;
    }),

  adminGetStats: adminProcedure
    .query(async () => {
      const db = await getDb();
      if (!db) {
        const profiles = Array.from(_memProfiles.values());
        const obligations = Array.from(_memObligations.values());
        const reports = Array.from(_memPerfReports.values());
        return {
          profiles: {
            total: profiles.length,
            active: profiles.filter(p => p.status === "ACTIVE").length,
            suspended: profiles.filter(p => p.status === "SUSPENDED").length,
          },
          obligations: {
            total: obligations.length,
            active: obligations.filter(o => o.isActive).length,
          },
          penalties: {
            totalPending: reports.filter(r => r.penaltyStatus === "PENDING").reduce((s, r) => s + parseFloat(r.penaltyAmount), 0),
            totalInvoiced: reports.filter(r => r.penaltyStatus === "INVOICED").reduce((s, r) => s + parseFloat(r.penaltyAmount), 0),
            totalPaid: reports.filter(r => r.penaltyStatus === "PAID").reduce((s, r) => s + parseFloat(r.penaltyAmount), 0),
            reportsWithBreaches: reports.filter(r => r.totalBreaches > 0).length,
          },
        };
      }
      const [profileStats] = await db.select({
        total: sql<number>`COUNT(*)::int`,
        active: sql<number>`SUM(CASE WHEN status = 'ACTIVE' THEN 1 ELSE 0 END)::int`,
        suspended: sql<number>`SUM(CASE WHEN status = 'SUSPENDED' THEN 1 ELSE 0 END)::int`,
      }).from(marketMakerProfiles);
      const [obligationStats] = await db.select({
        total: sql<number>`COUNT(*)::int`,
        active: sql<number>`SUM(CASE WHEN is_active THEN 1 ELSE 0 END)::int`,
      }).from(marketMakerObligations);
      const [penaltyStats] = await db.select({
        totalPending: sql<number>`COALESCE(SUM(CASE WHEN penalty_status = 'PENDING' THEN penalty_amount::numeric ELSE 0 END), 0)::float`,
        totalInvoiced: sql<number>`COALESCE(SUM(CASE WHEN penalty_status = 'INVOICED' THEN penalty_amount::numeric ELSE 0 END), 0)::float`,
        totalPaid: sql<number>`COALESCE(SUM(CASE WHEN penalty_status = 'PAID' THEN penalty_amount::numeric ELSE 0 END), 0)::float`,
        reportsWithBreaches: sql<number>`SUM(CASE WHEN total_breaches > 0 THEN 1 ELSE 0 END)::int`,
      }).from(marketMakerPerformanceReports);
      return {
        profiles: profileStats,
        obligations: obligationStats,
        penalties: penaltyStats,
      };
    }),

  // ─── Market Maker: My Profile & Performance ─────────────────────────────────
  myProfile: protectedProcedure
    .query(async ({ ctx }) => {
      const db = await getDb();
      if (!db) {
        const p = Array.from(_memProfiles.values()).find(p => p.userId === ctx.user.id);
        if (!p) return null;
        return parseProfile(p);
      }
      const [profile] = await db.select().from(marketMakerProfiles)
        .where(eq(marketMakerProfiles.userId, ctx.user.id));
      if (!profile) return null;
      return {
        ...profile,
        assetClasses: JSON.parse(profile.assetClasses) as string[],
        instruments: JSON.parse(profile.instruments) as string[],
      };
    }),

  myObligations: protectedProcedure
    .query(async ({ ctx }) => {
      const db = await getDb();
      if (!db) {
        const profile = Array.from(_memProfiles.values()).find(p => p.userId === ctx.user.id);
        if (!profile) return [];
        return Array.from(_memObligations.values())
          .filter(o => o.marketMakerId === profile.id && o.isActive)
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      }
      const [profile] = await db.select().from(marketMakerProfiles)
        .where(eq(marketMakerProfiles.userId, ctx.user.id));
      if (!profile) return [];
      return db.select().from(marketMakerObligations)
        .where(and(
          eq(marketMakerObligations.marketMakerId, profile.id),
          eq(marketMakerObligations.isActive, true),
        ))
        .orderBy(desc(marketMakerObligations.createdAt));
    }),

  myPerformanceReports: protectedProcedure
    .input(z.object({ limit: z.number().int().min(1).max(100).default(30) }).optional())
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) {
        const profile = Array.from(_memProfiles.values()).find(p => p.userId === ctx.user.id);
        if (!profile) return [];
        return Array.from(_memPerfReports.values())
          .filter(r => r.marketMakerId === profile.id)
          .sort((a, b) => b.generatedAt.getTime() - a.generatedAt.getTime())
          .slice(0, input?.limit ?? 30);
      }
      const [profile] = await db.select().from(marketMakerProfiles)
        .where(eq(marketMakerProfiles.userId, ctx.user.id));
      if (!profile) return [];
      return db.select().from(marketMakerPerformanceReports)
        .where(eq(marketMakerPerformanceReports.marketMakerId, profile.id))
        .orderBy(desc(marketMakerPerformanceReports.generatedAt))
        .limit(input?.limit ?? 30);
    }),

  // Admin: manually trigger performance report generation for all active obligations (today)
  adminRunPerformanceReportsNow: adminProcedure
    .mutation(async ({ ctx }) => {
      const db = await getDb();
      if (!db) return { generated: 0, lowUptimeAlerts: 0, results: [] };

      const today = new Date().toISOString().split("T")[0];
      const activeObligations = await db.select({
        obligation: marketMakerObligations,
        profile: marketMakerProfiles,
      })
        .from(marketMakerObligations)
        .innerJoin(marketMakerProfiles, eq(marketMakerObligations.marketMakerId, marketMakerProfiles.id))
        .where(and(
          eq(marketMakerObligations.isActive, true),
          eq(marketMakerProfiles.status, "ACTIVE"),
        ));

      let generated = 0;
      let lowUptimeAlerts = 0;
      const results: { marketMakerId: number; obligationId: number; instrument: string; uptimePct: number }[] = [];

      for (const { obligation, profile } of activeObligations) {
        try {
          const snapshots = await db.select().from(marketMakerQuoteSnapshots)
            .where(and(
              eq(marketMakerQuoteSnapshots.marketMakerId, obligation.marketMakerId),
              eq(marketMakerQuoteSnapshots.obligationId, obligation.id),
              eq(marketMakerQuoteSnapshots.tradingSessionDate, today),
            ));

          const total = snapshots.length;
          const compliant = snapshots.filter(s => s.isCompliant).length;
          const spreadBreaches = snapshots.filter(s => s.breachType === "SPREAD_TOO_WIDE").length;
          const sizeBreaches = snapshots.filter(s => s.breachType === "SIZE_TOO_SMALL").length;
          const absenceBreaches = snapshots.filter(s => s.breachType === "ABSENT").length;
          const totalBreaches = spreadBreaches + sizeBreaches + absenceBreaches;
          const uptimePct = total > 0 ? (compliant / total) * 100 : 0;
          const validSpreads = snapshots.filter(s => s.spreadBps !== null).map(s => s.spreadBps as number);
          const avgSpreadBps = validSpreads.length > 0
            ? Math.round(validSpreads.reduce((a, b) => a + b, 0) / validSpreads.length)
            : 0;
          const maxSpreadBps = validSpreads.length > 0 ? Math.max(...validSpreads) : 0;
          const penaltyAmount = totalBreaches * parseFloat(obligation.penaltyPerBreachNgn);

          await db.insert(marketMakerPerformanceReports).values({
            marketMakerId: obligation.marketMakerId,
            obligationId: obligation.id,
            instrument: obligation.instrument,
            reportDate: today,
            totalSnapshots: total,
            compliantSnapshots: compliant,
            uptimePct: String(uptimePct.toFixed(2)),
            avgSpreadBps,
            maxSpreadBps,
            spreadBreaches,
            sizeBreaches,
            absenceBreaches,
            totalBreaches,
            penaltyAmount: String(penaltyAmount.toFixed(2)),
            penaltyStatus: "PENDING",
          });

          generated++;
          results.push({ marketMakerId: obligation.marketMakerId, obligationId: obligation.id, instrument: obligation.instrument, uptimePct });

          const minUptime = parseFloat(obligation.minUptimePct);
          if (uptimePct < minUptime) {
            lowUptimeAlerts++;
            await notifyOwner({
              title: `⚠️ Market Maker Low Uptime: ${profile.firmName}`,
              content: `${profile.firmName} achieved only ${uptimePct.toFixed(1)}% uptime for ${obligation.instrument} today (minimum: ${minUptime}%).`,
            });
          }
        } catch (err) {
          console.error(`[MarketMaker] Error generating report for obligation #${obligation.id}:`, err);
        }
      }

      return { generated, lowUptimeAlerts, results };
    }),
});
