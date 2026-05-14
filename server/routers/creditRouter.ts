/**
 * Credit & Insurance Router
 * Covers: creditScores, collateralRegistry, loanRepaymentSchedules,
 *         cropInsurancePolicies, loanLifecycleEvents
 * These tables were previously uncovered by any tRPC router.
 */
import { z } from "zod";
import { router, protectedProcedure } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import { getDb } from "../db";
import {
  creditScores,
  collateralRegistry,
  loanRepaymentSchedules,
  cropInsurancePolicies,
  loanLifecycleEvents,
} from "../../drizzle/schema";
import { eq, desc, and, sql } from "drizzle-orm";

const adminProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (ctx.user.role !== "admin") {
    throw new TRPCError({ code: "FORBIDDEN", message: "Admin access required" });
  }
  return next({ ctx });
});

// ─── Credit Scores ────────────────────────────────────────────────────────────
export const creditRouter = router({
  // ── Credit Scores ──────────────────────────────────────────────────────────
  getMyScore: protectedProcedure
    .query(async ({ ctx }) => {
      const db = await getDb();
      if (!db) return null;
      const [row] = await db
        .select()
        .from(creditScores)
        .where(eq(creditScores.userId, ctx.user.id))
        .orderBy(desc(creditScores.createdAt))
        .limit(1);
      return row ?? null;
    }),

  getScoreHistory: protectedProcedure
    .input(z.object({ limit: z.number().int().min(1).max(50).default(10) }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) return [];
      return db
        .select()
        .from(creditScores)
        .where(eq(creditScores.userId, ctx.user.id))
        .orderBy(desc(creditScores.createdAt))
        .limit(input.limit);
    }),

  adminGetScore: adminProcedure
    .input(z.object({ userId: z.number().int().positive() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return null;
      const [row] = await db
        .select()
        .from(creditScores)
        .where(eq(creditScores.userId, input.userId))
        .orderBy(desc(creditScores.createdAt))
        .limit(1);
      return row ?? null;
    }),

  adminCreateScore: adminProcedure
    .input(z.object({
      userId: z.number().int().positive(),
      farmerId: z.number().int().positive().optional(),
      model: z.enum(["NEXCOM_AGRI_V1", "NEXCOM_TRADER_V1", "BUREAU_EXTERNAL"]).default("NEXCOM_AGRI_V1"),
      score: z.number().int().min(300).max(850),
      band: z.enum(["EXCELLENT", "GOOD", "FAIR", "POOR", "VERY_POOR"]),
      maxLoanNgn: z.number().positive().optional(),
      interestRatePct: z.number().positive().optional(),
      factors: z.record(z.string(), z.unknown()).optional(),
      bureauRef: z.string().max(100).optional(),
      validUntil: z.string().datetime().optional(),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const [row] = await db.insert(creditScores).values({
        userId: input.userId,
        farmerId: input.farmerId,
        model: input.model as "NEXCOM_AGRI_V1",
        score: input.score,
        band: input.band,
        maxLoanNgn: input.maxLoanNgn !== undefined ? String(input.maxLoanNgn) : undefined,
        interestRatePct: input.interestRatePct !== undefined ? String(input.interestRatePct) : undefined,
        factors: input.factors,
        bureauRef: input.bureauRef,
        validUntil: input.validUntil ? new Date(input.validUntil) : undefined,
      }).returning();
      return row;
    }),

  adminListScores: adminProcedure
    .input(z.object({
      userId: z.number().int().positive().optional(),
      limit: z.number().int().min(1).max(200).default(50),
      offset: z.number().int().min(0).default(0),
    }).optional())
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return { scores: [], total: 0 };
      const conditions = input?.userId ? [eq(creditScores.userId, input.userId)] : [];
      const [rows, [countRow]] = await Promise.all([
        db.select().from(creditScores)
          .where(conditions.length > 0 ? and(...conditions) : undefined)
          .orderBy(desc(creditScores.createdAt))
          .limit(input?.limit ?? 50)
          .offset(input?.offset ?? 0),
        db.select({ count: sql<number>`count(*)::int` }).from(creditScores)
          .where(conditions.length > 0 ? and(...conditions) : undefined),
      ]);
      return { scores: rows, total: countRow?.count ?? 0 };
    }),

  // ── Collateral Registry ────────────────────────────────────────────────────
  listMyCollateral: protectedProcedure
    .input(z.object({ limit: z.number().int().min(1).max(100).default(20) }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) return [];
      return db
        .select()
        .from(collateralRegistry)
        .where(eq(collateralRegistry.ownerId, ctx.user.id))
        .orderBy(desc(collateralRegistry.createdAt))
        .limit(input.limit);
    }),

  getCollateral: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const [row] = await db
        .select()
        .from(collateralRegistry)
        .where(and(eq(collateralRegistry.id, input.id), eq(collateralRegistry.ownerId, ctx.user.id)))
        .limit(1);
      if (!row) throw new TRPCError({ code: "NOT_FOUND" });
      return row;
    }),

  registerCollateral: protectedProcedure
    .input(z.object({
      loanId: z.number().int().positive().optional(),
      type: z.enum(["WAREHOUSE_RECEIPT", "LAND_TITLE", "VEHICLE", "EQUIPMENT", "LIVESTOCK", "CROP_STANDING", "BANK_GUARANTEE", "CASH_DEPOSIT", "OTHER"]),
      description: z.string().min(10).max(1000),
      valuationNgn: z.number().positive(),
      ltvPct: z.number().min(0).max(100).default(70),
      registryRef: z.string().max(100),
      ewrId: z.number().int().positive().optional(),
      landTitleRef: z.string().max(100).optional(),
      documentUrls: z.array(z.string().url()).default([]),
      valuationDate: z.string().datetime().optional(),
      expiresAt: z.string().datetime().optional(),
      notes: z.string().max(2000).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const [row] = await db.insert(collateralRegistry).values({
        ownerId: ctx.user.id,
        loanId: input.loanId,
        type: input.type,
        status: "REGISTERED",
        description: input.description,
        valuationNgn: String(input.valuationNgn),
        ltvPct: String(input.ltvPct),
        registryRef: input.registryRef,
        ewrId: input.ewrId,
        landTitleRef: input.landTitleRef,
        documentUrls: input.documentUrls,
        valuationDate: input.valuationDate ? new Date(input.valuationDate) : undefined,
        expiresAt: input.expiresAt ? new Date(input.expiresAt) : undefined,
        notes: input.notes,
      }).returning();
      return row;
    }),

  updateCollateral: protectedProcedure
    .input(z.object({
      id: z.number().int().positive(),
      valuationNgn: z.number().positive().optional(),
      status: z.enum(["REGISTERED", "PLEDGED", "RELEASED", "LIQUIDATED", "EXPIRED"]).optional(),
      notes: z.string().max(2000).optional(),
      documentUrls: z.array(z.string().url()).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const [existing] = await db.select().from(collateralRegistry)
        .where(and(eq(collateralRegistry.id, input.id), eq(collateralRegistry.ownerId, ctx.user.id)))
        .limit(1);
      if (!existing) throw new TRPCError({ code: "NOT_FOUND" });
      const [updated] = await db.update(collateralRegistry)
        .set({
          ...(input.valuationNgn !== undefined ? { valuationNgn: String(input.valuationNgn) } : {}),
          ...(input.status !== undefined ? { status: input.status } : {}),
          ...(input.notes !== undefined ? { notes: input.notes } : {}),
          ...(input.documentUrls !== undefined ? { documentUrls: input.documentUrls } : {}),
          updatedAt: new Date(),
        })
        .where(eq(collateralRegistry.id, input.id))
        .returning();
      return updated;
    }),

  adminListCollateral: adminProcedure
    .input(z.object({
      status: z.enum(["REGISTERED", "PLEDGED", "RELEASED", "LIQUIDATED", "EXPIRED"]).optional(),
      limit: z.number().int().min(1).max(200).default(50),
      offset: z.number().int().min(0).default(0),
    }).optional())
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return { items: [], total: 0 };
      const conditions = input?.status ? [eq(collateralRegistry.status, input.status)] : [];
      const [rows, [countRow]] = await Promise.all([
        db.select().from(collateralRegistry)
          .where(conditions.length > 0 ? and(...conditions) : undefined)
          .orderBy(desc(collateralRegistry.createdAt))
          .limit(input?.limit ?? 50)
          .offset(input?.offset ?? 0),
        db.select({ count: sql<number>`count(*)::int` }).from(collateralRegistry)
          .where(conditions.length > 0 ? and(...conditions) : undefined),
      ]);
      return { items: rows, total: countRow?.count ?? 0 };
    }),

  // ── Loan Repayment Schedules ───────────────────────────────────────────────
  getRepaymentSchedule: protectedProcedure
    .input(z.object({ loanId: z.number().int().positive() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return [];
      return db
        .select()
        .from(loanRepaymentSchedules)
        .where(eq(loanRepaymentSchedules.loanId, input.loanId))
        .orderBy(loanRepaymentSchedules.installmentNo);
    }),

  markInstallmentPaid: protectedProcedure
    .input(z.object({
      id: z.number().int().positive(),
      paidNgn: z.number().positive(),
      paymentRef: z.string().max(100).optional(),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const [row] = await db.select().from(loanRepaymentSchedules)
        .where(eq(loanRepaymentSchedules.id, input.id)).limit(1);
      if (!row) throw new TRPCError({ code: "NOT_FOUND" });
      const totalPaid = parseFloat(row.paidNgn ?? "0") + input.paidNgn;
      const total = parseFloat(row.totalNgn);
      const newStatus = totalPaid >= total ? "PAID" : row.status;
      const [updated] = await db.update(loanRepaymentSchedules)
        .set({
          paidNgn: String(totalPaid),
          status: newStatus,
          paidAt: newStatus === "PAID" ? new Date() : row.paidAt,
          paymentRef: input.paymentRef ?? row.paymentRef,
          updatedAt: new Date(),
        })
        .where(eq(loanRepaymentSchedules.id, input.id))
        .returning();
      return updated;
    }),

  adminCreateSchedule: adminProcedure
    .input(z.object({
      loanId: z.number().int().positive(),
      installments: z.array(z.object({
        installmentNo: z.number().int().positive(),
        dueDate: z.string().datetime(),
        principalNgn: z.number().positive(),
        interestNgn: z.number().min(0),
        totalNgn: z.number().positive(),
      })).min(1),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const rows = await db.insert(loanRepaymentSchedules).values(
        input.installments.map(inst => ({
          loanId: input.loanId,
          installmentNo: inst.installmentNo,
          dueDate: new Date(inst.dueDate),
          principalNgn: String(inst.principalNgn),
          interestNgn: String(inst.interestNgn),
          totalNgn: String(inst.totalNgn),
          status: "SCHEDULED" as const,
        }))
      ).returning();
      return rows;
    }),

  adminUpdateInstallment: adminProcedure
    .input(z.object({
      id: z.number().int().positive(),
      status: z.enum(["SCHEDULED", "DUE", "PAID", "OVERDUE", "WAIVED", "WRITTEN_OFF"]),
      penaltyNgn: z.number().min(0).optional(),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const [updated] = await db.update(loanRepaymentSchedules)
        .set({
          status: input.status,
          ...(input.penaltyNgn !== undefined ? { penaltyNgn: String(input.penaltyNgn) } : {}),
          updatedAt: new Date(),
        })
        .where(eq(loanRepaymentSchedules.id, input.id))
        .returning();
      return updated;
    }),

  // ── Crop Insurance Policies ────────────────────────────────────────────────
  listMyInsurancePolicies: protectedProcedure
    .input(z.object({ limit: z.number().int().min(1).max(100).default(20) }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) return [];
      return db
        .select()
        .from(cropInsurancePolicies)
        .where(eq(cropInsurancePolicies.userId, ctx.user.id))
        .orderBy(desc(cropInsurancePolicies.createdAt))
        .limit(input.limit);
    }),

  getInsurancePolicy: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const [row] = await db.select().from(cropInsurancePolicies)
        .where(and(eq(cropInsurancePolicies.id, input.id), eq(cropInsurancePolicies.userId, ctx.user.id)))
        .limit(1);
      if (!row) throw new TRPCError({ code: "NOT_FOUND" });
      return row;
    }),

  createInsurancePolicy: protectedProcedure
    .input(z.object({
      farmerId: z.number().int().positive(),
      policyRef: z.string().max(50),
      coverageType: z.enum(["YIELD_PROTECTION", "REVENUE_PROTECTION", "MULTI_PERIL", "DROUGHT", "FLOOD", "PEST_DISEASE", "FIRE", "COMPREHENSIVE"]),
      cropType: z.string().max(100),
      farmId: z.number().int().positive().optional(),
      coveredAreaHectares: z.number().positive(),
      sumInsuredNgn: z.number().positive(),
      premiumNgn: z.number().positive(),
      deductiblePct: z.number().min(0).max(100).default(10),
      season: z.string().max(50).optional(),
      startDate: z.string().datetime().optional(),
      endDate: z.string().datetime().optional(),
      providerName: z.string().max(100).default("NEXCOM Agri Insurance"),
      notes: z.string().max(2000).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const [row] = await db.insert(cropInsurancePolicies).values({
        farmerId: input.farmerId,
        userId: ctx.user.id,
        policyRef: input.policyRef,
        coverageType: input.coverageType,
        status: "DRAFT",
        cropType: input.cropType,
        farmId: input.farmId,
        coveredAreaHectares: String(input.coveredAreaHectares),
        sumInsuredNgn: String(input.sumInsuredNgn),
        premiumNgn: String(input.premiumNgn),
        deductiblePct: String(input.deductiblePct),
        season: input.season,
        startDate: input.startDate ? new Date(input.startDate) : undefined,
        endDate: input.endDate ? new Date(input.endDate) : undefined,
        providerName: input.providerName,
        notes: input.notes,
      }).returning();
      return row;
    }),

  updateInsurancePolicy: protectedProcedure
    .input(z.object({
      id: z.number().int().positive(),
      status: z.enum(["DRAFT", "ACTIVE", "EXPIRED", "CANCELLED", "CLAIMED", "SETTLED"]).optional(),
      premiumPaidNgn: z.number().min(0).optional(),
      notes: z.string().max(2000).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const [existing] = await db.select().from(cropInsurancePolicies)
        .where(and(eq(cropInsurancePolicies.id, input.id), eq(cropInsurancePolicies.userId, ctx.user.id)))
        .limit(1);
      if (!existing) throw new TRPCError({ code: "NOT_FOUND" });
      const [updated] = await db.update(cropInsurancePolicies)
        .set({
          ...(input.status !== undefined ? { status: input.status } : {}),
          ...(input.premiumPaidNgn !== undefined ? { premiumPaidNgn: String(input.premiumPaidNgn) } : {}),
          ...(input.notes !== undefined ? { notes: input.notes } : {}),
          updatedAt: new Date(),
        })
        .where(eq(cropInsurancePolicies.id, input.id))
        .returning();
      return updated;
    }),

  fileClaim: protectedProcedure
    .input(z.object({
      id: z.number().int().positive(),
      claimAmountNgn: z.number().positive(),
      notes: z.string().max(2000).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const [existing] = await db.select().from(cropInsurancePolicies)
        .where(and(eq(cropInsurancePolicies.id, input.id), eq(cropInsurancePolicies.userId, ctx.user.id)))
        .limit(1);
      if (!existing) throw new TRPCError({ code: "NOT_FOUND" });
      if (existing.status !== "ACTIVE") throw new TRPCError({ code: "BAD_REQUEST", message: "Can only file claims on ACTIVE policies" });
      const [updated] = await db.update(cropInsurancePolicies)
        .set({
          status: "CLAIMED",
          claimAmountNgn: String(input.claimAmountNgn),
          claimedAt: new Date(),
          notes: input.notes ?? existing.notes,
          updatedAt: new Date(),
        })
        .where(eq(cropInsurancePolicies.id, input.id))
        .returning();
      return updated;
    }),

  adminListInsurancePolicies: adminProcedure
    .input(z.object({
      status: z.enum(["DRAFT", "ACTIVE", "EXPIRED", "CANCELLED", "CLAIMED", "SETTLED"]).optional(),
      limit: z.number().int().min(1).max(200).default(50),
      offset: z.number().int().min(0).default(0),
    }).optional())
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return { policies: [], total: 0 };
      const conditions = input?.status ? [eq(cropInsurancePolicies.status, input.status)] : [];
      const [rows, [countRow]] = await Promise.all([
        db.select().from(cropInsurancePolicies)
          .where(conditions.length > 0 ? and(...conditions) : undefined)
          .orderBy(desc(cropInsurancePolicies.createdAt))
          .limit(input?.limit ?? 50)
          .offset(input?.offset ?? 0),
        db.select({ count: sql<number>`count(*)::int` }).from(cropInsurancePolicies)
          .where(conditions.length > 0 ? and(...conditions) : undefined),
      ]);
      return { policies: rows, total: countRow?.count ?? 0 };
    }),

  adminSettleClaim: adminProcedure
    .input(z.object({
      id: z.number().int().positive(),
      claimSettledNgn: z.number().positive(),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const [updated] = await db.update(cropInsurancePolicies)
        .set({
          status: "SETTLED",
          claimSettledNgn: String(input.claimSettledNgn),
          settledAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(cropInsurancePolicies.id, input.id))
        .returning();
      return updated;
    }),

  // ── Loan Lifecycle Events ──────────────────────────────────────────────────
  getLoanEvents: protectedProcedure
    .input(z.object({
      loanId: z.number().int().positive(),
      limit: z.number().int().min(1).max(100).default(50),
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return [];
      return db
        .select()
        .from(loanLifecycleEvents)
        .where(eq(loanLifecycleEvents.loanId, input.loanId))
        .orderBy(desc(loanLifecycleEvents.createdAt))
        .limit(input.limit);
    }),

  appendLoanEvent: adminProcedure
    .input(z.object({
      loanId: z.number().int().positive(),
      eventType: z.enum(["APPLIED", "CREDIT_CHECKED", "APPROVED", "REJECTED", "DISBURSED", "REPAYMENT_RECEIVED", "OVERDUE_NOTICE", "DEFAULT_NOTICE", "WRITTEN_OFF", "RESTRUCTURED", "CLOSED"]),
      notes: z.string().max(2000).optional(),
      metadata: z.record(z.string(), z.unknown()).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const [row] = await db.insert(loanLifecycleEvents).values({
        loanId: input.loanId,
        eventType: input.eventType,
        performedBy: ctx.user.id,
        notes: input.notes,
        metadata: input.metadata,
      }).returning();
      return row;
    }),

  adminListLoanEvents: adminProcedure
    .input(z.object({
      loanId: z.number().int().positive().optional(),
      eventType: z.enum(["APPLIED", "CREDIT_CHECKED", "APPROVED", "REJECTED", "DISBURSED", "REPAYMENT_RECEIVED", "OVERDUE_NOTICE", "DEFAULT_NOTICE", "WRITTEN_OFF", "RESTRUCTURED", "CLOSED"]).optional(),
      limit: z.number().int().min(1).max(500).default(100),
      offset: z.number().int().min(0).default(0),
    }).optional())
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return { events: [], total: 0 };
      const conditions = [];
      if (input?.loanId) conditions.push(eq(loanLifecycleEvents.loanId, input.loanId));
      if (input?.eventType) conditions.push(eq(loanLifecycleEvents.eventType, input.eventType));
      const [rows, [countRow]] = await Promise.all([
        db.select().from(loanLifecycleEvents)
          .where(conditions.length > 0 ? and(...conditions) : undefined)
          .orderBy(desc(loanLifecycleEvents.createdAt))
          .limit(input?.limit ?? 100)
          .offset(input?.offset ?? 0),
        db.select({ count: sql<number>`count(*)::int` }).from(loanLifecycleEvents)
          .where(conditions.length > 0 ? and(...conditions) : undefined),
      ]);
      return { events: rows, total: countRow?.count ?? 0 };
    }),


  deleteCollateral: protectedProcedure
    .input(z.object({ collateralId: z.number().int(), reason: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "Database unavailable" });
      const [item] = await db.update(collateralRegistry)
        .set({ status: "RELEASED", updatedAt: new Date() })
        .where(and(eq(collateralRegistry.id, input.collateralId), eq(collateralRegistry.userId, ctx.user.id)))
        .returning();
      if (!item) throw new TRPCError({ code: "NOT_FOUND", message: "Collateral not found" });
      return { success: true };
    }),


  deleteCollateral: protectedProcedure
    .input(z.object({ collateralId: z.number().int(), reason: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "Database unavailable" });
      const [item] = await db.update(collateralRegistry)
        .set({ status: "RELEASED", updatedAt: new Date() })
        .where(and(eq(collateralRegistry.id, input.collateralId), eq(collateralRegistry.userId, ctx.user.id)))
        .returning();
      if (!item) throw new TRPCError({ code: "NOT_FOUND", message: "Collateral not found" });
      return { success: true };
    }),
});
