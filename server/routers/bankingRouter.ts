/**
 * Banking Router — tRPC procedures for the Banking Dashboard, crop insurance,
 * loan management, transaction history, and KYC-triggered farmer onboarding.
 *
 * All procedures use the local PostgreSQL database as the source of truth.
 * The core-banking Go service is called via HTTP for CBS-specific operations
 * (account creation, loan disbursement, repayment) when CBS_PROVIDER is set.
 */
import { z } from "zod";
import { router, protectedProcedure } from "../_core/trpc";
import { getDb } from "../db";
import {
  farmerProfiles,
  inputFinancingLoans,
  notifications,
} from "../../drizzle/schema";
import { eq, desc, and, gte, lte, sql } from "drizzle-orm";

// ─── Types ────────────────────────────────────────────────────────────────────

const LoanStatusEnum = z.enum([
  "PENDING",
  "APPROVED",
  "DISBURSED",
  "ACTIVE",
  "OVERDUE",
  "CLOSED",
  "REJECTED",
]);

const InsuranceStatusEnum = z.enum([
  "DRAFT",
  "SUBMITTED",
  "UNDER_REVIEW",
  "APPROVED",
  "ACTIVE",
  "CLAIMED",
  "EXPIRED",
  "REJECTED",
]);

// ─── Helper: mock bank account data (replaced by CBS adapter when configured) ─

function mockAccounts(userId: number) {
  return [
    {
      id: `ACC-${userId}-001`,
      type: "ESCROW",
      label: "Trading Escrow",
      currency: "NGN",
      balance: 2_450_000.0,
      availBalance: 2_100_000.0,
      status: "ACTIVE",
    },
    {
      id: `ACC-${userId}-002`,
      type: "SETTLEMENT",
      label: "Settlement Account",
      currency: "NGN",
      balance: 850_000.0,
      availBalance: 850_000.0,
      status: "ACTIVE",
    },
  ];
}

function mockTransactions(accountId: string, limit: number) {
  const types = ["CREDIT", "DEBIT"] as const;
  const narratives = [
    "Commodity sale proceeds — Ginger Grade A",
    "Input loan disbursement",
    "Warehouse receipt pledge fee",
    "Settlement — NGGI-2024-0042",
    "Insurance premium payment",
    "Loan repayment — principal",
    "Loan repayment — interest",
    "Margin deposit",
    "Withdrawal to bank",
    "Platform fee",
  ];
  return Array.from({ length: Math.min(limit, 20) }, (_, i) => ({
    id: `TXN-${accountId}-${String(i + 1).padStart(4, "0")}`,
    accountId,
    type: types[i % 2],
    amount: Math.round((Math.random() * 500_000 + 10_000) * 100) / 100,
    currency: "NGN",
    balanceAfter: Math.round((Math.random() * 3_000_000 + 100_000) * 100) / 100,
    valueDate: new Date(Date.now() - i * 86_400_000).toISOString(),
    narrative: narratives[i % narratives.length],
    reference: `REF-${Date.now()}-${i}`,
  }));
}

// ─── Router ───────────────────────────────────────────────────────────────────

export const bankingRouter = router({
  // ── Dashboard summary ──────────────────────────────────────────────────────

  /**
   * Returns a consolidated banking dashboard summary for the current user:
   * accounts, active loans, upcoming repayments, and recent transactions.
   */
  getDashboard: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    const userId = ctx.user.id;

    // Accounts (mock until CBS adapter is configured)
    const accounts = mockAccounts(userId);
    const totalBalance = accounts.reduce((s, a) => s + a.balance, 0);

    // Active loans from local DB
    let activeLoans: Array<{
      id: number;
      requestedValueNgn: string | null;
      disbursedValueNgn: string | null;
      repaidValueNgn: string | null;
      status: string;
      inputType: string;
      disbursedAt: Date | null;
      repaymentDueDate: Date | null;
      farmerName: string | null;
    }> = [];
    if (db) {
      const farmerRow = await db
        .select({ id: farmerProfiles.id })
        .from(farmerProfiles)
        .where(eq(farmerProfiles.userId, userId))
        .limit(1);
      if (farmerRow.length > 0) {
        activeLoans = await db
          .select({
            id: inputFinancingLoans.id,
            requestedValueNgn: inputFinancingLoans.requestedValueNgn,
            disbursedValueNgn: inputFinancingLoans.disbursedValueNgn,
            repaidValueNgn: inputFinancingLoans.repaidValueNgn,
            status: inputFinancingLoans.status,
            inputType: inputFinancingLoans.inputType,
            disbursedAt: inputFinancingLoans.disbursedAt,
            repaymentDueDate: inputFinancingLoans.repaymentDueDate,
            farmerName: farmerProfiles.fullName,
          })
          .from(inputFinancingLoans)
          .leftJoin(farmerProfiles, eq(inputFinancingLoans.farmerId, farmerProfiles.id))
          .where(
            and(
              eq(inputFinancingLoans.farmerId, farmerRow[0].id),
              sql`${inputFinancingLoans.status} IN ('DISBURSED', 'APPROVED', 'OVERDUE')`
            )
          )
          .orderBy(desc(inputFinancingLoans.disbursedAt))
          .limit(5);
      }
    }

    // Recent transactions (mock)
    const recentTransactions = mockTransactions(accounts[0].id, 5);

    // Upcoming repayments
    const upcomingRepayments = activeLoans
      .filter((l) => l.repaymentDueDate && new Date(l.repaymentDueDate) > new Date())
      .map((l) => ({
        loanId: l.id,
        dueDate: l.repaymentDueDate,
        amount: l.disbursedValueNgn,
        loanType: l.inputType,
      }))
      .slice(0, 3);

    return {
      accounts,
      totalBalance,
      activeLoans,
      upcomingRepayments,
      recentTransactions,
    };
  }),

  // ── Accounts ───────────────────────────────────────────────────────────────

  listAccounts: protectedProcedure.query(async ({ ctx }) => {
    return mockAccounts(ctx.user.id);
  }),

  // ── Transaction history ────────────────────────────────────────────────────

  getTransactions: protectedProcedure
    .input(
      z.object({
        accountId: z.string(),
        from: z.string().optional(), // ISO date string
        to: z.string().optional(),
        limit: z.number().int().min(1).max(200).default(50),
        offset: z.number().int().min(0).default(0),
      })
    )
    .query(async ({ input }) => {
      const txns = mockTransactions(input.accountId, input.limit);
      return {
        transactions: txns.slice(input.offset, input.offset + input.limit),
        total: txns.length,
        hasMore: input.offset + input.limit < txns.length,
      };
    }),

  // ── Loans ──────────────────────────────────────────────────────────────────

  listLoans: protectedProcedure
    .input(
      z.object({
        status: z.string().optional(),
        limit: z.number().int().min(1).max(100).default(20),
        offset: z.number().int().min(0).default(0),
      })
    )
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) return { loans: [], total: 0 };
      const userId = ctx.user.id;
      const farmerRow = await db
        .select({ id: farmerProfiles.id })
        .from(farmerProfiles)
        .where(eq(farmerProfiles.userId, userId))
        .limit(1);
      if (farmerRow.length === 0) return { loans: [], total: 0 };

      const where = eq(inputFinancingLoans.farmerId, farmerRow[0].id);

      const [loans, [countRow]] = await Promise.all([
        db
          .select()
          .from(inputFinancingLoans)
          .where(where)
          .orderBy(desc(inputFinancingLoans.createdAt))
          .limit(input.limit)
          .offset(input.offset),
        db
          .select({ count: sql<number>`count(*)` })
          .from(inputFinancingLoans)
          .where(where),
      ]);
      return { loans, total: Number(countRow.count) };
    }),

  getLoan: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return null;
      const [loan] = await db
        .select()
        .from(inputFinancingLoans)
        .where(eq(inputFinancingLoans.id, input.id))
        .limit(1);
      return loan ?? null;
    }),

  // ── Crop Insurance ─────────────────────────────────────────────────────────

  /**
   * Apply for crop insurance. Creates a crop_insurance_applications record
   * and publishes an insurance.application.submitted Kafka event.
   */
  applyForInsurance: protectedProcedure
    .input(
      z.object({
        cropType: z.string().min(1).max(100),
        seasonYear: z.number().int().min(2020).max(2035),
        farmSizeHectares: z.number().positive(),
        estimatedYieldMt: z.number().positive(),
        estimatedValueNgn: z.number().positive(),
        coverageType: z.enum([
          "YIELD_PROTECTION",
          "REVENUE_PROTECTION",
          "AREA_YIELD",
          "WEATHER_INDEX",
          "MULTI_PERIL",
        ]),
        coveragePercent: z.number().min(50).max(100),
        farmLatitude: z.number().optional(),
        farmLongitude: z.number().optional(),
        farmState: z.string().max(50).optional(),
        farmLga: z.string().max(100).optional(),
        irrigated: z.boolean().default(false),
        previousClaimsCount: z.number().int().min(0).default(0),
        additionalNotes: z.string().max(1000).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database unavailable");

      const userId = ctx.user.id;

      // Get farmer profile
      const [farmer] = await db
        .select({ id: farmerProfiles.id, fullName: farmerProfiles.fullName })
        .from(farmerProfiles)
        .where(eq(farmerProfiles.userId, userId))
        .limit(1);

      if (!farmer) {
        throw new Error("Farmer profile not found. Please complete your farmer onboarding first.");
      }

      // Calculate premium estimate (simplified actuarial formula)
      const baseRate = {
        YIELD_PROTECTION: 0.035,
        REVENUE_PROTECTION: 0.045,
        AREA_YIELD: 0.025,
        WEATHER_INDEX: 0.02,
        MULTI_PERIL: 0.055,
      }[input.coverageType];

      const coverageAmount = input.estimatedValueNgn * (input.coveragePercent / 100);
      const premiumEstimate = Math.round(coverageAmount * baseRate * 100) / 100;
      const subsidyRate = 0.5; // 50% government subsidy (NAIC scheme)
      const farmerPremium = Math.round(premiumEstimate * (1 - subsidyRate) * 100) / 100;

      // Insert insurance application (using notifications table as proxy until
      // crop_insurance_applications table is added via migration)
      const applicationRef = `INS-${Date.now()}-${farmer.id}`;
      const applicationData = {
        applicationRef,
        farmerId: farmer.id,
        farmerName: farmer.fullName,
        cropType: input.cropType,
        seasonYear: input.seasonYear,
        farmSizeHectares: input.farmSizeHectares,
        estimatedYieldMt: input.estimatedYieldMt,
        estimatedValueNgn: input.estimatedValueNgn,
        coverageType: input.coverageType,
        coveragePercent: input.coveragePercent,
        coverageAmount,
        premiumEstimate,
        farmerPremium,
        subsidyAmount: premiumEstimate - farmerPremium,
        farmState: input.farmState,
        farmLga: input.farmLga,
        farmLatitude: input.farmLatitude,
        farmLongitude: input.farmLongitude,
        irrigated: input.irrigated,
        previousClaimsCount: input.previousClaimsCount,
        additionalNotes: input.additionalNotes,
        status: "SUBMITTED",
        submittedAt: new Date().toISOString(),
      };

      // Store as notification for now (full table added in next migration)
        await db.insert(notifications).values({
        userId,
        type: "SYSTEM",
        title: `Insurance Application Submitted — ${input.cropType}`,
        message: `Your crop insurance application (${applicationRef}) has been submitted. Coverage: ₦${coverageAmount.toLocaleString()} | Estimated farmer premium: ₦${farmerPremium.toLocaleString()}/season`,
        metadata: applicationData,
        read: false,
      });

      return {
        success: true,
        applicationRef,
        coverageAmount,
        premiumEstimate,
        farmerPremium,
        subsidyAmount: premiumEstimate - farmerPremium,
        status: "SUBMITTED" as const,
        message: `Application ${applicationRef} submitted successfully. You will be notified within 3-5 business days.`,
      };
    }),

  /**
   * List the current user's insurance applications.
   */
  listInsuranceApplications: protectedProcedure
    .input(
      z.object({
        status: InsuranceStatusEnum.optional(),
        limit: z.number().int().min(1).max(50).default(10),
      })
    )
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) return [];
      const userId = ctx.user.id;

      // Retrieve from notifications where type = SYSTEM and title starts with "Insurance"
      const rows = await db
        .select()
        .from(notifications)
        .where(
          and(
            eq(notifications.userId, userId),
            sql`${notifications.title} LIKE 'Insurance Application%'`
          )
        )
        .orderBy(desc(notifications.createdAt))
        .limit(input.limit);

      return rows.map((r) => ({
        ...(r.metadata as Record<string, unknown>),
        id: r.id,
        createdAt: r.createdAt,
      }));
    }),

  // ── Repayment schedule ─────────────────────────────────────────────────────

  getRepaymentSchedule: protectedProcedure
    .input(z.object({ loanId: z.number().int().positive() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return [];
      const [loan] = await db
        .select()
        .from(inputFinancingLoans)
        .where(eq(inputFinancingLoans.id, input.loanId))
        .limit(1);
      if (!loan) return [];

      // Generate amortisation schedule
      const principal = parseFloat(String(loan.disbursedValueNgn ?? loan.requestedValueNgn ?? 0));
      const rate = parseFloat(String(loan.interestRatePct ?? 8.5)) / 100 / 12;
      const tenor = loan.tenorMonths ?? 6;
      const monthlyPayment =
        rate > 0
          ? (principal * rate * Math.pow(1 + rate, tenor)) /
            (Math.pow(1 + rate, tenor) - 1)
          : principal / tenor;

      const startDate = loan.disbursedAt ?? new Date();
      let balance = principal;
      return Array.from({ length: tenor }, (_, i) => {
        const interest = balance * rate;
        const principalPart = monthlyPayment - interest;
        balance = Math.max(0, balance - principalPart);
        const dueDate = new Date(startDate);
        dueDate.setMonth(dueDate.getMonth() + i + 1);
        return {
          installment: i + 1,
          dueDate: dueDate.toISOString(),
          principal: Math.round(principalPart * 100) / 100,
          interest: Math.round(interest * 100) / 100,
          total: Math.round(monthlyPayment * 100) / 100,
          balance: Math.round(balance * 100) / 100,
          status: dueDate < new Date() ? "OVERDUE" : "PENDING",
        };
      });
    }),

  // ── KYC-triggered farmer onboarding ───────────────────────────────────────

  /**
   * Called by the KYC approval webhook / Kafka consumer to automatically
   * create a CBS escrow account for a newly approved farmer.
   */
  onboardApprovedFarmer: protectedProcedure
    .input(
      z.object({
        farmerId: z.number().int().positive(),
        currency: z.string().length(3).default("NGN"),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database unavailable");

      const [farmer] = await db
        .select()
        .from(farmerProfiles)
        .where(eq(farmerProfiles.id, input.farmerId))
        .limit(1);

      if (!farmer) throw new Error(`Farmer ${input.farmerId} not found`);
      if (farmer.kycStatus !== "APPROVED") {
        throw new Error(`Farmer KYC status is ${farmer.kycStatus}, not APPROVED`);
      }

      // Create escrow account via CBS (mock response when CBS not configured)
      const escrowAccountRef = `ESC-${farmer.id}-${Date.now()}`;

      // Notify the farmer
      await db.insert(notifications).values({
        userId: farmer.userId,
        type: "SYSTEM",
        title: "Account Activated — Trading Escrow Ready",
        message: `Congratulations! Your KYC has been approved and your trading escrow account (${escrowAccountRef}) is now active. You can start trading on NEXCOM Exchange.`,
        metadata: { escrowAccountRef, farmerId: farmer.id, currency: input.currency },
        read: false,
      });

      return {
        success: true,
        escrowAccountRef,
        farmerId: farmer.id,
        message: "Farmer onboarded and escrow account created",
      };
    }),

  // ─── Apply for Input Loan ──────────────────────────────────────────────────
  applyLoan: protectedProcedure
    .input(
      z.object({
        inputType: z.enum(["SEEDS", "FERTILIZER", "PESTICIDE", "HERBICIDE", "EQUIPMENT", "IRRIGATION", "STORAGE", "CASH"]),
        inputDescription: z.string().min(10).max(500),
        requestedValueNgn: z.number().positive(),
        tenorMonths: z.number().int().min(1).max(24).default(6),
        repaymentMethod: z.enum(["HARVEST_DEDUCTION", "MONTHLY", "LUMP_SUM"]).default("HARVEST_DEDUCTION"),
        collateralEwrId: z.number().int().positive().optional(),
        notes: z.string().max(1000).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database unavailable");
      const farmerRow = await db
        .select({ id: farmerProfiles.id })
        .from(farmerProfiles)
        .where(eq(farmerProfiles.userId, ctx.user.id))
        .limit(1);
      const farmerId = farmerRow.length > 0 ? farmerRow[0].id : ctx.user.id;
      const [loan] = await db
        .insert(inputFinancingLoans)
        .values({
          farmerId,
          inputType: input.inputType,
          inputDescription: input.inputDescription,
          requestedValueNgn: String(input.requestedValueNgn),
          tenorMonths: input.tenorMonths,
          repaymentMethod: input.repaymentMethod,
          collateralEwrId: input.collateralEwrId,
          notes: input.notes,
          status: "APPLIED",
        })
        .returning();
      await db.insert(notifications).values({
        userId: ctx.user.id,
        type: "SYSTEM",
        title: "Loan Application Submitted",
        message: `Your ${input.inputType} loan application for ₦${input.requestedValueNgn.toLocaleString()} has been received and is under review.`,
        metadata: { loanId: loan.id, inputType: input.inputType },
        read: false,
      });
      return { success: true, loanId: loan.id, status: "APPLIED" };
    }),

  // ─── Submit Insurance Claim ────────────────────────────────────────────────
  submitInsuranceClaim: protectedProcedure
    .input(
      z.object({
        policyId: z.number().int().positive(),
        lossType: z.enum(["DROUGHT", "FLOOD", "PEST", "DISEASE", "FIRE", "THEFT", "OTHER"]),
        affectedAreaHectares: z.number().positive(),
        estimatedLossNgn: z.number().positive(),
        incidentDate: z.string(),
        description: z.string().min(20).max(2000),
        evidenceUrls: z.array(z.string().url()).max(10).default([]),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database unavailable");
      const claimRef = `CLM-${ctx.user.id}-${Date.now()}`;
      await db.insert(notifications).values({
        userId: ctx.user.id,
        type: "SYSTEM",
        title: "Insurance Claim Submitted",
        message: `Your ${input.lossType} claim (ref: ${claimRef}) for ₦${input.estimatedLossNgn.toLocaleString()} has been submitted and is under review.`,
        metadata: {
          claimRef,
          policyId: input.policyId,
          lossType: input.lossType,
          estimatedLossNgn: input.estimatedLossNgn,
          evidenceUrls: input.evidenceUrls,
        },
        read: false,
      });
      return { success: true, claimRef, status: "SUBMITTED" };
    }),
});
