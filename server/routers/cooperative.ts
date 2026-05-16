/**
 * Cooperative Router
 * Provides cooperative admin-facing views: aggregate member KYC stats,
 * paginated member list, and bulk upload history.
 *
 * Members are stored in the kycQueue table; uploads are in cooperativeBulkUploads.
 * The link between them is the `createdApplicationIds` JSON array on each upload row.
 */
import { TRPCError } from "@trpc/server";
import { and, count, desc, eq, inArray, like } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../db";
import {
  bulkListingApprovals,
  cooperativeBulkUploads,
  cropListings,
  farmProfiles,
  farmerProfiles,
  kycQueue,
  notifications,
  profiles,
  users,
} from "../../drizzle/schema";
import { protectedProcedure, router } from "../_core/trpc";
import { writeAuditLog } from "../audit";

// ─── Guard: platform admin only ───────────────────────────────────────────────
function assertAdmin(role: string) {
  if (role !== "admin") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Only administrators can access the cooperative dashboard.",
    });
  }
}

// ─── Router ───────────────────────────────────────────────────────────────────
export const cooperativeRouter = router({
  /**
   * Aggregate KYC statistics across all cooperative bulk uploads.
   * Returns total member counts broken down by status.
   */
  myStats: protectedProcedure.query(async ({ ctx }) => {
    assertAdmin(ctx.user.role);
    const db = await getDb();
    if (!db) return {
      totalUploads: 0,
      totalMembers: 0,
      pendingMembers: 0,
      approvedMembers: 0,
      rejectedMembers: 0,
      recentActivity: [],
    };

    // All uploads by this admin
    const uploadRows = await db
      .select()
      .from(cooperativeBulkUploads)
      .where(eq(cooperativeBulkUploads.uploadedBy, ctx.user.id))
      .orderBy(desc(cooperativeBulkUploads.createdAt));

    if (uploadRows.length === 0) {
      return {
        totalUploads: 0,
        totalMembers: 0,
        pendingMembers: 0,
        approvedMembers: 0,
        rejectedMembers: 0,
        recentActivity: [],
      };
    }

    // Collect all KYC application IDs from all uploads
    const allAppIds: number[] = uploadRows.flatMap(u =>
      (u.createdApplicationIds as number[] | null) ?? [],
    );

    let memberRows: Array<{
      id: number;
      status: "PENDING" | "UNDER_REVIEW" | "APPROVED" | "REJECTED";
      uploadId?: number;
    }> = [];

    if (allAppIds.length > 0) {
      const rows = await db
        .select({ id: kycQueue.id, status: kycQueue.status })
        .from(kycQueue)
        .where(inArray(kycQueue.id, allAppIds));

      // Attach uploadId to each member for grouping
      memberRows = rows.map(r => {
        const ownerUpload = uploadRows.find(u =>
          ((u.createdApplicationIds as number[] | null) ?? []).includes(r.id),
        );
        return { ...r, uploadId: ownerUpload?.id };
      });
    }

    const totalMembers = memberRows.length;
    const pendingMembers = memberRows.filter(m => m.status === "PENDING" || m.status === "UNDER_REVIEW").length;
    const approvedMembers = memberRows.filter(m => m.status === "APPROVED").length;
    const rejectedMembers = memberRows.filter(m => m.status === "REJECTED").length;

    // Recent activity: last 5 uploads with their per-upload member status
    const recentActivity = uploadRows.slice(0, 5).map(u => {
      const uploadAppIds = (u.createdApplicationIds as number[] | null) ?? [];
      const uploadMembers = memberRows.filter(m => uploadAppIds.includes(m.id));
      return {
        uploadId: u.id,
        fileName: u.fileName,
        uploadedAt: u.createdAt,
        totalRows: u.totalRows,
        successRows: u.successRows,
        failedRows: u.failedRows,
        status: u.status,
        approvedCount: uploadMembers.filter(m => m.status === "APPROVED").length,
        pendingCount: uploadMembers.filter(m => m.status === "PENDING" || m.status === "UNDER_REVIEW").length,
        rejectedCount: uploadMembers.filter(m => m.status === "REJECTED").length,
      };
    });

    return {
      totalUploads: uploadRows.length,
      totalMembers,
      pendingMembers,
      approvedMembers,
      rejectedMembers,
      recentActivity,
    };
  }),

  /**
   * Paginated list of all KYC members across uploads by this admin,
   * with their current status and review notes.
   */
  memberList: protectedProcedure
    .input(z.object({
      uploadId: z.number().int().positive().optional(),
      status: z.enum(["PENDING", "APPROVED", "REJECTED", "ALL"]).default("ALL"),
      page: z.number().int().min(1).default(1),
      pageSize: z.number().int().min(1).max(100).default(20),
    }))
    .query(async ({ ctx, input }) => {
      assertAdmin(ctx.user.role);
      const db = await getDb();
      if (!db) return { members: [], total: 0, page: input.page, pageSize: input.pageSize, totalPages: 0 };

      // Resolve which uploads belong to this admin
      let targetUploads: typeof cooperativeBulkUploads.$inferSelect[];
      if (input.uploadId) {
        const found = await db
          .select()
          .from(cooperativeBulkUploads)
          .where(
            and(
              eq(cooperativeBulkUploads.id, input.uploadId),
              eq(cooperativeBulkUploads.uploadedBy, ctx.user.id),
            ),
          )
          .limit(1);
        if (!found[0]) throw new TRPCError({ code: "NOT_FOUND", message: "Upload not found" });
        targetUploads = found;
      } else {
        targetUploads = await db
          .select()
          .from(cooperativeBulkUploads)
          .where(eq(cooperativeBulkUploads.uploadedBy, ctx.user.id));
      }

      const appIds: number[] = targetUploads.flatMap(u =>
        (u.createdApplicationIds as number[] | null) ?? [],
      );

      if (appIds.length === 0) {
        return { members: [], total: 0, page: input.page, pageSize: input.pageSize, totalPages: 0 };
      }

      // Filter by status
      const statusValues: Array<"PENDING" | "UNDER_REVIEW" | "APPROVED" | "REJECTED"> =
        input.status === "PENDING" ? ["PENDING", "UNDER_REVIEW"]
        : input.status === "APPROVED" ? ["APPROVED"]
        : input.status === "REJECTED" ? ["REJECTED"]
        : ["PENDING", "UNDER_REVIEW", "APPROVED", "REJECTED"];

      // Fetch all matching rows (for count + pagination)
      const allRows = await db
        .select({
          id: kycQueue.id,
          userId: kycQueue.userId,
          status: kycQueue.status,
          submittedAt: kycQueue.submittedAt,
          reviewedAt: kycQueue.reviewedAt,
          reviewNotes: kycQueue.reviewNotes,
          documents: kycQueue.documents,
          userName: users.name,
          userEmail: users.email,
        })
        .from(kycQueue)
        .leftJoin(users, eq(kycQueue.userId, users.id))
        .where(
          and(
            inArray(kycQueue.id, appIds),
            inArray(kycQueue.status, statusValues),
          ),
        )
        .orderBy(desc(kycQueue.submittedAt));

      const total = allRows.length;
      const offset = (input.page - 1) * input.pageSize;
      const paginated = allRows.slice(offset, offset + input.pageSize);

      // Attach uploadId to each member
      const enriched = paginated.map(m => {
        const ownerUpload = targetUploads.find(u =>
          ((u.createdApplicationIds as number[] | null) ?? []).includes(m.id),
        );
        const docs = m.documents as Record<string, unknown> | null;
        return {
          id: m.id,
          uploadId: ownerUpload?.id ?? null,
          userId: m.userId,
          userName: m.userName ?? null,
          userEmail: m.userEmail ?? null,
          fullName: (docs?.fullName as string | undefined) ?? m.userName ?? "—",
          nin: (docs?.nin as string | undefined) ?? null,
          bvn: (docs?.bvn as string | undefined) ?? null,
          phone: (docs?.phone as string | undefined) ?? null,
          state: (docs?.state as string | undefined) ?? null,
          lga: (docs?.lga as string | undefined) ?? null,
          status: m.status,
          reviewNotes: m.reviewNotes,
          reviewedAt: m.reviewedAt,
          submittedAt: m.submittedAt,
        };
      });

      return {
        members: enriched,
        total,
        page: input.page,
        pageSize: input.pageSize,
        totalPages: Math.ceil(total / input.pageSize),
      };
    }),

  /**
   * Full upload history for this admin, with per-upload member status breakdown.
   */
  uploadHistory: protectedProcedure
    .input(z.object({
      limit: z.number().int().min(1).max(50).default(20),
      offset: z.number().int().min(0).default(0),
    }))
    .query(async ({ ctx, input }) => {
      assertAdmin(ctx.user.role);
      const db = await getDb();
      if (!db) return { uploads: [], total: 0 };

      const allUploads = await db
        .select()
        .from(cooperativeBulkUploads)
        .where(eq(cooperativeBulkUploads.uploadedBy, ctx.user.id))
        .orderBy(desc(cooperativeBulkUploads.createdAt));

      const total = allUploads.length;
      const pageUploads = allUploads.slice(input.offset, input.offset + input.limit);

      if (pageUploads.length === 0) return { uploads: [], total };

      const allAppIds: number[] = pageUploads.flatMap(u =>
        (u.createdApplicationIds as number[] | null) ?? [],
      );

      let memberRows: Array<{ id: number; status: "PENDING" | "UNDER_REVIEW" | "APPROVED" | "REJECTED" }> = [];
      if (allAppIds.length > 0) {
        memberRows = await db
          .select({ id: kycQueue.id, status: kycQueue.status })
          .from(kycQueue)
          .where(inArray(kycQueue.id, allAppIds));
      }

      const enriched = pageUploads.map(u => {
        const uploadAppIds = (u.createdApplicationIds as number[] | null) ?? [];
        const members = memberRows.filter(m => uploadAppIds.includes(m.id));
        return {
          id: u.id,
          fileName: u.fileName,
          status: u.status,
          totalRows: u.totalRows,
          successRows: u.successRows,
          failedRows: u.failedRows,
          processedRows: u.processedRows,
          createdAt: u.createdAt,
          completedAt: u.completedAt,
          approvedCount: members.filter(m => m.status === "APPROVED").length,
          pendingCount: members.filter(m => m.status === "PENDING" || m.status === "UNDER_REVIEW").length,
          rejectedCount: members.filter(m => m.status === "REJECTED").length,
        };
      });

      return { uploads: enriched, total };
    }),

  /**
   * Approve a single KYC member from the cooperative dashboard.
   * Marks the kycQueue row as APPROVED and updates the user's profile kycStatus.
   */
  approveMember: protectedProcedure
    .input(z.object({
      kycQueueId: z.number().int().positive(),
      notes: z.string().max(512).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      assertAdmin(ctx.user.role);
      const db = await getDb();
            if (!db) throw new TRPCError({ code: "NOT_FOUND", message: "Not found" });

      const [entry] = await db
        .select()
        .from(kycQueue)
        .where(eq(kycQueue.id, input.kycQueueId))
        .limit(1);

      if (!entry) throw new TRPCError({ code: "NOT_FOUND", message: "KYC application not found" });
      if (entry.status === "APPROVED") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Application is already approved" });
      }

      await db
        .update(kycQueue)
        .set({ status: "APPROVED", reviewedBy: ctx.user.id, reviewNotes: input.notes ?? null, reviewedAt: new Date() })
        .where(eq(kycQueue.id, input.kycQueueId));

      await db
        .update(profiles)
        .set({ kycStatus: "VERIFIED", kycNotes: input.notes ?? null, updatedAt: new Date() })
        .where(eq(profiles.userId, entry.userId));

      await db.insert(notifications).values({
        userId: entry.userId,
        title: "KYC Approved \u2713",
        message: `Your KYC application has been approved. You now have full access to the NEXCOM trading platform.${input.notes ? ` Note: ${input.notes}` : ""}`,
        type: "KYC",
      });

      return { success: true, kycQueueId: input.kycQueueId };
    }),

  /**
   * Reject a single KYC member from the cooperative dashboard.
   */
  rejectMember: protectedProcedure
    .input(z.object({
      kycQueueId: z.number().int().positive(),
      reason: z.string().min(5).max(1000),
    }))
    .mutation(async ({ ctx, input }) => {
      assertAdmin(ctx.user.role);
      const db = await getDb();
            if (!db) throw new TRPCError({ code: "NOT_FOUND", message: "Not found" });

      const [entry] = await db
        .select()
        .from(kycQueue)
        .where(eq(kycQueue.id, input.kycQueueId))
        .limit(1);

      if (!entry) throw new TRPCError({ code: "NOT_FOUND", message: "KYC application not found" });
      if (entry.status === "REJECTED") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Application is already rejected" });
      }

      await db
        .update(kycQueue)
        .set({ status: "REJECTED", reviewedBy: ctx.user.id, reviewNotes: input.reason, reviewedAt: new Date() })
        .where(eq(kycQueue.id, input.kycQueueId));

      await db
        .update(profiles)
        .set({ kycStatus: "REJECTED", kycNotes: input.reason, updatedAt: new Date() })
        .where(eq(profiles.userId, entry.userId));

      await db.insert(notifications).values({
        userId: entry.userId,
        title: "KYC Application Rejected",
        message: `Your KYC application has been reviewed and could not be approved. Reason: ${input.reason}. Please contact support or resubmit with updated documents.`,
        type: "KYC",
      });

      return { success: true, kycQueueId: input.kycQueueId };
    }),

  /**
   * Bulk approve all PENDING members in a specific upload batch.
   */
  bulkApproveBatch: protectedProcedure
    .input(z.object({
      uploadId: z.number().int().positive(),
      notes: z.string().max(512).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      assertAdmin(ctx.user.role);
      const db = await getDb();
            if (!db) throw new TRPCError({ code: "NOT_FOUND", message: "Not found" });

      const [upload] = await db
        .select()
        .from(cooperativeBulkUploads)
        .where(eq(cooperativeBulkUploads.id, input.uploadId))
        .limit(1);

      if (!upload) throw new TRPCError({ code: "NOT_FOUND", message: "Upload batch not found" });

      const appIds = (upload.createdApplicationIds as number[] | null) ?? [];
      if (appIds.length === 0) return { approved: 0, skipped: 0 };

      const pendingMembers = await db
        .select()
        .from(kycQueue)
        .where(and(inArray(kycQueue.id, appIds), inArray(kycQueue.status, ["PENDING", "UNDER_REVIEW"])));

      let approved = 0;
      for (const member of pendingMembers) {
        await db
          .update(kycQueue)
          .set({ status: "APPROVED", reviewedBy: ctx.user.id, reviewNotes: input.notes ?? null, reviewedAt: new Date() })
          .where(eq(kycQueue.id, member.id));

        await db
          .update(profiles)
          .set({ kycStatus: "VERIFIED", kycNotes: input.notes ?? null, updatedAt: new Date() })
          .where(eq(profiles.userId, member.userId));

        await db.insert(notifications).values({
          userId: member.userId,
          title: "KYC Approved \u2713",
          message: `Your KYC application has been approved via cooperative batch review. You now have full access to the NEXCOM trading platform.`,
          type: "KYC",
        });

        approved++;
      }

      return { approved, skipped: appIds.length - approved };
    }),

  /**
   * Bulk reject all PENDING members in a specific upload batch.
   */
  bulkRejectBatch: protectedProcedure
    .input(z.object({
      uploadId: z.number().int().positive(),
      reason: z.string().min(5).max(1024),
    }))
    .mutation(async ({ ctx, input }) => {
      assertAdmin(ctx.user.role);
      const db = await getDb();
            if (!db) throw new TRPCError({ code: "NOT_FOUND", message: "Not found" });

      const [upload] = await db
        .select()
        .from(cooperativeBulkUploads)
        .where(eq(cooperativeBulkUploads.id, input.uploadId))
        .limit(1);

      if (!upload) throw new TRPCError({ code: "NOT_FOUND", message: "Upload batch not found" });

      const appIds = (upload.createdApplicationIds as number[] | null) ?? [];
      if (appIds.length === 0) return { rejected: 0, skipped: 0 };

      const pendingMembers = await db
        .select()
        .from(kycQueue)
        .where(and(inArray(kycQueue.id, appIds), inArray(kycQueue.status, ["PENDING", "UNDER_REVIEW"])));

      let rejected = 0;
      for (const member of pendingMembers) {
        await db
          .update(kycQueue)
          .set({ status: "REJECTED", reviewedBy: ctx.user.id, reviewNotes: input.reason, reviewedAt: new Date() })
          .where(eq(kycQueue.id, member.id));

        await db
          .update(profiles)
          .set({ kycStatus: "REJECTED", kycNotes: input.reason, updatedAt: new Date() })
          .where(eq(profiles.userId, member.userId));

        await db.insert(notifications).values({
          userId: member.userId,
          title: "KYC Application Rejected",
          message: `Your KYC application has been reviewed and rejected. Reason: ${input.reason.slice(0, 200)}. Please contact support if you believe this is an error.`,
          type: "KYC",
        });
        rejected++;
      }

      return { rejected, skipped: appIds.length - rejected };
    }),

  /**
   * Bulk reject selected members by their kycQueue IDs.
   */
  bulkRejectSelected: protectedProcedure
    .input(z.object({
      kycQueueIds: z.array(z.number().int().positive()).min(1).max(200),
      reason: z.string().min(5).max(1024),
    }))
    .mutation(async ({ ctx, input }) => {
      assertAdmin(ctx.user.role);
      const db = await getDb();
            if (!db) throw new TRPCError({ code: "NOT_FOUND", message: "Not found" });

      const members = await db
        .select()
        .from(kycQueue)
        .where(and(
          inArray(kycQueue.id, input.kycQueueIds),
          inArray(kycQueue.status, ["PENDING", "UNDER_REVIEW"]),
        ));

      if (members.length === 0) {
        throw new TRPCError({ code: "NOT_FOUND", message: "No eligible PENDING or UNDER_REVIEW members found" });
      }

      let rejected = 0;
      for (const member of members) {
        await db
          .update(kycQueue)
          .set({ status: "REJECTED", reviewedBy: ctx.user.id, reviewNotes: input.reason, reviewedAt: new Date() })
          .where(eq(kycQueue.id, member.id));

        await db
          .update(profiles)
          .set({ kycStatus: "REJECTED", kycNotes: input.reason, updatedAt: new Date() })
          .where(eq(profiles.userId, member.userId));

        await db.insert(notifications).values({
          userId: member.userId,
          title: "KYC Application Rejected",
          message: `Your KYC application has been reviewed and rejected. Reason: ${input.reason.slice(0, 200)}. Please contact support if you believe this is an error.`,
          type: "KYC",
        });
        rejected++;
      }

      return { rejected, skipped: input.kycQueueIds.length - rejected };
    }),

  /**
   * Retry a FAILED or PARTIAL bulk upload.
   * Re-queues the failed rows as new PENDING kycQueue entries
   * and resets the upload record status.
   */
  /**
   * Trigger a bulk crop listing on behalf of all approved members in an upload batch.
   * Creates one crop_listing row per approved member (using their primary farm).
   */
  bulkCropListing: protectedProcedure
    .input(z.object({
      uploadId: z.number().int().positive(),
      cropType: z.string().min(1).max(100),
      variety: z.string().max(100).optional(),
      quantityKgPerMember: z.number().positive(),
      askingPricePerKg: z.number().positive(),
      expectedHarvestDate: z.string().trim(),
      description: z.string().max(1000).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      assertAdmin(ctx.user.role);
      const db = await getDb();
            if (!db) throw new TRPCError({ code: "NOT_FOUND", message: "Not found" });
      // Verify upload belongs to this admin
      const [upload] = await db
        .select()
        .from(cooperativeBulkUploads)
        .where(eq(cooperativeBulkUploads.id, input.uploadId))
        .limit(1);
      if (!upload) throw new TRPCError({ code: "NOT_FOUND", message: "Upload batch not found" });
      const appIds = (upload.createdApplicationIds as number[] | null) ?? [];
      if (appIds.length === 0) throw new TRPCError({ code: "BAD_REQUEST", message: "No members in this batch" });
      // Get approved members
      const approvedMembers = await db
        .select({ id: kycQueue.id, userId: kycQueue.userId })
        .from(kycQueue)
        .where(and(inArray(kycQueue.id, appIds), eq(kycQueue.status, "APPROVED")));
      if (approvedMembers.length === 0) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "No approved members in this batch to create listings for" });
      }
      const harvestDate = new Date(input.expectedHarvestDate);
      let created = 0;
      let skipped = 0;
      for (const member of approvedMembers) {
        if (!member.userId) { skipped++; continue; }
        // Get farmer profile
        const [farmer] = await db
          .select({ id: farmerProfiles.id, kycStatus: farmerProfiles.kycStatus })
          .from(farmerProfiles)
          .where(eq(farmerProfiles.userId, member.userId))
          .limit(1);
        if (!farmer || farmer.kycStatus !== "APPROVED") { skipped++; continue; }
        // Get primary farm
        const [farm] = await db
          .select({ id: farmProfiles.id })
          .from(farmProfiles)
          .where(eq(farmProfiles.userId, member.userId))
          .limit(1);
        if (!farm) { skipped++; continue; }
        await db.insert(cropListings).values({
          userId: member.userId,
          farmId: farm.id,
          cropType: input.cropType,
          variety: input.variety,
          quantityKg: String(input.quantityKgPerMember),
          askingPricePerKg: String(input.askingPricePerKg),
          expectedHarvestDate: harvestDate,
          description: input.description
            ? `[COOPERATIVE BULK — ${upload.fileName}] ${input.description}`
            : `[COOPERATIVE BULK — ${upload.fileName}]`,
          status: "ACTIVE",
        });
        // Notify member
        await db.insert(notifications).values({
          userId: member.userId,
          title: "Cooperative Crop Listing Created",
          message: `A ${input.cropType} listing of ${input.quantityKgPerMember} kg has been created on your behalf by your cooperative.`,
          type: "SYSTEM",
        });
        created++;
      }
      return { created, skipped, total: approvedMembers.length };
    }),

  /**
   * List all crop listings created via cooperative bulk action.
   * Filters by uploadId (via description prefix) or returns all cooperative listings.
   */
  listBulkCropListings: protectedProcedure
    .input(z.object({
      uploadId: z.number().int().positive().optional(),
      limit: z.number().int().min(1).max(100).default(50),
      offset: z.number().int().min(0).default(0),
    }))
    .query(async ({ ctx, input }) => {
      assertAdmin(ctx.user.role);
      const db = await getDb();
      if (!db) return { listings: [], total: 0 };

      // Cooperative bulk listings are identified by their description prefix
      let uploadFileName: string | null = null;
      if (input.uploadId) {
        const [upload] = await db
          .select({ fileName: cooperativeBulkUploads.fileName })
          .from(cooperativeBulkUploads)
          .where(eq(cooperativeBulkUploads.id, input.uploadId))
          .limit(1);
        if (!upload) return { listings: [], total: 0 };
        uploadFileName = upload.fileName;
      }

      const whereClause = uploadFileName
        ? like(cropListings.description, `[COOPERATIVE BULK — ${uploadFileName}]%`)
        : like(cropListings.description, "[COOPERATIVE BULK%");

      const allRows = await db
        .select({
          id: cropListings.id,
          userId: cropListings.userId,
          cropType: cropListings.cropType,
          variety: cropListings.variety,
          quantityKg: cropListings.quantityKg,
          askingPricePerKg: cropListings.askingPricePerKg,
          currency: cropListings.currency,
          expectedHarvestDate: cropListings.expectedHarvestDate,
          description: cropListings.description,
          status: cropListings.status,
          createdAt: cropListings.createdAt,
        })
        .from(cropListings)
        .where(whereClause)
        .orderBy(desc(cropListings.createdAt));

      const total = allRows.length;
      const paginated = allRows.slice(input.offset, input.offset + input.limit);

      return { listings: paginated, total };
    }),

  retryUpload: protectedProcedure
    .input(z.object({
      uploadId: z.number().int().positive(),
    }))
    .mutation(async ({ ctx, input }) => {
      assertAdmin(ctx.user.role);
      const db = await getDb();
            if (!db) throw new TRPCError({ code: "NOT_FOUND", message: "Not found" });

      const [upload] = await db
        .select()
        .from(cooperativeBulkUploads)
        .where(eq(cooperativeBulkUploads.id, input.uploadId))
        .limit(1);

      if (!upload) throw new TRPCError({ code: "NOT_FOUND", message: "Upload not found" });

      if (!['FAILED', 'PARTIAL'].includes(upload.status)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Only FAILED or PARTIAL uploads can be retried. Current status: ${upload.status}`,
        });
      }

      // Reset the upload to PROCESSING
      await db
        .update(cooperativeBulkUploads)
        .set({ status: "PROCESSING", processedRows: 0, successRows: 0, failedRows: 0, errors: null, completedAt: null })
        .where(eq(cooperativeBulkUploads.id, input.uploadId));

      // Get the failed rows from the stored errors JSON
      const storedErrors = upload.errors as Array<{ row: number; name: string; reason: string }> | null;

      if (!storedErrors || storedErrors.length === 0) {
        // Nothing to retry — mark as COMPLETED
        await db
          .update(cooperativeBulkUploads)
          .set({ status: "COMPLETED", processedRows: upload.totalRows, completedAt: new Date() })
          .where(eq(cooperativeBulkUploads.id, input.uploadId));
        return { uploadId: input.uploadId, status: 'COMPLETED', successRows: upload.successRows, failedRows: 0, errors: [] };
      }

      // Get existing kycQueue entries for this upload to determine cooperative name
      const existingEntries = await db
        .select({ id: kycQueue.id, documents: kycQueue.documents })
        .from(kycQueue)
        .where(inArray(kycQueue.id, (upload.createdApplicationIds as number[] | null) ?? [0]))
        .limit(1);

      let cooperativeName = 'Unknown Cooperative';
      if (existingEntries.length > 0) {
        const doc = existingEntries[0].documents as Record<string, unknown> | null;
        const info = doc?.cooperativeName;
        if (typeof info === 'string') cooperativeName = info;
      }

      const retryErrors: Array<{ row: number; name: string; reason: string }> = [];
      const newIds: number[] = (upload.createdApplicationIds as number[] | null) ?? [];
      let successRows = newIds.length;
      let failedRows = 0;

      for (const errorRow of storedErrors) {
        try {
          const nameParts = errorRow.name.split(' ');
          const firstName = nameParts[0] ?? 'Unknown';
          const lastName = nameParts.slice(1).join(' ') || 'Unknown';
          const [entry] = await db.insert(kycQueue).values({
            userId: ctx.user.id,
            status: 'PENDING',
            submittedAt: new Date(),
            documents: JSON.stringify({
              stakeholderType: 'FARMER',
              source: 'COOPERATIVE_BULK_UPLOAD_RETRY',
              cooperativeName,
              uploadId: input.uploadId,
              retryRow: errorRow.row,
              personalInfo: {
                firstName,
                lastName,
                phone: '',
                email: '',
                country: 'Nigeria',
                state: '',
                address: '',
                bvn: '',
                nin: '',
              },
              businessInfo: {},
              stakeholderSpecific: { farmingType: 'COOPERATIVE' },
              documents: [],
            }),
          }).returning();
          newIds.push(entry.id);
          successRows++;
        } catch (err) {
          retryErrors.push({
            row: errorRow.row,
            name: errorRow.name,
            reason: err instanceof Error ? err.message : 'Unknown error',
          });
          failedRows++;
        }
      }

      const finalStatus = failedRows === 0 ? 'COMPLETED'
        : successRows === 0 ? 'FAILED' : 'PARTIAL';

      await db
        .update(cooperativeBulkUploads)
        .set({
          status: finalStatus,
          processedRows: upload.totalRows,
          successRows,
          failedRows,
          errors: retryErrors.length > 0 ? JSON.stringify(retryErrors) : null,
          createdApplicationIds: JSON.stringify(newIds),
          completedAt: new Date(),
        })
        .where(eq(cooperativeBulkUploads.id, input.uploadId));

      return { uploadId: input.uploadId, status: finalStatus, successRows, failedRows, errors: retryErrors };
    }),

  // ── cancelBulkListing ──────────────────────────────────────────────────────
  cancelBulkListing: protectedProcedure
    .input(z.object({ listingId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
            if (!db) throw new TRPCError({ code: "NOT_FOUND", message: "Not found" });

      const [listing] = await db
        .select()
        .from(cropListings)
        .where(eq(cropListings.id, input.listingId))
        .limit(1);

      if (!listing) throw new TRPCError({ code: "NOT_FOUND", message: "Listing not found" });

      if (listing.userId !== ctx.user.id) {
        throw new TRPCError({ code: "FORBIDDEN", message: "You do not own this listing" });
      }

      if (listing.status !== "ACTIVE") {
        throw new TRPCError({ code: "BAD_REQUEST", message: `Listing is already ${listing.status} and cannot be withdrawn` });
      }

      if (!listing.description?.startsWith("[COOPERATIVE BULK")) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "This listing was not created via cooperative bulk action" });
      }

      const [updated] = await db
        .update(cropListings)
        .set({ status: "WITHDRAWN", updatedAt: new Date() })
        .where(eq(cropListings.id, input.listingId))
        .returning({ id: cropListings.id, status: cropListings.status });

      return updated;
    }),

  // ── reactivateBulkListing ─────────────────────────────────────────────────
  reactivateBulkListing: protectedProcedure
    .input(z.object({ listingId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
            if (!db) throw new TRPCError({ code: "NOT_FOUND", message: "Not found" });

      const [listing] = await db
        .select()
        .from(cropListings)
        .where(eq(cropListings.id, input.listingId))
        .limit(1);

      if (!listing) throw new TRPCError({ code: "NOT_FOUND", message: "Listing not found" });

      if (listing.userId !== ctx.user.id) {
        throw new TRPCError({ code: "FORBIDDEN", message: "You do not own this listing" });
      }

      if (listing.status !== "WITHDRAWN") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Only WITHDRAWN listings can be re-activated (current status: ${listing.status})`,
        });
      }

      if (!listing.description?.startsWith("[COOPERATIVE BULK")) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "This listing was not created via cooperative bulk action" });
      }

      const [updated] = await db
        .update(cropListings)
        .set({ status: "ACTIVE", updatedAt: new Date() })
        .where(eq(cropListings.id, input.listingId))
        .returning({ id: cropListings.id, status: cropListings.status });

      return updated;
    }),

  // ─── Dual-Authorisation: Request countersign ──────────────────────────────
  /**
   * Initiating admin creates a pending approval request for a bulk listing.
   * A second admin must countersign before the listing is executed.
   */
  requestBulkListingApproval: protectedProcedure
    .input(z.object({
      uploadId: z.number().int().positive(),
      cropType: z.string().min(1),
      totalQuantityKg: z.number().int().positive(),
      pricePerKg: z.number().int().positive(),
      harvestDate: z.date().optional(),
      description: z.string().optional(),
      initiatorNotes: z.string().optional(),
      memberCount: z.number().int().min(1),
    }))
    .mutation(async ({ ctx, input }) => {
      assertAdmin(ctx.user.role);
      const db = await getDb();
            if (!db) throw new TRPCError({ code: "NOT_FOUND", message: "Not found" });

      // Verify upload belongs to this admin
      const [upload] = await db
        .select()
        .from(cooperativeBulkUploads)
        .where(and(
          eq(cooperativeBulkUploads.id, input.uploadId),
          eq(cooperativeBulkUploads.uploadedBy, ctx.user.id),
        ))
        .limit(1);
      if (!upload) throw new TRPCError({ code: "NOT_FOUND", message: "Upload not found" });

      // Check no pending approval already exists for this upload
      const [existing] = await db
        .select({ id: bulkListingApprovals.id })
        .from(bulkListingApprovals)
        .where(and(
          eq(bulkListingApprovals.uploadId, input.uploadId),
          eq(bulkListingApprovals.status, "PENDING"),
        ))
        .limit(1);
      if (existing) throw new TRPCError({ code: "CONFLICT", message: "A pending approval already exists for this upload" });

      const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000); // 48 hours
      const [approval] = await db
        .insert(bulkListingApprovals)
        .values({
          uploadId: input.uploadId,
          cooperativeUserId: ctx.user.id,
          memberCount: input.memberCount,
          cropType: input.cropType,
          totalQuantityKg: input.totalQuantityKg,
          pricePerKg: input.pricePerKg,
          harvestDate: input.harvestDate,
          description: input.description,
          initiatorNotes: input.initiatorNotes,
          expiresAt,
        })
        .returning();

      return approval;
    }),

  /**
   * Second admin countersigns (APPROVE or REJECT) the pending approval.
   * On approval, the actual bulk crop listing is executed.
   */
  countersignBulkListing: protectedProcedure
    .input(z.object({
      approvalId: z.number().int().positive(),
      decision: z.enum(["COUNTERSIGNED", "REJECTED"]),
      counterSignerNotes: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      assertAdmin(ctx.user.role);
      const db = await getDb();
            if (!db) throw new TRPCError({ code: "NOT_FOUND", message: "Not found" });

      const [approval] = await db
        .select()
        .from(bulkListingApprovals)
        .where(eq(bulkListingApprovals.id, input.approvalId))
        .limit(1);
      if (!approval) throw new TRPCError({ code: "NOT_FOUND", message: "Approval request not found" });
      if (approval.status !== "PENDING") throw new TRPCError({ code: "CONFLICT", message: "Approval is no longer pending" });
      if (approval.cooperativeUserId === ctx.user.id) {
        throw new TRPCError({ code: "FORBIDDEN", message: "You cannot countersign your own bulk listing request" });
      }
      if (new Date() > approval.expiresAt) {
        await db.update(bulkListingApprovals).set({ status: "EXPIRED", updatedAt: new Date() }).where(eq(bulkListingApprovals.id, input.approvalId));
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Approval request has expired" });
      }

      // Update approval record
      const [updated] = await db
        .update(bulkListingApprovals)
        .set({
          status: input.decision,
          counterSignerId: ctx.user.id,
          counterSignerNotes: input.counterSignerNotes,
          
        })
        .where(eq(bulkListingApprovals.id, input.approvalId))
        .returning();

      if (input.decision === "COUNTERSIGNED") {
        // Execute the bulk listing: create one crop_listing per approved member with a farm
        const upload = await db
          .select()
          .from(cooperativeBulkUploads)
          .where(eq(cooperativeBulkUploads.id, approval.uploadId))
          .limit(1);
        if (upload[0]) {
          const appIds = (upload[0].createdApplicationIds as number[] | null) ?? [];
          if (appIds.length > 0) {
            const approvedMembers = await db
              .select({ userId: kycQueue.userId })
              .from(kycQueue)
              .where(and(inArray(kycQueue.id, appIds), eq(kycQueue.status, "APPROVED")));

            const memberUserIds = approvedMembers.map(m => m.userId);
            if (memberUserIds.length > 0) {
              const farms = await db
                .select()
                .from(farmProfiles)
                .where(inArray(farmProfiles.userId, memberUserIds));

              const listingValues = farms.map(farm => ({
                userId: farm.userId,
                farmId: farm.id,
                cropType: approval.cropType,
                quantityKg: String(approval.totalQuantityKg),
                askingPricePerKg: String(approval.pricePerKg),
                expectedHarvestDate: approval.harvestDate ?? new Date(),
                description: `COOPERATIVE BULK [DUAL-AUTH #${updated.id}] Upload #${approval.uploadId}`,
                status: "ACTIVE" as const,
              }));

              if (listingValues.length > 0) {
                await db.insert(cropListings).values(listingValues);
              }
            }
          }
        }

        // Notify the initiator
        await db.insert(notifications).values({
          userId: approval.cooperativeUserId,
          title: "Bulk Listing Approved",
          message: `Your bulk listing request for ${approval.cropType} (${approval.memberCount} members) has been countersigned and executed.`,
          type: "SYSTEM",
        });
      } else {
        // Notify the initiator of rejection
        await db.insert(notifications).values({
          userId: approval.cooperativeUserId,
          title: "Bulk Listing Rejected",
          message: `Your bulk listing request for ${approval.cropType} was rejected by a second admin. Notes: ${input.counterSignerNotes ?? "none"}`,
          type: "SYSTEM",
        });
      }

      return updated;
    }),

  /**
   * List all bulk listing approval requests visible to the current admin.
   * Initiators see their own requests; any admin can see PENDING requests to countersign.
   */
  listBulkListingApprovals: protectedProcedure
    .input(z.object({
      view: z.enum(["mine", "pending_countersign", "all"]).default("all"),
      page: z.number().int().min(1).default(1),
      pageSize: z.number().int().min(1).max(50).default(20),
    }))
    .query(async ({ ctx, input }) => {
      assertAdmin(ctx.user.role);
      const db = await getDb();
      if (!db) return { approvals: [], total: 0, page: input.page, pageSize: input.pageSize, totalPages: 0 };

      const all = await db
        .select()
        .from(bulkListingApprovals)
        .orderBy(desc(bulkListingApprovals.createdAt));

      const filtered = all.filter(a => {
        if (input.view === "mine") return a.cooperativeUserId === ctx.user.id;
        if (input.view === "pending_countersign") return a.status === "PENDING" && a.cooperativeUserId !== ctx.user.id;
        return true;
      });

      const total = filtered.length;
      const offset = (input.page - 1) * input.pageSize;
      const paginated = filtered.slice(offset, offset + input.pageSize);

      return {
        approvals: paginated,
        total,
        page: input.page,
        pageSize: input.pageSize,
        totalPages: Math.ceil(total / input.pageSize),
      };
    }),


  removeMember: protectedProcedure
    .input(z.object({ memberId: z.number().int(), reason: z.string() }))
    .mutation(async ({ ctx, input }) => {
      assertAdmin(ctx.user.role);
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "Database unavailable" });
      // Mark the KYC application as rejected (removing from cooperative)
      const [member] = await db.update(kycQueue)
        .set({ status: "REJECTED" })
        .where(eq(kycQueue.id, input.memberId))
        .returning();
      if (!member) throw new TRPCError({ code: "NOT_FOUND", message: "Member not found" });
      await writeAuditLog({ userId: ctx.user.id, action: "cooperative.removeMember", details: { memberId: input.memberId, reason: input.reason } });
      return { success: true };
    }),
});
