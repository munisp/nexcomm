/**
 * NEXCOM Exchange — Market Maker Onboarding Router
 * Handles Market Maker firm profile, instrument obligations, capital commitment,
 * KYC review, and performance dashboard.
 */
import { z } from "zod";
import { eq, desc, sql, and } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, adminProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { notifyOwner } from "../_core/notification";
import { marketMakerOnboardingProfiles, kycAuditLog } from "../../drizzle/schema";
import { storagePut } from "../storage";
import { writeAuditLog } from "../audit";

export const marketMakerOnboardingRouter = router({
  // ── registerMarketMaker ─────────────────────────────────────────────────────
  registerMarketMaker: protectedProcedure
    .input(z.object({
      firmName: z.string().min(2).max(200),
      tradingDesk: z.string().optional(),
      contactPhone: z.string().min(7).max(30).optional(),
      contactEmail: z.string().email().optional(),
      yearsOfOperation: z.number().int().min(0).optional(),
      regulatoryRegistrations: z.string().optional(),
      instrumentObligations: z.array(z.string().trim()).optional(),
      minQuoteSizeLots: z.number().positive().optional(),
      maxSpreadBps: z.number().positive().optional(),
      capitalCommitmentNgn: z.number().positive().optional(),
      performanceBondNgn: z.number().positive().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      const [existing] = await db
        .select({ id: marketMakerOnboardingProfiles.id })
        .from(marketMakerOnboardingProfiles)
        .where(eq(marketMakerOnboardingProfiles.userId, ctx.user.id))
        .limit(1);
      if (existing) throw new TRPCError({ code: "CONFLICT", message: "Market maker profile already exists" });
      const [profile] = await db
        .insert(marketMakerOnboardingProfiles)
        .values({
          userId: ctx.user.id,
          firmName: input.firmName,
          tradingDesk: input.tradingDesk,
          contactPhone: input.contactPhone,
          contactEmail: input.contactEmail,
          yearsOfOperation: input.yearsOfOperation,
          regulatoryRegistrations: input.regulatoryRegistrations,
          instrumentObligations: input.instrumentObligations ?? [],
          minQuoteSizeLots: input.minQuoteSizeLots !== undefined ? String(input.minQuoteSizeLots) : undefined,
          maxSpreadBps: input.maxSpreadBps !== undefined ? String(input.maxSpreadBps) : undefined,
          capitalCommitmentNgn: input.capitalCommitmentNgn !== undefined ? String(input.capitalCommitmentNgn) : undefined,
          performanceBondNgn: input.performanceBondNgn !== undefined ? String(input.performanceBondNgn) : undefined,
        })
        .returning();
      return profile;
    }),

  // ── getMyMarketMakerProfile ─────────────────────────────────────────────────
  getMyMarketMakerProfile: protectedProcedure
    .query(async ({ ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      const [profile] = await db
        .select()
        .from(marketMakerOnboardingProfiles)
        .where(eq(marketMakerOnboardingProfiles.userId, ctx.user.id))
        .limit(1);
      return profile ?? null;
    }),

  // ── submitMarketMakerKYC ────────────────────────────────────────────────────
  submitMarketMakerKYC: protectedProcedure
    .input(z.object({
      firmRegistrationUrl: z.string().url(),
      tradingLicenseUrl: z.string().url(),
      capitalAdequacyUrl: z.string().url().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      const [profile] = await db
        .select()
        .from(marketMakerOnboardingProfiles)
        .where(eq(marketMakerOnboardingProfiles.userId, ctx.user.id))
        .limit(1);
      if (!profile) throw new TRPCError({ code: "NOT_FOUND", message: "Market maker profile not found. Please register first." });
      if (profile.kycStatus === "APPROVED") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "KYC already approved" });
      }
      const [updated] = await db
        .update(marketMakerOnboardingProfiles)
        .set({
          firmRegistrationUrl: input.firmRegistrationUrl,
          tradingLicenseUrl: input.tradingLicenseUrl,
          capitalAdequacyUrl: input.capitalAdequacyUrl,
          kycStatus: "UNDER_REVIEW",
          updatedAt: new Date(),
        })
        .where(eq(marketMakerOnboardingProfiles.userId, ctx.user.id))
        .returning();
      // Notify exchange operations team of new KYC submission
      notifyOwner({
        title: "[Market Maker KYC] New submission under review",
        content: `Market maker profile ID ${updated.id} (user ${ctx.user.id}, ${updated.firmName}) has submitted KYC documents and is now UNDER_REVIEW. Please review at /admin/stakeholders.`,
      }).catch(e => console.warn("[marketMakerOnboardingRouter] notifyOwner failed:", (e as Error).message));
      return { kycStatus: updated.kycStatus };
    }),

  // ── getMarketMakerOnboardingDashboard ───────────────────────────────────────
  getMarketMakerOnboardingDashboard: protectedProcedure
    .query(async ({ ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      const [profile] = await db
        .select()
        .from(marketMakerOnboardingProfiles)
        .where(eq(marketMakerOnboardingProfiles.userId, ctx.user.id))
        .limit(1);
      return {
        profile: profile ?? null,
        kycStatus: profile?.kycStatus ?? "PENDING",
        accountStatus: profile?.accountStatus ?? "INACTIVE",
        isRegistered: !!profile,
        isKycApproved: profile?.kycStatus === "APPROVED",
        isActive: profile?.accountStatus === "ACTIVE",
        instrumentObligations: profile?.instrumentObligations ?? [],
        maxSpreadBps: profile?.maxSpreadBps ? parseFloat(String(profile.maxSpreadBps)) : null,
        capitalCommitmentNgn: profile?.capitalCommitmentNgn ? parseFloat(String(profile.capitalCommitmentNgn)) : null,
      };
    }),

  // ── adminReviewMarketMakerKYC ───────────────────────────────────────────────
  adminReviewMarketMakerKYC: adminProcedure
    .input(z.object({
      marketMakerId: z.number().int().positive(),
      decision: z.enum(["APPROVED", "REJECTED"]),
      notes: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      const [profile] = await db
        .select()
        .from(marketMakerOnboardingProfiles)
        .where(eq(marketMakerOnboardingProfiles.id, input.marketMakerId))
        .limit(1);
      if (!profile) throw new TRPCError({ code: "NOT_FOUND", message: "Market maker profile not found" });
      if (!["UNDER_REVIEW", "SUBMITTED"].includes(profile.kycStatus)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Market maker KYC is not under review" });
      }
      const [updated] = await db
        .update(marketMakerOnboardingProfiles)
        .set({
          kycStatus: input.decision,
          kycNotes: input.notes,
          accountStatus: input.decision === "APPROVED" ? "ACTIVE" : "INACTIVE",
          updatedAt: new Date(),
        })
        .where(eq(marketMakerOnboardingProfiles.id, input.marketMakerId))
        .returning();
      // Insert audit log entry
      await db.insert(kycAuditLog).values({
        stakeholderType: "MARKET_MAKER",
        profileId: input.marketMakerId,
        reviewerId: ctx.user.id,
        reviewerName: ctx.user.name ?? null,
        decision: input.decision,
        notes: input.notes ?? null,
      });
      notifyOwner({
        title: `[Market Maker KYC] Application ${input.decision}`,
        content: `Market maker profile ID ${updated.id} (${updated.firmName}) KYC has been ${input.decision}. Account status: ${updated.accountStatus}. Notes: ${input.notes ?? "None"}.`,
      }).catch(e => console.warn("[marketMakerOnboardingRouter] notifyOwner failed:", (e as Error).message));
      return { kycStatus: updated.kycStatus, accountStatus: updated.accountStatus };
    }),
  // ── adminBulkReviewMarketMakerKYCC ──────────────────────────────────────────
  adminBulkReviewMarketMakerKYC: adminProcedure
    .input(z.object({
      marketMakerIds: z.array(z.number().int().positive()).min(1).max(100),
      decision: z.enum(["APPROVED", "REJECTED"]),
      notes: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      let approved = 0, rejected = 0, failed = 0;
      const results: { id: number; status: string; error?: string }[] = [];
      for (const id of input.marketMakerIds) {
        try {
          const [profile] = await db
            .select({ kycStatus: marketMakerOnboardingProfiles.kycStatus })
            .from(marketMakerOnboardingProfiles)
            .where(eq(marketMakerOnboardingProfiles.id, id))
            .limit(1);
          if (!profile || !["UNDER_REVIEW", "SUBMITTED"].includes(profile.kycStatus)) {
            failed++;
            results.push({ id, status: "SKIPPED", error: "Not under review" });
            continue;
          }
          await db
            .update(marketMakerOnboardingProfiles)
            .set({
              kycStatus: input.decision,
              kycNotes: input.notes,
              accountStatus: input.decision === "APPROVED" ? "ACTIVE" : "INACTIVE",
              updatedAt: new Date(),
            })
            .where(eq(marketMakerOnboardingProfiles.id, id));
          if (input.decision === "APPROVED") approved++;
          else rejected++;
          results.push({ id, status: input.decision });
        } catch {
          failed++;
          results.push({ id, status: "ERROR", error: "Update failed" });
        }
      }
      return { approved, rejected, failed, total: input.marketMakerIds.length, results };
    }),

  // ── adminGetMarketMakerStats ────────────────────────────────────────────────
  adminGetMarketMakerStats: adminProcedure
    .query(async () => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      const [stats] = await db
        .select({
          total: sql<number>`COUNT(*)::int`,
          pending: sql<number>`SUM(CASE WHEN kyc_status = 'PENDING' THEN 1 ELSE 0 END)::int`,
          underReview: sql<number>`SUM(CASE WHEN kyc_status = 'UNDER_REVIEW' THEN 1 ELSE 0 END)::int`,
          approved: sql<number>`SUM(CASE WHEN kyc_status = 'APPROVED' THEN 1 ELSE 0 END)::int`,
          rejected: sql<number>`SUM(CASE WHEN kyc_status = 'REJECTED' THEN 1 ELSE 0 END)::int`,
          active: sql<number>`SUM(CASE WHEN account_status = 'ACTIVE' THEN 1 ELSE 0 END)::int`,
          totalCapitalCommitmentNgn: sql<string>`COALESCE(SUM(capital_commitment_ngn), 0)`,
        })
        .from(marketMakerOnboardingProfiles);
      return {
        ...stats,
        totalCapitalCommitmentNgn: parseFloat(stats.totalCapitalCommitmentNgn),
      };
    }),

  // ── adminListMarketMakerProfiles ────────────────────────────────────────────
  adminListMarketMakerProfiles: adminProcedure
    .input(z.object({
      kycStatus: z.enum(["PENDING", "UNDER_REVIEW", "APPROVED", "REJECTED"]).optional(),
      limit: z.number().int().min(1).max(100).default(50),
      offset: z.number().int().min(0).default(0),
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      const conditions = input.kycStatus
        ? [eq(marketMakerOnboardingProfiles.kycStatus, input.kycStatus)]
        : [];
      const profiles = await db
        .select()
        .from(marketMakerOnboardingProfiles)
        .where(conditions.length ? and(...conditions) : undefined)
        .orderBy(desc(marketMakerOnboardingProfiles.createdAt))
        .limit(input.limit)
        .offset(input.offset);
      const [countResult] = await db
        .select({ total: sql<number>`COUNT(*)::int` })
        .from(marketMakerOnboardingProfiles)
        .where(conditions.length ? and(...conditions) : undefined);
      return { profiles, total: countResult.total };
    }),

  // ── updateMyMarketMakerProfile ────────────────────────────────────────────────
  updateMyMarketMakerProfile: protectedProcedure
    .input(z.object({
      firmName: z.string().min(2).max(200).optional(),
      tradingDesk: z.string().max(200).optional(),
      contactPhone: z.string().max(30).optional(),
      contactEmail: z.string().email().optional(),
      yearsOfOperation: z.number().int().min(0).optional(),
      regulatoryRegistrations: z.string().optional(),
      instrumentObligations: z.array(z.string().trim()).optional(),
      minQuoteSizeLots: z.number().min(0).optional(),
      maxSpreadBps: z.number().min(0).optional(),
      capitalCommitmentNgn: z.number().min(0).optional(),
      performanceBondNgn: z.number().min(0).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      const [existing] = await db
        .select()
        .from(marketMakerOnboardingProfiles)
        .where(eq(marketMakerOnboardingProfiles.userId, ctx.user.id))
        .limit(1);
      if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "Market maker profile not found" });
      const kycSensitiveChanged =
        (input.firmName !== undefined && input.firmName !== existing.firmName) ||
        (input.capitalCommitmentNgn !== undefined &&
          String(input.capitalCommitmentNgn) !== String(existing.capitalCommitmentNgn ?? ""));
      const newKycStatus = kycSensitiveChanged && existing.kycStatus === "APPROVED" ? "PENDING" : existing.kycStatus;
      const updateData: Record<string, unknown> = { ...input, kycStatus: newKycStatus, updatedAt: new Date() };
      if (input.minQuoteSizeLots !== undefined) updateData.minQuoteSizeLots = String(input.minQuoteSizeLots);
      if (input.maxSpreadBps !== undefined) updateData.maxSpreadBps = String(input.maxSpreadBps);
      if (input.capitalCommitmentNgn !== undefined) updateData.capitalCommitmentNgn = String(input.capitalCommitmentNgn);
      if (input.performanceBondNgn !== undefined) updateData.performanceBondNgn = String(input.performanceBondNgn);
      const [updated] = await db
        .update(marketMakerOnboardingProfiles)
        .set(updateData)
        .where(eq(marketMakerOnboardingProfiles.userId, ctx.user.id))
        .returning();
      if (kycSensitiveChanged && existing.kycStatus === "APPROVED") {
        notifyOwner({
          title: "[Market Maker] Profile updated — KYC reset to PENDING",
          content: `Market maker ${updated.firmName} (user ${ctx.user.id}) changed firm identity fields. KYC status reset from APPROVED to PENDING. Please re-review at /admin/stakeholders.`,
        }).catch(e => console.warn("[marketMakerOnboardingRouter] notifyOwner failed:", (e as Error).message));
      }
      return { ...updated, kycResetDueToChange: kycSensitiveChanged && existing.kycStatus === "APPROVED" };
    }),

  // ── uploadKycDocument ───────────────────────────────────────────────────────
  uploadKycDocument: protectedProcedure
    .input(z.object({
      docId: z.enum(["firmRegistrationUrl", "tradingLicenseUrl", "capitalAdequacyUrl"]),
      fileName: z.string().trim(),
      mimeType: z.string().trim(),
      base64Data: z.string().trim(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      const [existing] = await db
        .select({ id: marketMakerOnboardingProfiles.id })
        .from(marketMakerOnboardingProfiles)
        .where(eq(marketMakerOnboardingProfiles.userId, ctx.user.id))
        .limit(1);
      if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "Market maker profile not found" });
      const buffer = Buffer.from(input.base64Data, "base64");
      const suffix = Date.now().toString(36);
      const fileKey = `market-maker-kyc/${ctx.user.id}/${input.docId}-${suffix}-${input.fileName}`;
      const { url } = await storagePut(fileKey, buffer, input.mimeType);
      await db
        .update(marketMakerOnboardingProfiles)
        .set({ [input.docId]: url })
        .where(eq(marketMakerOnboardingProfiles.userId, ctx.user.id));
      return { url };
    }),


  withdrawApplication: protectedProcedure
    .input(z.object({ reason: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "Database unavailable" });
      const [profile] = await db.update(marketMakerOnboardingProfiles)
        .set({ kycStatus: "WITHDRAWN", updatedAt: new Date() })
        .where(and(eq(marketMakerOnboardingProfiles.userId, ctx.user.id), eq(marketMakerOnboardingProfiles.kycStatus, "PENDING")))
        .returning();
      if (!profile) throw new TRPCError({ code: "NOT_FOUND", message: "Application not found or not in PENDING status" });
      return { success: true };
    }),


  withdrawApplication: protectedProcedure
    .input(z.object({ reason: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "Database unavailable" });
      const [profile] = await db.update(marketMakerOnboardingProfiles)
        .set({ kycStatus: "WITHDRAWN", updatedAt: new Date() })
        .where(and(eq(marketMakerOnboardingProfiles.userId, ctx.user.id), eq(marketMakerOnboardingProfiles.kycStatus, "PENDING")))
        .returning();
      if (!profile) throw new TRPCError({ code: "NOT_FOUND", message: "Application not found or not in PENDING status" });
      return { success: true };
    }),
});
