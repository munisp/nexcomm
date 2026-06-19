/**
 * NEXCOM Exchange — Broker Onboarding Router
 * Handles Broker firm registration, licensing KYC, admin review, and dashboard.
 */
import { z } from "zod";
import { eq, desc, asc, sql, and, ilike } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, adminProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { notifyOwner } from "../_core/notification";
import { brokerProfiles, kycAuditLog, brokerClients, brokerCommissions, tradeFills } from "../../drizzle/schema";
import { storagePut } from "../storage";
import { validateFileUpload } from "../security-middleware";
import { writeAuditLog } from "../audit";


// ─── in-memory fallback stores (used when DB is unavailable, e.g. in tests) ─
export const _memBrokerProfiles = new Map<number, Record<string, unknown>>();
export const brokerRouter = router({
  // ── registerBroker ──────────────────────────────────────────────────────────
  registerBroker: protectedProcedure
    .input(z.object({
      firmName: z.string().min(2).max(200),
      rcNumber: z.string().optional(),
      contactPhone: z.string().min(7).max(30),
      contactEmail: z.string().email().optional(),
      firmAddress: z.string().optional(),
      state: z.string().optional(),
      yearsInOperation: z.number().int().min(0).optional(),
      clientBookSize: z.string().optional(),
      commissionRate: z.number().min(0).max(100).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
                  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable — please try again" });
      const [existing] = await db
        .select({ id: brokerProfiles.id })
        .from(brokerProfiles)
        .where(eq(brokerProfiles.userId, ctx.user.id))
        .limit(1);
      if (existing) throw new TRPCError({ code: "CONFLICT", message: "Broker profile already exists" });
      const [profile] = await db
        .insert(brokerProfiles)
        .values({
          userId: ctx.user.id,
          firmName: input.firmName,
          rcNumber: input.rcNumber,
          contactPhone: input.contactPhone,
          contactEmail: input.contactEmail,
          firmAddress: input.firmAddress,
          state: input.state,
          yearsInOperation: input.yearsInOperation,
          clientBookSize: input.clientBookSize,
          commissionRate: input.commissionRate !== undefined ? String(input.commissionRate) : undefined,
        })
        .returning();
      return profile;
    }),

  // ── getMyBrokerProfile ──────────────────────────────────────────────────────
  getMyBrokerProfile: protectedProcedure
    .query(async ({ ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable — please try again" });
      const [profile] = await db
        .select()
        .from(brokerProfiles)
        .where(eq(brokerProfiles.userId, ctx.user.id))
        .limit(1);
      return profile ?? null;
    }),

  // ── uploadKycDocument ─────────────────────────────────────────────────────
  uploadKycDocument: protectedProcedure
    .input(z.object({
      docId: z.enum(["secCertificateUrl", "cbnApprovalUrl", "cacDocUrl"]),
      fileName: z.string().min(1).max(200),
      mimeType: z.string().min(1).max(100),
      base64Data: z.string().min(1),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
            if (!db) throw new TRPCError({ code: "NOT_FOUND", message: "Not found" });
      const [profile] = await db
        .select()
        .from(brokerProfiles)
        .where(eq(brokerProfiles.userId, ctx.user.id))
        .limit(1);
      if (!profile) throw new TRPCError({ code: "NOT_FOUND", message: "Broker profile not found. Please register first." });
      const buffer = Buffer.from(input.base64Data, "base64");
      if (buffer.length > 10 * 1024 * 1024) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "File must be under 10 MB" });
      }
      const suffix = Date.now().toString(36);
      const ext = input.fileName.split(".").pop() ?? "bin";
      const fileKey = `broker-kyc/${ctx.user.id}/${input.docId}-${suffix}.${ext}`;
      // ── Ransomware / malware file validation ────────────────────────────────
      const _fileValidation = validateFileUpload(input.fileName ?? "upload", buffer, input.mimeType);
      if (!_fileValidation.valid) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `File rejected: ${_fileValidation.reason}` });
      }
      const { url } = await storagePut(fileKey, buffer, input.mimeType);
      await db
        .update(brokerProfiles)
        .set({ [input.docId]: url, updatedAt: new Date() })
        .where(eq(brokerProfiles.userId, ctx.user.id));
      return { url };
    }),

  // ── submitBrokerKYC ─────────────────────────────────────────────────────────
  submitBrokerKYC: protectedProcedure
    .input(z.object({
      secLicenseNumber: z.string().min(1),
      cbnLicenseNumber: z.string().optional(),
      regulatoryBody: z.string().min(1),
      secCertificateUrl: z.string().url(),
      cbnApprovalUrl: z.string().url().optional(),
      cacDocUrl: z.string().url().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable — please try again" });
      const [profile] = await db
        .select()
        .from(brokerProfiles)
        .where(eq(brokerProfiles.userId, ctx.user.id))
        .limit(1);
      if (!profile) throw new TRPCError({ code: "NOT_FOUND", message: "Broker profile not found. Please register first." });
      if (profile.kycStatus === "APPROVED") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "KYC already approved" });
      }
      const [updated] = await db
        .update(brokerProfiles)
        .set({
          secLicenseNumber: input.secLicenseNumber,
          cbnLicenseNumber: input.cbnLicenseNumber,
          regulatoryBody: input.regulatoryBody,
          secCertificateUrl: input.secCertificateUrl,
          cbnApprovalUrl: input.cbnApprovalUrl,
          cacDocUrl: input.cacDocUrl,
          kycStatus: "UNDER_REVIEW",
          updatedAt: new Date(),
        })
        .where(eq(brokerProfiles.userId, ctx.user.id))
        .returning();
      // Notify exchange operations team of new KYC submission
      notifyOwner({
        title: "[Broker KYC] New submission under review",
        content: `Broker profile ID ${updated.id} (user ${ctx.user.id}, ${updated.firmName}) has submitted KYC documents and is now UNDER_REVIEW. Please review at /admin/stakeholders.`,
      }).catch(e => console.warn("[brokerRouter] notifyOwner failed:", (e as Error).message));
      return { kycStatus: updated.kycStatus };
    }),

  // ── getBrokerDashboard ──────────────────────────────────────────────────────
  getBrokerDashboard: protectedProcedure
    .query(async ({ ctx }) => {
      const db = await getDb();
            if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
      const [profile] = await db
        .select()
        .from(brokerProfiles)
        .where(eq(brokerProfiles.userId, ctx.user.id))
        .limit(1);
      return {
        profile: profile ?? null,
        kycStatus: profile?.kycStatus ?? "PENDING",
        accountStatus: profile?.accountStatus ?? "INACTIVE",
        isRegistered: !!profile,
        isKycApproved: profile?.kycStatus === "APPROVED",
        isActive: profile?.accountStatus === "ACTIVE",
      };
    }),

  // ── adminReviewBrokerKYC ────────────────────────────────────────────────────
  adminReviewBrokerKYC: adminProcedure
    .input(z.object({
      brokerId: z.number().int().positive(),
      decision: z.enum(["APPROVED", "REJECTED"]),
      notes: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable — please try again" });
      const [profile] = await db
        .select()
        .from(brokerProfiles)
        .where(eq(brokerProfiles.id, input.brokerId))
        .limit(1);
      if (!profile) throw new TRPCError({ code: "NOT_FOUND", message: "Broker profile not found" });
      if (!["UNDER_REVIEW", "SUBMITTED"].includes(profile.kycStatus)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Broker KYC is not under review" });
      }
      const [updated] = await db
        .update(brokerProfiles)
        .set({
          kycStatus: input.decision,
          kycNotes: input.notes,
          accountStatus: input.decision === "APPROVED" ? "ACTIVE" : "INACTIVE",
          updatedAt: new Date(),
        })
        .where(eq(brokerProfiles.id, input.brokerId))
        .returning();
      // Insert audit log entry
      await db.insert(kycAuditLog).values({
        stakeholderType: "BROKER",
        profileId: input.brokerId,
        reviewerId: ctx.user.id,
        reviewerName: ctx.user.name ?? null,
        decision: input.decision,
        notes: input.notes ?? null,
      });
      const brokerFirm = updated.firmName ?? `Broker #${updated.id}`;
      if (input.decision === "APPROVED") {
        notifyOwner({
          title: `✅ Broker KYC Approved — ${brokerFirm}`,
          content:
            `Broker firm "${brokerFirm}" (Profile ID: ${updated.id}) has been KYC-approved by ${ctx.user.name ?? "admin"}. ` +
            `Their account is now ACTIVE and they can begin onboarding clients.` +
            (input.notes ? `\n\nReviewer notes: ${input.notes}` : ""),
        }).catch(e => console.warn("[brokerRouter] notifyOwner (approved) failed:", (e as Error).message));
      } else {
        notifyOwner({
          title: `❌ Broker KYC Rejected — ${brokerFirm}`,
          content:
            `Broker firm "${brokerFirm}" (Profile ID: ${updated.id}) KYC application was rejected by ${ctx.user.name ?? "admin"}.` +
            (input.notes ? `\n\nReason: ${input.notes}` : ""),
        }).catch(e => console.warn("[brokerRouter] notifyOwner (rejected) failed:", (e as Error).message));
      }
      return { kycStatus: updated.kycStatus, accountStatus: updated.accountStatus };
    }),

  // ── adminBulkReviewBrokerKYC ────────────────────────────────────────────────
  adminBulkReviewBrokerKYC: adminProcedure
    .input(z.object({
      brokerIds: z.array(z.number().int().positive()).min(1).max(100),
      decision: z.enum(["APPROVED", "REJECTED"]),
      notes: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
            if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable — please try again" });
      let approved = 0, rejected = 0, failed = 0;
      const results: { id: number; status: string; error?: string }[] = [];
      for (const id of input.brokerIds) {
        try {
          const [profile] = await db
            .select({ kycStatus: brokerProfiles.kycStatus })
            .from(brokerProfiles)
            .where(eq(brokerProfiles.id, id))
            .limit(1);
          if (!profile || !["UNDER_REVIEW", "SUBMITTED"].includes(profile.kycStatus)) {
            failed++;
            results.push({ id, status: "SKIPPED", error: "Not under review" });
            continue;
          }
          await db
            .update(brokerProfiles)
            .set({
              kycStatus: input.decision,
              kycNotes: input.notes,
              accountStatus: input.decision === "APPROVED" ? "ACTIVE" : "INACTIVE",
              updatedAt: new Date(),
            })
            .where(eq(brokerProfiles.id, id));
          if (input.decision === "APPROVED") approved++;
          else rejected++;
          results.push({ id, status: input.decision });
        } catch {
          failed++;
          results.push({ id, status: "ERROR", error: "Update failed" });
        }
      }
      return { approved, rejected, failed, total: input.brokerIds.length, results };
    }),

  // ── adminGetBrokerStats ─────────────────────────────────────────────────────
  adminGetBrokerStats: adminProcedure
    .query(async () => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable — please try again" });
      const [stats] = await db
        .select({
          total: sql<number>`COUNT(*)::int`,
          pending: sql<number>`SUM(CASE WHEN kyc_status = 'PENDING' THEN 1 ELSE 0 END)::int`,
          underReview: sql<number>`SUM(CASE WHEN kyc_status = 'UNDER_REVIEW' THEN 1 ELSE 0 END)::int`,
          approved: sql<number>`SUM(CASE WHEN kyc_status = 'APPROVED' THEN 1 ELSE 0 END)::int`,
          rejected: sql<number>`SUM(CASE WHEN kyc_status = 'REJECTED' THEN 1 ELSE 0 END)::int`,
          active: sql<number>`SUM(CASE WHEN account_status = 'ACTIVE' THEN 1 ELSE 0 END)::int`,
        })
        .from(brokerProfiles);
      return stats;
    }),

  // ── adminListBrokerProfiles ─────────────────────────────────────────────────
  adminListBrokerProfiles: adminProcedure
    .input(z.object({
      kycStatus: z.enum(["PENDING", "UNDER_REVIEW", "APPROVED", "REJECTED"]).optional(),
      limit: z.number().int().min(1).max(100).default(50),
      offset: z.number().int().min(0).default(0),
    }))
    .query(async ({ input }) => {
      const db = await getDb();
            if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
      const conditions = input.kycStatus
        ? [eq(brokerProfiles.kycStatus, input.kycStatus)]
        : [];
      const profiles = await db
        .select()
        .from(brokerProfiles)
        .where(conditions.length ? and(...conditions) : undefined)
        .orderBy(desc(brokerProfiles.createdAt))
        .limit(input.limit)
        .offset(input.offset);
      const [countResult] = await db
        .select({ total: sql<number>`COUNT(*)::int` })
        .from(brokerProfiles)
        .where(conditions.length ? and(...conditions) : undefined);
      return { profiles, total: countResult.total };
    }),

  // ── updateMyBrokerProfile ──────────────────────────────────────────────────
  updateMyBrokerProfile: protectedProcedure
    .input(z.object({
      firmName: z.string().min(2).max(200).optional(),
      rcNumber: z.string().max(50).optional(),
      regulatoryBody: z.string().max(100).optional(),
      contactPhone: z.string().max(30).optional(),
      contactEmail: z.string().email().optional(),
      firmAddress: z.string().optional(),
      state: z.string().max(100).optional(),
      yearsInOperation: z.number().int().min(0).optional(),
      clientBookSize: z.string().max(50).optional(),
      commissionRate: z.number().min(0).max(100).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable — please try again" });
      const [existing] = await db
        .select()
        .from(brokerProfiles)
        .where(eq(brokerProfiles.userId, ctx.user.id))
        .limit(1);
      if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "Broker profile not found" });
      const kycSensitiveChanged =
        (input.firmName !== undefined && input.firmName !== existing.firmName) ||
        (input.rcNumber !== undefined && input.rcNumber !== existing.rcNumber);
      const newKycStatus = kycSensitiveChanged && existing.kycStatus === "APPROVED" ? "PENDING" : existing.kycStatus;
      const updateData: Record<string, unknown> = { ...input, kycStatus: newKycStatus, updatedAt: new Date() };
      if (input.commissionRate !== undefined) updateData.commissionRate = String(input.commissionRate);
      const [updated] = await db
        .update(brokerProfiles)
        .set(updateData)
        .where(eq(brokerProfiles.userId, ctx.user.id))
        .returning();
      if (kycSensitiveChanged && existing.kycStatus === "APPROVED") {
        notifyOwner({
          title: "[Broker] Profile updated — KYC reset to PENDING",
          content: `Broker ${updated.firmName} (user ${ctx.user.id}) changed firm identity fields. KYC status reset from APPROVED to PENDING. Please re-review at /admin/stakeholders.`,
        }).catch(e => console.warn("[brokerRouter] notifyOwner failed:", (e as Error).message));
      }
      return { ...updated, kycResetDueToChange: kycSensitiveChanged && existing.kycStatus === "APPROVED" };
    }),

  // ── getMyClients ────────────────────────────────────────────────────────────
  getMyClients: protectedProcedure
    .input(z.object({
      page: z.number().int().min(1).default(1),
      pageSize: z.number().int().min(1).max(100).default(20),
      status: z.enum(["ACTIVE", "INACTIVE", "SUSPENDED"]).optional(),
    }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
            if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
      const [profile] = await db.select({ id: brokerProfiles.id }).from(brokerProfiles).where(eq(brokerProfiles.userId, ctx.user.id)).limit(1);
      if (!profile) throw new TRPCError({ code: "NOT_FOUND", message: "Broker profile not found" });
      const offset = (input.page - 1) * input.pageSize;
      const conditions = [eq(brokerClients.brokerProfileId, profile.id)];
      if (input.status) conditions.push(eq(brokerClients.status, input.status));
      const [clients, countResult] = await Promise.all([
        db.select().from(brokerClients).where(and(...conditions)).orderBy(desc(brokerClients.createdAt)).limit(input.pageSize).offset(offset),
        db.select({ count: sql<number>`COUNT(*)::int` }).from(brokerClients).where(and(...conditions)),
      ]);
      return { clients, total: Number(countResult[0]?.count ?? 0), page: input.page, pageSize: input.pageSize };
    }),

  // ── addClient ───────────────────────────────────────────────────────────────
  addClient: protectedProcedure
    .input(z.object({
      clientName: z.string().min(1).max(200),
      clientEmail: z.string().email().optional(),
      clientPhone: z.string().optional(),
      accountType: z.string().optional(),
      notes: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
            if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable — please try again" });
      const [profile] = await db.select({ id: brokerProfiles.id }).from(brokerProfiles).where(eq(brokerProfiles.userId, ctx.user.id)).limit(1);
      if (!profile) throw new TRPCError({ code: "NOT_FOUND", message: "Broker profile not found" });
      const [client] = await db.insert(brokerClients).values({
        brokerProfileId: profile.id,
        clientUserId: ctx.user.id,
        clientName: input.clientName,
        clientEmail: input.clientEmail,
        clientPhone: input.clientPhone,
        accountType: input.accountType ?? "INDIVIDUAL",
        notes: input.notes,
      }).returning();
      return client;
    }),

  // ── updateClient ────────────────────────────────────────────────────────────
  updateClient: protectedProcedure
    .input(z.object({
      clientId: z.number().int(),
      clientName: z.string().min(1).max(200).optional(),
      clientEmail: z.string().email().optional(),
      clientPhone: z.string().optional(),
      accountType: z.string().optional(),
      status: z.enum(["ACTIVE", "INACTIVE", "SUSPENDED"]).optional(),
      notes: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
            if (!db) throw new TRPCError({ code: "NOT_FOUND", message: "Not found" });
      const [profile] = await db.select({ id: brokerProfiles.id }).from(brokerProfiles).where(eq(brokerProfiles.userId, ctx.user.id)).limit(1);
      if (!profile) throw new TRPCError({ code: "NOT_FOUND", message: "Broker profile not found" });
      const { clientId, ...updateData } = input;
      const [updated] = await db.update(brokerClients)
        .set({ ...updateData, updatedAt: new Date() })
        .where(and(eq(brokerClients.id, clientId), eq(brokerClients.brokerProfileId, profile.id)))
        .returning();
      if (!updated) throw new TRPCError({ code: "NOT_FOUND", message: "Client not found" });
      return updated;
    }),

  // ── removeClient ────────────────────────────────────────────────────────────
  removeClient: protectedProcedure
    .input(z.object({ clientId: z.number().int() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
            if (!db) throw new TRPCError({ code: "NOT_FOUND", message: "Not found" });
      const [profile] = await db.select({ id: brokerProfiles.id }).from(brokerProfiles).where(eq(brokerProfiles.userId, ctx.user.id)).limit(1);
      if (!profile) throw new TRPCError({ code: "NOT_FOUND", message: "Broker profile not found" });
      await db.delete(brokerClients).where(and(eq(brokerClients.id, input.clientId), eq(brokerClients.brokerProfileId, profile.id)));
      return { success: true };
    }),

  // ── getMyCommissions ────────────────────────────────────────────────────────
  getMyCommissions: protectedProcedure
    .input(z.object({
      page: z.number().int().min(1).default(1),
      pageSize: z.number().int().min(1).max(100).default(20),
      status: z.enum(["PENDING", "PAID", "CANCELLED"]).optional(),
    }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
            if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
      const [profile] = await db.select({ id: brokerProfiles.id, commissionRate: brokerProfiles.commissionRate }).from(brokerProfiles).where(eq(brokerProfiles.userId, ctx.user.id)).limit(1);
      if (!profile) throw new TRPCError({ code: "NOT_FOUND", message: "Broker profile not found" });
      const offset = (input.page - 1) * input.pageSize;
      const conditions = [eq(brokerCommissions.brokerProfileId, profile.id)];
      if (input.status) conditions.push(eq(brokerCommissions.status, input.status));
      const [commissions, countResult, summaryResult] = await Promise.all([
        db.select().from(brokerCommissions).where(and(...conditions)).orderBy(desc(brokerCommissions.createdAt)).limit(input.pageSize).offset(offset),
        db.select({ count: sql<number>`COUNT(*)::int` }).from(brokerCommissions).where(and(...conditions)),
        db.select({
          totalEarned: sql<string>`COALESCE(SUM(commission_amount), 0)::text`,
          totalPaid: sql<string>`COALESCE(SUM(CASE WHEN status = 'PAID' THEN commission_amount ELSE 0 END), 0)::text`,
          totalPending: sql<string>`COALESCE(SUM(CASE WHEN status = 'PENDING' THEN commission_amount ELSE 0 END), 0)::text`,
        }).from(brokerCommissions).where(eq(brokerCommissions.brokerProfileId, profile.id)),
      ]);
      return {
        commissions,
        total: Number(countResult[0]?.count ?? 0),
        page: input.page,
        pageSize: input.pageSize,
        summary: {
          totalEarned: summaryResult[0]?.totalEarned ?? "0",
          totalPaid: summaryResult[0]?.totalPaid ?? "0",
          totalPending: summaryResult[0]?.totalPending ?? "0",
          commissionRate: profile.commissionRate ?? "0",
        },
      };
    }),

  // ── getMyTradeHistory ───────────────────────────────────────────────────────
  getMyTradeHistory: protectedProcedure
    .input(z.object({
      page: z.number().int().min(1).default(1),
      pageSize: z.number().int().min(1).max(100).default(20),
      symbol: z.string().optional(),
      assetClass: z.string().optional(),
      side: z.enum(["BUY", "SELL"]).optional(),
      sortBy: z.enum(["createdAt", "fillPrice", "filledQty", "grossValue"]).default("createdAt"),
      sortDir: z.enum(["asc", "desc"]).default("desc"),
    }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
            if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
      const offset = (input.page - 1) * input.pageSize;
      const conditions: ReturnType<typeof eq>[] = [];
      // side filter: BUY = user is buyer, SELL = user is seller, none = either
      if (input.side === "BUY") {
        conditions.push(eq(tradeFills.buyerUserId, ctx.user.id));
      } else if (input.side === "SELL") {
        conditions.push(eq(tradeFills.sellerUserId, ctx.user.id));
      } else {
        conditions.push(sql`(${tradeFills.buyerUserId} = ${ctx.user.id} OR ${tradeFills.sellerUserId} = ${ctx.user.id})` as unknown as ReturnType<typeof eq>);
      }
      if (input.symbol) conditions.push(ilike(tradeFills.symbol, `%${input.symbol}%`) as unknown as ReturnType<typeof eq>);
      if (input.assetClass) conditions.push(eq(tradeFills.assetClass, input.assetClass) as unknown as ReturnType<typeof eq>);
      const whereClause = conditions.length === 1 ? conditions[0] : and(...conditions);
      const colMap = {
        createdAt: tradeFills.createdAt,
        fillPrice: tradeFills.fillPrice,
        filledQty: tradeFills.filledQty,
        grossValue: tradeFills.grossValue,
      } as const;
      const orderExpr = input.sortDir === "asc" ? asc(colMap[input.sortBy]) : desc(colMap[input.sortBy]);
      const [trades, countResult] = await Promise.all([
        db.select().from(tradeFills).where(whereClause).orderBy(orderExpr).limit(input.pageSize).offset(offset),
        db.select({ count: sql<number>`COUNT(*)::int` }).from(tradeFills).where(whereClause),
      ]);
      return { trades, total: Number(countResult[0]?.count ?? 0), page: input.page, pageSize: input.pageSize };
    }),

  // ── getMonthlyCommissionChart ────────────────────────────────────────────────
  getMonthlyCommissionChart: protectedProcedure
    .input(z.object({
      months: z.number().int().min(3).max(24).default(12),
    }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable — please try again" });
      const [profile] = await db
        .select({ id: brokerProfiles.id })
        .from(brokerProfiles)
        .where(eq(brokerProfiles.userId, ctx.user.id))
        .limit(1);
      if (!profile) throw new TRPCError({ code: "NOT_FOUND", message: "Broker profile not found" });

      const rows = await db
        .select({
          month: sql<string>`TO_CHAR(created_at, 'YYYY-MM')`,
          earned: sql<string>`COALESCE(SUM(commission_amount), 0)::text`,
          paid: sql<string>`COALESCE(SUM(CASE WHEN status = 'PAID' THEN commission_amount ELSE 0 END), 0)::text`,
          pending: sql<string>`COALESCE(SUM(CASE WHEN status = 'PENDING' THEN commission_amount ELSE 0 END), 0)::text`,
        })
        .from(brokerCommissions)
        .where(and(
          eq(brokerCommissions.brokerProfileId, profile.id),
          sql`created_at >= NOW() - (${input.months} * INTERVAL '1 month')`,
        ))
        .groupBy(sql`TO_CHAR(created_at, 'YYYY-MM')`)
        .orderBy(sql`TO_CHAR(created_at, 'YYYY-MM')`);

      // Build a full month range so months with 0 earnings still appear
      const now = new Date();
      const monthMap = new Map(rows.map((r) => [r.month, r]));
      return Array.from({ length: input.months }, (_, i) => {
        const d = new Date(now.getFullYear(), now.getMonth() - (input.months - 1 - i), 1);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
        const row = monthMap.get(key);
        return {
          month: key,
          label: d.toLocaleDateString("en-NG", { month: "short", year: "2-digit" }),
          earned: Number(row?.earned ?? 0),
          paid: Number(row?.paid ?? 0),
          pending: Number(row?.pending ?? 0),
        };
      });
    }),
});
