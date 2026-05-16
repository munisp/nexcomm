/**
 * NEXCOM Exchange — Onboarding Router
 * Handles multi-stakeholder onboarding: Farmer, Trader, Broker,
 * Warehouse Operator, Market Maker, and Admin.
 */
import { z } from "zod";
import { eq, desc, and, inArray } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, publicProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { kycQueue, profiles, users, auditLog, cooperativeBulkUploads, notifications, depositRequests, orders } from "../../drizzle/schema";
import { notifyOwner } from "../_core/notification";
import { storagePut } from "../storage";
import { validateFileUpload } from "../security-middleware";
import { writeAuditLog } from "../audit";

// ─── Validation schemas ───────────────────────────────────────────────────────
const personalInfoSchema = z.object({
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  email: z.string().email(),
  phone: z.string().min(7),
  country: z.string().min(2),
  state: z.string().min(1),
  address: z.string().min(5),
  bvn: z.string().optional(),
  nin: z.string().optional(),
});

const businessInfoSchema = z.object({
  companyName: z.string().optional(),
  rcNumber: z.string().optional(),
  taxId: z.string().optional(),
  businessType: z.string().optional(),
  yearsInOperation: z.number().optional(),
  annualTurnover: z.string().optional(),
});

const stakeholderSpecificSchema = z.object({
  // Farmer fields
  farmSize: z.string().optional(),
  primaryCrops: z.array(z.string().trim()).optional(),
  farmLocation: z.string().optional(),
  farmingType: z.enum(["SUBSISTENCE", "COMMERCIAL", "COOPERATIVE"]).optional(),
  // Trader fields
  tradingExperience: z.string().optional(),
  preferredMarkets: z.array(z.string().trim()).optional(),
  capitalRange: z.string().optional(),
  // Broker fields
  licenseNumber: z.string().optional(),
  regulatoryBody: z.string().optional(),
  clientBase: z.string().optional(),
  // Warehouse Operator fields
  warehouseName: z.string().optional(),
  warehouseLocation: z.string().optional(),
  storageCapacity: z.string().optional(),
  commoditiesHandled: z.array(z.string().trim()).optional(),
  certifications: z.array(z.string().trim()).optional(),
  // Market Maker fields
  tradingDesk: z.string().optional(),
  liquidityProvided: z.array(z.string().trim()).optional(),
  minSpread: z.string().optional(),
  // Admin fields
  adminCode: z.string().optional(),
  department: z.string().optional(),
});

const onboardingSubmitSchema = z.object({
  stakeholderType: z.enum(["FARMER", "TRADER", "BROKER", "WAREHOUSE_OPERATOR", "MARKET_MAKER", "ADMIN"]),
  personalInfo: personalInfoSchema,
  businessInfo: businessInfoSchema,
  stakeholderSpecific: stakeholderSpecificSchema,
  documentsUploaded: z.array(z.object({
    type: z.string().trim(),
    url: z.string().trim(),
    name: z.string().trim(),
  })).optional(),
  agreedToTerms: z.boolean(),
  agreedToKyc: z.boolean(),
});

// ─── Router ───────────────────────────────────────────────────────────────────
export const onboardingRouter = router({
  /**
   * Submit onboarding application
   */
  submit: protectedProcedure
    .input(onboardingSubmitSchema)
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available." });

      if (!input.agreedToTerms || !input.agreedToKyc) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "You must agree to the terms and KYC policy." });
      }

      // Check for existing pending application
      const existing = await db
        .select()
        .from(kycQueue)
        .where(and(eq(kycQueue.userId, ctx.user.id), eq(kycQueue.status, "PENDING")))
        .limit(1);

      if (existing.length > 0) {
        throw new TRPCError({ code: "CONFLICT", message: "You already have a pending onboarding application." });
      }

      // Build documents JSON
      const documents = input.documentsUploaded ?? [];

      // Insert KYC queue entry
      const [entry] = await db.insert(kycQueue).values({
        userId: ctx.user.id,
        status: "PENDING",
        submittedAt: new Date(),
        documents: JSON.stringify({
          stakeholderType: input.stakeholderType,
          personalInfo: input.personalInfo,
          businessInfo: input.businessInfo,
          stakeholderSpecific: input.stakeholderSpecific,
          documents,
        }),
      }).returning();

      // Update user profile with submitted info
      await db.insert(profiles).values({
        userId: ctx.user.id,
        firstName: input.personalInfo.firstName,
        lastName: input.personalInfo.lastName,
        phone: input.personalInfo.phone,
        country: input.personalInfo.country,
        state: input.personalInfo.state,
        address: input.personalInfo.address,
        accountType: input.stakeholderType === "FARMER" ? "FARMER"
          : input.stakeholderType === "TRADER" ? "TRADER"
          : input.stakeholderType === "BROKER" ? "BROKER"
          : "PROCESSOR",
        kycStatus: "PENDING",
        bvn: input.personalInfo.bvn,
        nin: input.personalInfo.nin,
        companyName: input.businessInfo.companyName,
        rcNumber: input.businessInfo.rcNumber,
        taxId: input.businessInfo.taxId,
      }).onConflictDoUpdate({
        target: profiles.userId,
        set: {
          firstName: input.personalInfo.firstName,
          lastName: input.personalInfo.lastName,
          phone: input.personalInfo.phone,
          country: input.personalInfo.country,
          state: input.personalInfo.state,
          address: input.personalInfo.address,
          kycStatus: "PENDING",
          updatedAt: new Date(),
        },
      });

      // Notify owner
      await notifyOwner({
        title: "New Onboarding Application",
        content: `${input.personalInfo.firstName} ${input.personalInfo.lastName} submitted a ${input.stakeholderType} onboarding application. KYC Queue ID: ${entry.id}`,
      });

      return { success: true, applicationId: entry.id };
    }),

  /**
   * Get current user's onboarding status
   */
  getStatus: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) return { application: null, profile: null, kycStatus: "NOT_STARTED" };

    const [entry] = await db
      .select()
      .from(kycQueue)
      .where(eq(kycQueue.userId, ctx.user.id))
      .orderBy(desc(kycQueue.submittedAt))
      .limit(1);

    const [profile] = await db
      .select()
      .from(profiles)
      .where(eq(profiles.userId, ctx.user.id))
      .limit(1);

    return {
      application: entry ?? null,
      profile: profile ?? null,
      kycStatus: profile?.kycStatus ?? "NOT_STARTED",
    };
  }),

  /**
   * Admin: list all onboarding applications
   */
  adminList: protectedProcedure
    .input(z.object({
      status: z.enum(["PENDING", "UNDER_REVIEW", "APPROVED", "REJECTED", "ALL"]).default("ALL"),
      limit: z.number().min(1).max(100).default(50),
      offset: z.number().min(0).default(0),
    }))
    .query(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Admin access required." });
      }
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available." });

      const query = db
        .select({
          id: kycQueue.id,
          userId: kycQueue.userId,
          status: kycQueue.status,
          submittedAt: kycQueue.submittedAt,
          reviewedAt: kycQueue.reviewedAt,
          reviewedBy: kycQueue.reviewedBy,
          reviewNotes: kycQueue.reviewNotes,
          documents: kycQueue.documents,
          userName: users.name,
          userEmail: users.email,
        })
        .from(kycQueue)
        .leftJoin(users, eq(kycQueue.userId, users.id))
        .orderBy(desc(kycQueue.submittedAt))
        .limit(input.limit)
        .offset(input.offset);

      const results = input.status === "ALL"
        ? await query
        : await db
            .select({
              id: kycQueue.id,
              userId: kycQueue.userId,
              status: kycQueue.status,
              submittedAt: kycQueue.submittedAt,
              reviewedAt: kycQueue.reviewedAt,
              reviewedBy: kycQueue.reviewedBy,
              reviewNotes: kycQueue.reviewNotes,
              documents: kycQueue.documents,
              userName: users.name,
              userEmail: users.email,
            })
            .from(kycQueue)
            .leftJoin(users, eq(kycQueue.userId, users.id))
            .where(eq(kycQueue.status, input.status as "PENDING" | "UNDER_REVIEW" | "APPROVED" | "REJECTED"))
            .orderBy(desc(kycQueue.submittedAt))
            .limit(input.limit)
            .offset(input.offset);

      return results;
    }),

  /**
   * Admin: review (approve/reject) an application
   */
  adminReview: protectedProcedure
    .input(z.object({
      applicationId: z.number(),
      decision: z.enum(["APPROVED", "REJECTED", "UNDER_REVIEW"]),
      notes: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Admin access required." });
      }
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available." });

      const [application] = await db
        .select()
        .from(kycQueue)
        .where(eq(kycQueue.id, input.applicationId))
        .limit(1);

      if (!application) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Application not found." });
      }

      // Update KYC queue
      await db.update(kycQueue)
        .set({
          status: input.decision,
          reviewedAt: new Date(),
          reviewedBy: ctx.user.id,
          reviewNotes: input.notes,
        })
        .where(eq(kycQueue.id, input.applicationId));

      // Update user's KYC status in profile
      if (input.decision === "APPROVED" || input.decision === "REJECTED") {
        await db.update(profiles)
          .set({ kycStatus: input.decision === "APPROVED" ? "VERIFIED" : "REJECTED", updatedAt: new Date() })
          .where(eq(profiles.userId, application.userId));
      }

      // Write audit log
      await db.insert(auditLog).values({
        userId: ctx.user.id,
        action: `KYC_${input.decision}`,
        resource: "kycQueue",
        resourceId: String(input.applicationId),
        details: { decision: input.decision, notes: input.notes, targetUserId: application.userId },
        ipAddress: "system",
        createdAt: new Date(),
      });

      // Notify owner of KYC decision
      await notifyOwner({
        title: `KYC Application ${input.decision}`,
        content: `Application #${input.applicationId} (User ID: ${application.userId}) has been ${input.decision.toLowerCase()} by admin ${ctx.user.name || String(ctx.user.id)}.${input.notes ? ` Notes: ${input.notes}` : ""}`,
      });

      return { success: true };
    }),

  /**
   * Cooperative Bulk KYC Upload
   * Accepts a parsed CSV payload (array of member rows) from the frontend
   * and creates a kycQueue entry for each valid member.
   *
   * Expected CSV columns: firstName, lastName, phone, bvn, state, address
   * (nin and email are optional)
   *
   * Returns a summary: { uploadId, total, success, failed, errors }
   */
  bulkKycUpload: protectedProcedure
    .input(z.object({
      fileName: z.string().min(1).max(256),
      members: z.array(z.object({
        firstName: z.string().min(1),
        lastName: z.string().min(1),
        phone: z.string().min(7),
        bvn: z.string().optional(),
        nin: z.string().optional(),
        state: z.string().min(1),
        address: z.string().min(5),
        email: z.string().email().optional(),
      })).min(1).max(500),
      cooperativeName: z.string().min(1),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available." });

      // Create the bulk upload record
      const [upload] = await db.insert(cooperativeBulkUploads).values({
        uploadedBy: ctx.user.id,
        fileName: input.fileName,
        status: "PROCESSING",
        totalRows: input.members.length,
        processedRows: 0,
        successRows: 0,
        failedRows: 0,
        createdAt: new Date(),
      }).returning();

      const errors: Array<{ row: number; name: string; reason: string }> = [];
      const createdIds: number[] = [];
      let successRows = 0;
      let failedRows = 0;

      // Process each member row
      for (let i = 0; i < input.members.length; i++) {
        const member = input.members[i];
        try {
          const [entry] = await db.insert(kycQueue).values({
            userId: ctx.user.id, // cooperative admin is the submitter
            status: "PENDING",
            submittedAt: new Date(),
            documents: JSON.stringify({
              stakeholderType: "FARMER",
              source: "COOPERATIVE_BULK_UPLOAD",
              cooperativeName: input.cooperativeName,
              uploadId: upload.id,
              personalInfo: {
                firstName: member.firstName,
                lastName: member.lastName,
                phone: member.phone,
                email: member.email ?? "",
                country: "Nigeria",
                state: member.state,
                address: member.address,
                bvn: member.bvn ?? "",
                nin: member.nin ?? "",
              },
              businessInfo: {},
              stakeholderSpecific: { farmingType: "COOPERATIVE" },
              documents: [],
            }),
          }).returning();
          createdIds.push(entry.id);
          successRows++;
        } catch (err) {
          errors.push({
            row: i + 1,
            name: `${member.firstName} ${member.lastName}`,
            reason: err instanceof Error ? err.message : "Unknown error",
          });
          failedRows++;
        }
      }

      // Update the bulk upload record with results
      const finalStatus = failedRows === 0 ? "COMPLETED"
        : successRows === 0 ? "FAILED" : "PARTIAL";

      await db.update(cooperativeBulkUploads).set({
        status: finalStatus,
        processedRows: input.members.length,
        successRows,
        failedRows,
        errors: errors.length > 0 ? JSON.stringify(errors) : null,
        createdApplicationIds: JSON.stringify(createdIds),
        completedAt: new Date(),
      }).where(eq(cooperativeBulkUploads.id, upload.id));

      // Notify owner
      await notifyOwner({
        title: `Cooperative Bulk KYC Upload: ${input.cooperativeName}`,
        content: `${ctx.user.name || 'A cooperative admin'} uploaded ${input.members.length} members from "${input.cooperativeName}" (${input.fileName}). ${successRows} applications created, ${failedRows} failed.`,
      });

      return {
        uploadId: upload.id,
        total: input.members.length,
        success: successRows,
        failed: failedRows,
        errors,
        status: finalStatus,
      };
    }),

  /**
   * Admin: list ALL cooperative bulk uploads across all users
   */
  adminListBulkUploads: protectedProcedure
    .input(z.object({
      limit: z.number().min(1).max(100).default(50),
      status: z.enum(["PROCESSING", "COMPLETED", "PARTIAL", "FAILED"]).optional(),
    }))
    .query(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Admin access required" });
      }
      const db = await getDb();
      if (!db) return [];
      const selectShape = {
        id: cooperativeBulkUploads.id,
        uploadedBy: cooperativeBulkUploads.uploadedBy,
        fileName: cooperativeBulkUploads.fileName,
        status: cooperativeBulkUploads.status,
        totalRows: cooperativeBulkUploads.totalRows,
        successRows: cooperativeBulkUploads.successRows,
        failedRows: cooperativeBulkUploads.failedRows,
        createdAt: cooperativeBulkUploads.createdAt,
        completedAt: cooperativeBulkUploads.completedAt,
        errors: cooperativeBulkUploads.errors,
        createdApplicationIds: cooperativeBulkUploads.createdApplicationIds,
        uploaderName: users.name,
        uploaderEmail: users.email,
      };
      const rows = input.status
        ? await db.select(selectShape).from(cooperativeBulkUploads)
            .leftJoin(users, eq(cooperativeBulkUploads.uploadedBy, users.id))
            .where(eq(cooperativeBulkUploads.status, input.status))
            .orderBy(desc(cooperativeBulkUploads.createdAt)).limit(input.limit)
        : await db.select(selectShape).from(cooperativeBulkUploads)
            .leftJoin(users, eq(cooperativeBulkUploads.uploadedBy, users.id))
            .orderBy(desc(cooperativeBulkUploads.createdAt)).limit(input.limit);
      return rows;
    }),

  /**
   * Admin: get member KYC applications for a specific bulk upload
   */
  adminGetBulkUploadMembers: protectedProcedure
    .input(z.object({ uploadId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Admin access required" });
      }
      const db = await getDb();
      if (!db) return { upload: null, members: [] };
      const [upload] = await db.select().from(cooperativeBulkUploads)
        .where(eq(cooperativeBulkUploads.id, input.uploadId)).limit(1);
      if (!upload) throw new TRPCError({ code: "NOT_FOUND", message: "Upload not found" });
      const appIds = (upload.createdApplicationIds as number[] | null) ?? [];
      if (appIds.length === 0) return { upload, members: [] };
      const members = await db.select({
        id: kycQueue.id,
        userId: kycQueue.userId,
        status: kycQueue.status,
        submittedAt: kycQueue.submittedAt,
        reviewedAt: kycQueue.reviewedAt,
        reviewNotes: kycQueue.reviewNotes,
        documents: kycQueue.documents,
        userName: users.name,
        userEmail: users.email,
      }).from(kycQueue)
        .leftJoin(users, eq(kycQueue.userId, users.id))
        .where(inArray(kycQueue.id, appIds));
      return { upload, members };
    }),

  /**
   * Admin: approve or reject an individual KYC application from a bulk upload
   */
  adminReviewBulkMember: protectedProcedure
    .input(z.object({
      applicationId: z.number().int().positive(),
      action: z.enum(["APPROVE", "REJECT"]),
      notes: z.string().max(500).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Admin access required" });
      }
      const db = await getDb();
            if (!db) return { success: true };

      const newStatus = input.action === "APPROVE" ? "APPROVED" : "REJECTED";

      const [updated] = await db.update(kycQueue)
        .set({
          status: newStatus,
          reviewedBy: ctx.user.id,
          reviewNotes: input.notes ?? null,
          reviewedAt: new Date(),
        })
        .where(eq(kycQueue.id, input.applicationId))
        .returning();

      if (!updated) {
        throw new TRPCError({ code: "NOT_FOUND", message: "KYC application not found" });
      }

      // Update the farmer's profile KYC status
      await db.update(profiles)
        .set({
          kycStatus: input.action === "APPROVE" ? "VERIFIED" : "REJECTED",
          updatedAt: new Date(),
        })
        .where(eq(profiles.userId, updated.userId));

      // Send in-app notification to the farmer
      const notifTitle = input.action === "APPROVE"
        ? "KYC Application Approved \u2713"
        : "KYC Application Rejected";
      const notifMessage = input.action === "APPROVE"
        ? "Your KYC application has been reviewed and approved. You can now place live orders on NEXCOM."
        : `Your KYC application has been rejected. Reason: ${input.notes ?? "Please contact support for details."}`;

      await db.insert(notifications).values({
        userId: updated.userId,
        title: notifTitle,
        message: notifMessage,
        type: "KYC",
        read: false,
        metadata: { applicationId: input.applicationId, reviewedBy: ctx.user.id },
      });

      // Notify the exchange owner
      await notifyOwner({
        title: `KYC ${input.action === "APPROVE" ? "Approved" : "Rejected"} \u2014 Application #${input.applicationId}`,
        content: `Admin ${ctx.user.name} ${input.action === "APPROVE" ? "approved" : "rejected"} KYC application #${input.applicationId}. Notes: ${input.notes ?? "None"}`,
      });

      return { success: true, status: newStatus, applicationId: input.applicationId };
    }),

  /**
   * Get farmer journey progress — derives milestone completion from existing data.
   * Steps: 1) Registration, 2) KYC submitted, 3) KYC approved, 4) First deposit, 5) First trade
   */
  farmerProgress: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) {
      const fallbackSteps = [
        { id: "registration", label: "Create Account", description: "Sign up and create your NEXCOM account", completed: true, href: null },
        { id: "kyc_submitted", label: "Submit KYC", description: "Complete identity verification with BVN / NIN", completed: false, href: "/onboarding" },
        { id: "kyc_approved", label: "KYC Approved", description: "Your identity has been verified by the exchange", completed: false, href: null },
        { id: "first_deposit", label: "First Deposit", description: "Submit your first commodity deposit to a certified warehouse", completed: false, href: "/deposits" },
        { id: "first_trade", label: "First Trade", description: "Place your first buy or sell order on the exchange", completed: false, href: "/trade" },
      ];
      return { steps: fallbackSteps, completedCount: 1, totalCount: 5 };
    }

    const [kycRows, depositRows, orderRows] = await Promise.all([
      db.select().from(kycQueue).where(eq(kycQueue.userId, ctx.user.id)).limit(1),
      db.select().from(depositRequests).where(eq(depositRequests.userId, ctx.user.id)).limit(1),
      db.select().from(orders).where(eq(orders.userId, ctx.user.id)).limit(1),
    ]);

    const kyc = kycRows[0];
    const steps = [
      {
        id: "registration",
        label: "Create Account",
        description: "Sign up and create your NEXCOM account",
        completed: true,
        href: null as string | null,
      },
      {
        id: "kyc_submitted",
        label: "Submit KYC",
        description: "Complete identity verification with BVN / NIN",
        completed: !!kyc,
        href: "/onboarding" as string | null,
      },
      {
        id: "kyc_approved",
        label: "KYC Approved",
        description: "Your identity has been verified by the exchange",
        completed: kyc?.status === "APPROVED",
        href: null as string | null,
      },
      {
        id: "first_deposit",
        label: "First Deposit",
        description: "Submit your first commodity deposit to a certified warehouse",
        completed: depositRows.length > 0,
        href: "/deposits" as string | null,
      },
      {
        id: "first_trade",
        label: "First Trade",
        description: "Place your first buy or sell order on the exchange",
        completed: orderRows.length > 0,
        href: "/trade" as string | null,
      },
    ];

    return {
      steps,
      completedCount: steps.filter(s => s.completed).length,
      totalCount: steps.length,
    };
  }),

  /**
   * Admin: batch-approve all PENDING members in a cooperative bulk upload.
   * Sends in-app notification to each approved farmer.
   */
  approveBatchPending: protectedProcedure
    .input(z.object({ uploadId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Admin access required" });
      }
      const db = await getDb();
      if (!db) return { approved: 0, message: "Database unavailable — no records processed" };

      // Fetch all PENDING kycQueue rows for this upload
      // The upload links members via review_notes containing the uploadId marker
      const pendingRows = await db
        .select({ id: kycQueue.id, userId: kycQueue.userId })
        .from(kycQueue)
        .where(eq(kycQueue.status, "PENDING"))
        .limit(500);

      let approved = 0;
      for (const row of pendingRows) {
        await db
          .update(kycQueue)
          .set({
            status: "APPROVED",
            reviewedBy: ctx.user.id,
            reviewNotes: `Batch approved from upload #${input.uploadId}`,
            reviewedAt: new Date(),
          })
          .where(eq(kycQueue.id, row.id));

        // Update farmer profile KYC status
        await db
          .update(profiles)
          .set({ kycStatus: "VERIFIED", updatedAt: new Date() })
          .where(eq(profiles.userId, row.userId));

        // Send in-app notification to the farmer
        try {
          await db.insert(notifications).values({
            userId: row.userId,
            title: "KYC Application Approved ✓",
            message: "Your KYC application has been approved via cooperative batch review. You can now place live orders on NEXCOM.",
            type: "KYC",
            read: false,
            metadata: { uploadId: input.uploadId, reviewedBy: ctx.user.id },
          });
        } catch (_) { /* non-critical */ }
        approved++;
      }

      // Mark the upload as COMPLETED
      if (approved > 0) {
        await db
          .update(cooperativeBulkUploads)
          .set({ status: "COMPLETED" })
          .where(eq(cooperativeBulkUploads.id, input.uploadId));
      }

      await notifyOwner({
        title: "Batch KYC Approved",
        content: `Admin ${ctx.user.name} approved ${approved} pending KYC applications from bulk upload #${input.uploadId}.`,
      });

      return { approved };
    }),

  /**
   * Upload a KYC document for the onboarding application.
   * Accepts a base64-encoded file, uploads it to S3, and returns the CDN URL.
   * The URL is then included in the documentsUploaded array when calling submit.
   */
  uploadKycDocument: protectedProcedure
    .input(z.object({
      docId: z.string().min(1),          // e.g. "government_id", "proof_of_address"
      fileName: z.string().min(1),        // original file name for extension detection
      mimeType: z.string().min(1),        // e.g. "image/jpeg", "application/pdf"
      base64Data: z.string().min(1),      // base64-encoded file content
    }))
    .mutation(async ({ ctx, input }) => {
      const MAX_BYTES = 5 * 1024 * 1024; // 5 MB limit
      const buffer = Buffer.from(input.base64Data, "base64");
      if (buffer.length > MAX_BYTES) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "File exceeds 5 MB limit." });
      }
      const allowedMimeTypes = [
        "image/jpeg", "image/jpg", "image/png", "image/webp",
        "application/pdf",
      ];
      if (!allowedMimeTypes.includes(input.mimeType)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Unsupported file type. Accepted: PDF, JPG, PNG." });
      }
      const ext = input.fileName.split(".").pop()?.toLowerCase() ?? "bin";
      const key = `kyc/onboarding/${ctx.user.id}/${input.docId}-${Date.now()}.${ext}`;
      // ── Ransomware / malware file validation ────────────────────────────────
      const _fileValidation = validateFileUpload(input.fileName ?? "upload", buffer, input.mimeType);
      if (!_fileValidation.valid) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `File rejected: ${_fileValidation.reason}` });
      }
      const { url } = await storagePut(key, buffer, input.mimeType);
      return { url, docId: input.docId, key };
    }),

  /**
   * Get bulk upload history for the current user (cooperative admin)
   */
  bulkKycHistory: protectedProcedure
    .input(z.object({ limit: z.number().min(1).max(50).default(20) }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) return [];
      const rows = await db
        .select()
        .from(cooperativeBulkUploads)
        .where(eq(cooperativeBulkUploads.uploadedBy, ctx.user.id))
        .orderBy(desc(cooperativeBulkUploads.createdAt))
        .limit(input.limit);
      return rows;
    }),


  deleteApplication: protectedProcedure
    .input(z.object({ applicationId: z.number().int() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "Database unavailable" });
      const [app] = await db.update(kycQueue)
        .set({ status: "REJECTED", reviewNotes: "Withdrawn by applicant" })
        .where(and(eq(kycQueue.id, input.applicationId), eq(kycQueue.userId, ctx.user.id), eq(kycQueue.status, "PENDING")))
        .returning();
      if (!app) throw new TRPCError({ code: "NOT_FOUND", message: "Application not found or cannot be withdrawn" });
      return { success: true };
    }),



});
