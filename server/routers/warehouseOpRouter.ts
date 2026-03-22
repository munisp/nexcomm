/**
 * NEXCOM Exchange — Warehouse Operator Onboarding Router
 * Handles Warehouse Operator facility registration, NWR certification KYC,
 * admin review, and operations dashboard.
 */
import { z } from "zod";
import { eq, desc, sql, and } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, adminProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { notifyOwner } from "../_core/notification";
import { warehouseOperatorProfiles, kycAuditLog, warehouseReceipts } from "../../drizzle/schema";
import { storagePut } from "../storage";

export const warehouseOpRouter = router({
  // ── registerWarehouseOp ─────────────────────────────────────────────────────
  registerWarehouseOp: protectedProcedure
    .input(z.object({
      facilityName: z.string().min(2).max(200),
      facilityAddress: z.string().min(5),
      state: z.string().min(2).max(100),
      lga: z.string().optional(),
      gpsLat: z.number().min(-90).max(90).optional(),
      gpsLng: z.number().min(-180).max(180).optional(),
      storageCapacityMt: z.number().positive().optional(),
      commoditiesHandled: z.array(z.string()).optional(),
      gradingStaffCount: z.number().int().min(0).optional(),
      operatingHours: z.string().optional(),
      acceptedGrades: z.array(z.string()).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      const [existing] = await db
        .select({ id: warehouseOperatorProfiles.id })
        .from(warehouseOperatorProfiles)
        .where(eq(warehouseOperatorProfiles.userId, ctx.user.id))
        .limit(1);
      if (existing) throw new TRPCError({ code: "CONFLICT", message: "Warehouse operator profile already exists" });
      const [profile] = await db
        .insert(warehouseOperatorProfiles)
        .values({
          userId: ctx.user.id,
          facilityName: input.facilityName,
          facilityAddress: input.facilityAddress,
          state: input.state,
          lga: input.lga,
          gpsLat: input.gpsLat !== undefined ? String(input.gpsLat) : undefined,
          gpsLng: input.gpsLng !== undefined ? String(input.gpsLng) : undefined,
          storageCapacityMt: input.storageCapacityMt !== undefined ? String(input.storageCapacityMt) : undefined,
          commoditiesHandled: input.commoditiesHandled ?? [],
          gradingStaffCount: input.gradingStaffCount,
          operatingHours: input.operatingHours,
          acceptedGrades: input.acceptedGrades ?? [],
        })
        .returning();
      return profile;
    }),

  // ── getMyWarehouseOpProfile ─────────────────────────────────────────────────
  getMyWarehouseOpProfile: protectedProcedure
    .query(async ({ ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      const [profile] = await db
        .select()
        .from(warehouseOperatorProfiles)
        .where(eq(warehouseOperatorProfiles.userId, ctx.user.id))
        .limit(1);
      return profile ?? null;
    }),

  // ── uploadKycDocument ─────────────────────────────────────────────────────
  uploadKycDocument: protectedProcedure
    .input(z.object({
      docId: z.enum(["nwrCertDocUrl", "facilityInspectionUrl", "insuranceDocUrl"]),
      fileName: z.string().min(1).max(200),
      mimeType: z.string().min(1).max(100),
      base64Data: z.string().min(1),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      const [profile] = await db
        .select()
        .from(warehouseOperatorProfiles)
        .where(eq(warehouseOperatorProfiles.userId, ctx.user.id))
        .limit(1);
      if (!profile) throw new TRPCError({ code: "NOT_FOUND", message: "Warehouse operator profile not found. Please register first." });
      const buffer = Buffer.from(input.base64Data, "base64");
      if (buffer.length > 10 * 1024 * 1024) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "File must be under 10 MB" });
      }
      const suffix = Date.now().toString(36);
      const ext = input.fileName.split(".").pop() ?? "bin";
      const fileKey = `warehouse-kyc/${ctx.user.id}/${input.docId}-${suffix}.${ext}`;
      const { url } = await storagePut(fileKey, buffer, input.mimeType);
      await db
        .update(warehouseOperatorProfiles)
        .set({ [input.docId]: url, updatedAt: new Date() })
        .where(eq(warehouseOperatorProfiles.userId, ctx.user.id));
      return { url };
    }),

  // ── submitWarehouseOpKYC ────────────────────────────────────────────────────────────────────────
  submitWarehouseOpKYC: protectedProcedure
    .input(z.object({
      nwrCertNumber: z.string().min(1),
      nwrCertDocUrl: z.string().url(),
      facilityInspectionUrl: z.string().url().optional(),
      insuranceDocUrl: z.string().url().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      const [profile] = await db
        .select()
        .from(warehouseOperatorProfiles)
        .where(eq(warehouseOperatorProfiles.userId, ctx.user.id))
        .limit(1);
      if (!profile) throw new TRPCError({ code: "NOT_FOUND", message: "Warehouse operator profile not found. Please register first." });
      if (profile.kycStatus === "APPROVED") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "KYC already approved" });
      }
      const [updated] = await db
        .update(warehouseOperatorProfiles)
        .set({
          nwrCertNumber: input.nwrCertNumber,
          nwrCertDocUrl: input.nwrCertDocUrl,
          facilityInspectionUrl: input.facilityInspectionUrl,
          insuranceDocUrl: input.insuranceDocUrl,
          kycStatus: "UNDER_REVIEW",
          updatedAt: new Date(),
        })
        .where(eq(warehouseOperatorProfiles.userId, ctx.user.id))
        .returning();
      // Notify exchange operations team of new KYC submission
      notifyOwner({
        title: "[Warehouse Op KYC] New submission under review",
        content: `Warehouse operator profile ID ${updated.id} (user ${ctx.user.id}, ${updated.facilityName}) has submitted KYC documents and is now UNDER_REVIEW. Please review at /admin/stakeholders.`,
      }).catch(e => console.warn("[warehouseOpRouter] notifyOwner failed:", (e as Error).message));
      return { kycStatus: updated.kycStatus };
    }),

  // ── getWarehouseOpDashboard ─────────────────────────────────────────────────
  getWarehouseOpDashboard: protectedProcedure
    .query(async ({ ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      const [profile] = await db
        .select()
        .from(warehouseOperatorProfiles)
        .where(eq(warehouseOperatorProfiles.userId, ctx.user.id))
        .limit(1);
      // Fetch real receipt stats linked to this warehouse operator's user account
      let receiptStats = { total: 0, active: 0, pledged: 0, redeemed: 0 };
      let inventoryStats = { totalItems: 0, totalQuantityMt: 0 };
      if (profile) {
        const receipts = await db
          .select()
          .from(warehouseReceipts)
          .where(eq(warehouseReceipts.userId, ctx.user.id));
        receiptStats = {
          total: receipts.length,
          active: receipts.filter(r => r.status === "ACTIVE").length,
          pledged: receipts.filter(r => r.status === "PLEDGED").length,
          redeemed: receipts.filter(r => r.status === "REDEEMED").length,
        };
        const liveReceipts = receipts.filter(r => r.status === "ACTIVE" || r.status === "PLEDGED");
        inventoryStats = {
          totalItems: liveReceipts.length,
          totalQuantityMt: liveReceipts.reduce((sum, r) => sum + (r.quantity ? parseFloat(String(r.quantity)) : 0), 0),
        };
      }
      const capacityMt = profile?.storageCapacityMt ? parseFloat(String(profile.storageCapacityMt)) : 0;
      const utilizationPct = capacityMt > 0 ? Math.min(100, (inventoryStats.totalQuantityMt / capacityMt) * 100) : 0;
      return {
        profile: profile ?? null,
        kycStatus: profile?.kycStatus ?? "PENDING",
        accountStatus: profile?.accountStatus ?? "INACTIVE",
        isRegistered: !!profile,
        isKycApproved: profile?.kycStatus === "APPROVED",
        isActive: profile?.accountStatus === "ACTIVE",
        storageCapacityMt: capacityMt,
        commoditiesHandled: profile?.commoditiesHandled ?? [],
        receiptStats,
        inventoryStats,
        utilizationPct: Math.round(utilizationPct * 10) / 10,
      };
    }),

  // ── adminReviewWarehouseOpKYC ───────────────────────────────────────────────
  adminReviewWarehouseOpKYC: adminProcedure
    .input(z.object({
      warehouseOpId: z.number().int().positive(),
      decision: z.enum(["APPROVED", "REJECTED"]),
      notes: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      const [profile] = await db
        .select()
        .from(warehouseOperatorProfiles)
        .where(eq(warehouseOperatorProfiles.id, input.warehouseOpId))
        .limit(1);
      if (!profile) throw new TRPCError({ code: "NOT_FOUND", message: "Warehouse operator profile not found" });
      if (!["UNDER_REVIEW", "SUBMITTED"].includes(profile.kycStatus)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Warehouse operator KYC is not under review" });
      }
      const [updated] = await db
        .update(warehouseOperatorProfiles)
        .set({
          kycStatus: input.decision,
          kycNotes: input.notes,
          accountStatus: input.decision === "APPROVED" ? "ACTIVE" : "INACTIVE",
          updatedAt: new Date(),
        })
        .where(eq(warehouseOperatorProfiles.id, input.warehouseOpId))
        .returning();
      // Insert audit log entry
      await db.insert(kycAuditLog).values({
        stakeholderType: "WAREHOUSE_OPERATOR",
        profileId: input.warehouseOpId,
        reviewerId: ctx.user.id,
        reviewerName: ctx.user.name ?? null,
        decision: input.decision,
        notes: input.notes ?? null,
      });
      notifyOwner({
        title: `[Warehouse Op KYC] Application ${input.decision}`,
        content: `Warehouse operator profile ID ${updated.id} (${updated.facilityName}) KYC has been ${input.decision}. Account status: ${updated.accountStatus}. Notes: ${input.notes ?? "None"}.`,
      }).catch(e => console.warn("[warehouseOpRouter] notifyOwner failed:", (e as Error).message));
      return { kycStatus: updated.kycStatus, accountStatus: updated.accountStatus };
    }),

  // ── adminBulkReviewWarehouseOpKYC ───────────────────────────────────────────
  adminBulkReviewWarehouseOpKYC: adminProcedure
    .input(z.object({
      warehouseOpIds: z.array(z.number().int().positive()).min(1).max(100),
      decision: z.enum(["APPROVED", "REJECTED"]),
      notes: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      let approved = 0, rejected = 0, failed = 0;
      const results: { id: number; status: string; error?: string }[] = [];
      for (const id of input.warehouseOpIds) {
        try {
          const [profile] = await db
            .select({ kycStatus: warehouseOperatorProfiles.kycStatus })
            .from(warehouseOperatorProfiles)
            .where(eq(warehouseOperatorProfiles.id, id))
            .limit(1);
          if (!profile || !["UNDER_REVIEW", "SUBMITTED"].includes(profile.kycStatus)) {
            failed++;
            results.push({ id, status: "SKIPPED", error: "Not under review" });
            continue;
          }
          await db
            .update(warehouseOperatorProfiles)
            .set({
              kycStatus: input.decision,
              kycNotes: input.notes,
              accountStatus: input.decision === "APPROVED" ? "ACTIVE" : "INACTIVE",
              updatedAt: new Date(),
            })
            .where(eq(warehouseOperatorProfiles.id, id));
          if (input.decision === "APPROVED") approved++;
          else rejected++;
          results.push({ id, status: input.decision });
        } catch {
          failed++;
          results.push({ id, status: "ERROR", error: "Update failed" });
        }
      }
      return { approved, rejected, failed, total: input.warehouseOpIds.length, results };
    }),

  // ── adminGetWarehouseOpStats ────────────────────────────────────────────────
  adminGetWarehouseOpStats: adminProcedure
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
          totalCapacityMt: sql<string>`COALESCE(SUM(storage_capacity_mt), 0)`,
        })
        .from(warehouseOperatorProfiles);
      return {
        ...stats,
        totalCapacityMt: parseFloat(stats.totalCapacityMt),
      };
    }),

  // ── adminListWarehouseOpProfiles ────────────────────────────────────────────
  adminListWarehouseOpProfiles: adminProcedure
    .input(z.object({
      kycStatus: z.enum(["PENDING", "UNDER_REVIEW", "APPROVED", "REJECTED"]).optional(),
      limit: z.number().int().min(1).max(100).default(50),
      offset: z.number().int().min(0).default(0),
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      const conditions = input.kycStatus
        ? [eq(warehouseOperatorProfiles.kycStatus, input.kycStatus)]
        : [];
      const profiles = await db
        .select()
        .from(warehouseOperatorProfiles)
        .where(conditions.length ? and(...conditions) : undefined)
        .orderBy(desc(warehouseOperatorProfiles.createdAt))
        .limit(input.limit)
        .offset(input.offset);
      const [countResult] = await db
        .select({ total: sql<number>`COUNT(*)::int` })
        .from(warehouseOperatorProfiles)
        .where(conditions.length ? and(...conditions) : undefined);
      return { profiles, total: countResult.total };
    }),

  // ── updateMyWarehouseOpProfile ────────────────────────────────────────────────
  updateMyWarehouseOpProfile: protectedProcedure
    .input(z.object({
      facilityName: z.string().min(2).max(200).optional(),
      facilityAddress: z.string().optional(),
      state: z.string().max(100).optional(),
      lga: z.string().max(100).optional(),
      storageCapacityMt: z.number().min(0).optional(),
      commoditiesHandled: z.array(z.string()).optional(),
      gradingStaffCount: z.number().int().min(0).optional(),
      operatingHours: z.string().max(100).optional(),
      acceptedGrades: z.array(z.string()).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      const [existing] = await db
        .select()
        .from(warehouseOperatorProfiles)
        .where(eq(warehouseOperatorProfiles.userId, ctx.user.id))
        .limit(1);
      if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "Warehouse operator profile not found" });
      const kycSensitiveChanged =
        (input.facilityName !== undefined && input.facilityName !== existing.facilityName) ||
        (input.facilityAddress !== undefined && input.facilityAddress !== existing.facilityAddress);
      const newKycStatus = kycSensitiveChanged && existing.kycStatus === "APPROVED" ? "PENDING" : existing.kycStatus;
      const updateData: Record<string, unknown> = { ...input, kycStatus: newKycStatus, updatedAt: new Date() };
      if (input.storageCapacityMt !== undefined) updateData.storageCapacityMt = String(input.storageCapacityMt);
      const [updated] = await db
        .update(warehouseOperatorProfiles)
        .set(updateData)
        .where(eq(warehouseOperatorProfiles.userId, ctx.user.id))
        .returning();
      if (kycSensitiveChanged && existing.kycStatus === "APPROVED") {
        notifyOwner({
          title: "[Warehouse Op] Profile updated — KYC reset to PENDING",
          content: `Warehouse operator ${updated.facilityName} (user ${ctx.user.id}) changed facility identity fields. KYC status reset from APPROVED to PENDING. Please re-review at /admin/stakeholders.`,
        }).catch(e => console.warn("[warehouseOpRouter] notifyOwner failed:", (e as Error).message));
      }
      return { ...updated, kycResetDueToChange: kycSensitiveChanged && existing.kycStatus === "APPROVED" };
    }),
});
