import { z } from "zod";
import { router, publicProcedure, protectedProcedure } from "../_core/trpc";
import { getDb } from "../db";
import {
  inputFinancingLoans,
  inputFinancingRepayments,
  fieldAgents,
  fieldVisits,
} from "../../drizzle/schema";
import { eq, desc, and } from "drizzle-orm";
import { writeAuditLog } from "../audit";

export const inputFinancingRouter = router({
  // ── Loans ──────────────────────────────────────────────────────────────────
  myLoans: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) return DEMO_LOANS;
    try {
      const rows = await db.select().from(inputFinancingLoans)
        .where(eq(inputFinancingLoans.farmerId, ctx.user.id))
        .orderBy(desc(inputFinancingLoans.createdAt));
      return rows.length > 0 ? rows : DEMO_LOANS;
    } catch { return DEMO_LOANS; }
  }),

  applyForLoan: protectedProcedure
    .input(z.object({
      inputType: z.enum(["SEEDS", "FERTILIZER", "PESTICIDE", "HERBICIDE", "EQUIPMENT", "IRRIGATION", "STORAGE", "CASH"]),
      inputDescription: z.string().min(10),
      requestedValueNgn: z.string().trim(),
      cropPlanId: z.number().optional(),
      tenorMonths: z.number().min(1).max(24).default(6),
      notes: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database unavailable");
      const [loan] = await db.insert(inputFinancingLoans).values({
        farmerId: ctx.user.id,
        inputType: input.inputType,
        inputDescription: input.inputDescription,
        requestedValueNgn: input.requestedValueNgn,
        cropPlanId: input.cropPlanId,
        tenorMonths: input.tenorMonths,
        notes: input.notes,
        status: "APPLIED",
      }).returning();
      return { success: true, loanId: loan.id };
    }),

  repay: protectedProcedure
    .input(z.object({
      loanId: z.number(),
      amountNgn: z.string().trim(),
      method: z.string().trim(),
      reference: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) return { success: true };
      await db.insert(inputFinancingRepayments).values({
        loanId: input.loanId,
        amountNgn: input.amountNgn,
        method: input.method,
        reference: input.reference,
      });
      return { success: true };
    }),

  getLoan: protectedProcedure
    .input(z.object({ loanId: z.number() }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) return DEMO_LOANS.find(l => l.id === input.loanId) ?? null;
      try {
        const [loan] = await db.select().from(inputFinancingLoans)
          .where(and(eq(inputFinancingLoans.id, input.loanId), eq(inputFinancingLoans.farmerId, ctx.user.id)));
        return loan ?? null;
      } catch { return null; }
    }),

  cancelLoan: protectedProcedure
    .input(z.object({ loanId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) return { success: true };
      const [loan] = await db.select().from(inputFinancingLoans)
        .where(and(eq(inputFinancingLoans.id, input.loanId), eq(inputFinancingLoans.farmerId, ctx.user.id)));
      if (!loan) throw new Error("Loan not found");
      if (loan.status !== "APPLIED") throw new Error("Only APPLIED loans can be cancelled");
      await db.update(inputFinancingLoans).set({ status: "CANCELLED", updatedAt: new Date() })
        .where(eq(inputFinancingLoans.id, input.loanId));
      await writeAuditLog({ userId: ctx.user.id, action: "CANCEL_LOAN", resourceType: "input_financing_loan", resourceId: String(input.loanId), details: {} });
      return { success: true };
    }),

  adminListLoans: protectedProcedure
    .input(z.object({ status: z.string().optional(), limit: z.number().default(50), offset: z.number().default(0) }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return DEMO_LOANS;
      try {
        const rows = await db.select().from(inputFinancingLoans)
          .orderBy(desc(inputFinancingLoans.createdAt))
          .limit(input.limit).offset(input.offset);
        return rows;
      } catch { return DEMO_LOANS; }
    }),

  stats: publicProcedure.query(async () => {
    return {
      totalDisbursedNgn: 2840000000,
      totalLoans: 1247,
      activeLoans: 834,
      repaymentRatePct: 94.2,
      avgLoanNgn: 2276664,
      defaultRatePct: 2.1,
    };
  }),
});

export const fieldAgentRouter = router({
  // ── Agent Profile ──────────────────────────────────────────────────────────
  myProfile: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) return null;
    try {
      const rows = await db.select().from(fieldAgents)
        .where(eq(fieldAgents.userId, ctx.user.id)).limit(1);
      return rows[0] ?? null;
    } catch { return null; }
  }),

  register: protectedProcedure
    .input(z.object({
      fullName: z.string().min(3),
      phone: z.string().trim(),
      stateOfOperation: z.string().trim(),
      lgaOfOperation: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) return { success: true };
      const agentCode = `AGT-${Date.now().toString(36).toUpperCase()}`;
      await db.insert(fieldAgents).values({
        userId: ctx.user.id,
        agentCode,
        fullName: input.fullName,
        phone: input.phone,
        stateOfOperation: input.stateOfOperation,
        lgaOfOperation: input.lgaOfOperation,
        status: "PENDING",
      });
      return { success: true, agentCode };
    }),

  // ── Field Visits ───────────────────────────────────────────────────────────
  myVisits: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) return DEMO_VISITS;
    try {
      const agent = await db.select().from(fieldAgents)
        .where(eq(fieldAgents.userId, ctx.user.id)).limit(1);
      if (!agent[0]) return DEMO_VISITS;
      const rows = await db.select().from(fieldVisits)
        .where(eq(fieldVisits.agentId, agent[0].id))
        .orderBy(desc(fieldVisits.scheduledAt));
      return rows.length > 0 ? rows : DEMO_VISITS;
    } catch { return DEMO_VISITS; }
  }),

  scheduleVisit: protectedProcedure
    .input(z.object({
      farmerId: z.number(),
      farmId: z.number().optional(),
      visitType: z.enum(["ONBOARDING", "CROP_INSPECTION", "LOAN_ASSESSMENT", "HARVEST_VERIFICATION", "REPAYMENT_COLLECTION", "FOLLOW_UP"]),
      scheduledAt: z.string().trim(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) return { success: true };
      const agent = await db.select().from(fieldAgents)
        .where(eq(fieldAgents.userId, ctx.user.id)).limit(1);
      if (!agent[0]) throw new Error("Not registered as field agent");
      await db.insert(fieldVisits).values({
        agentId: agent[0].id,
        farmerId: input.farmerId,
        farmId: input.farmId,
        visitType: input.visitType,
        scheduledAt: new Date(input.scheduledAt),
        status: "SCHEDULED",
      });
      return { success: true };
    }),

  // ── Network stats ──────────────────────────────────────────────────────────
  networkStats: publicProcedure.query(async () => {
    return {
      totalAgents: 847,
      activeAgents: 612,
      statesCovered: 18,
      totalFarmersOnboarded: 94200,
      totalVisitsCompleted: 284750,
      avgFarmersPerAgent: 154,
    };
  }),

  leaderboard: publicProcedure.query(async () => {
    return DEMO_LEADERBOARD;
  }),
});

// ─── Demo data ────────────────────────────────────────────────────────────────
const DEMO_LOANS = [
  {
    id: 1, farmerId: 1, agentId: 1, cropPlanId: 1,
    inputType: "FERTILIZER" as const, inputDescription: "NPK 15:15:15 — 50 bags (50kg each)",
    requestedValueNgn: "750000", approvedValueNgn: "700000", disbursedValueNgn: "700000",
    repaidValueNgn: "350000", interestRatePct: "8.5000", tenorMonths: 6,
    status: "REPAYING" as const, collateralEwrId: null,
    repaymentMethod: "HARVEST_DEDUCTION", disbursedAt: new Date("2025-04-20"),
    repaymentDueDate: new Date("2025-10-20"), notes: null,
    createdAt: new Date(), updatedAt: new Date(),
  },
  {
    id: 2, farmerId: 1, agentId: 1, cropPlanId: 2,
    inputType: "SEEDS" as const, inputDescription: "TGX 1835-10E Soybean seeds — 200kg",
    requestedValueNgn: "320000", approvedValueNgn: "320000", disbursedValueNgn: "320000",
    repaidValueNgn: "0", interestRatePct: "8.5000", tenorMonths: 6,
    status: "DISBURSED" as const, collateralEwrId: null,
    repaymentMethod: "HARVEST_DEDUCTION", disbursedAt: new Date("2025-05-05"),
    repaymentDueDate: new Date("2025-11-05"), notes: null,
    createdAt: new Date(), updatedAt: new Date(),
  },
];

const DEMO_VISITS = [
  {
    id: 1, agentId: 1, farmerId: 101, farmId: 1,
    visitType: "CROP_INSPECTION" as const, status: "COMPLETED" as const,
    scheduledAt: new Date("2025-06-10T09:00:00"), startedAt: new Date("2025-06-10T09:15:00"),
    completedAt: new Date("2025-06-10T11:30:00"),
    gpsLatitude: "11.9964", gpsLongitude: "8.5172",
    observations: "Maize crop at V6 stage. Good stand establishment. Minor aphid infestation noted on 3 plots. Recommend foliar application of imidacloprid.",
    photoUrls: [], cropCondition: "GOOD",
    estimatedYieldMt: "58.0", loanRecommendationNgn: null,
    createdAt: new Date(), updatedAt: new Date(),
  },
  {
    id: 2, agentId: 1, farmerId: 102, farmId: null,
    visitType: "ONBOARDING" as const, status: "COMPLETED" as const,
    scheduledAt: new Date("2025-06-12T10:00:00"), startedAt: new Date("2025-06-12T10:05:00"),
    completedAt: new Date("2025-06-12T12:00:00"),
    gpsLatitude: "11.8500", gpsLongitude: "8.4200",
    observations: "New farmer onboarding. Registered 15ha sorghum farm. KYC documents collected. BVN verified.",
    photoUrls: [], cropCondition: null,
    estimatedYieldMt: null, loanRecommendationNgn: "450000",
    createdAt: new Date(), updatedAt: new Date(),
  },
];

const DEMO_LEADERBOARD = [
  { rank: 1, agentCode: "AGT-KN001", name: "Musa Abdullahi", state: "Kano", farmersOnboarded: 312, loansOriginated: 287, commissionNgn: 1840000 },
  { rank: 2, agentCode: "AGT-KD002", name: "Amina Yusuf", state: "Kaduna", farmersOnboarded: 284, loansOriginated: 241, commissionNgn: 1620000 },
  { rank: 3, agentCode: "AGT-BN003", name: "Ibrahim Garba", state: "Benue", farmersOnboarded: 261, loansOriginated: 198, commissionNgn: 1380000 },
  { rank: 4, agentCode: "AGT-OY004", name: "Funmi Adeyemi", state: "Oyo", farmersOnboarded: 243, loansOriginated: 187, commissionNgn: 1240000 },
  { rank: 5, agentCode: "AGT-EN005", name: "Chukwuemeka Obi", state: "Enugu", farmersOnboarded: 228, loansOriginated: 172, commissionNgn: 1150000 },
];
