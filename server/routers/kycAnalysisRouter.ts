/**
 * KYC Document Analysis Router
 * Calls the Python microservice (PaddleOCR + VLM + Docling) and persists results.
 * Also manages Re-KYC flags, KYC confidence threshold settings, and dual-auth audit trail.
 */
import { z } from "zod";
import { protectedProcedure, adminProcedure, router } from "../_core/trpc";
import { requireKycApprove } from "../_core/permify";
import { getDb } from "../db";
import { kycAnalysisResults, reKycFlags, notifications, users, platformSettings, bulkListingApprovals, kycQueue } from "../../drizzle/schema";
import { eq, desc, and, or } from "drizzle-orm";
import { notifyOwner } from "../_core/notification";
import { createLedgerAccount } from "../matchingEngineClient";

const KYC_SERVICE_URL = process.env.KYC_SERVICE_URL ?? "http://localhost:3002";

// ─── Helper: call the Python microservice ────────────────────────────────────

async function callKycService(payload: {
  document_url: string;
  selfie_url?: string;
  document_type_hint?: string;
  is_pdf?: boolean;
}) {
  const resp = await fetch(`${KYC_SERVICE_URL}/analyse`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(60_000),
  });
  if (!resp.ok) {
    throw new Error(`KYC service returned HTTP ${resp.status}`);
  }
  return resp.json() as Promise<{
    success: boolean;
    ocr: Record<string, unknown>;
    document_analysis: Record<string, unknown>;
    selfie_analysis: Record<string, unknown>;
    passive_liveness: Record<string, unknown>;
    docling_analysis: Record<string, unknown>;
    overall_risk_level: string;
    overall_score: number;
    risk_flags: string[];
    recommendation: string;
  }>;
}

// ─── Router ──────────────────────────────────────────────────────────────────

export const kycAnalysisRouter = router({
  /**
   * Analyse a document (and optional selfie) via the KYC microservice.
   * Persists the result and returns it immediately.
   */
  analyse: protectedProcedure
    .input(
      z.object({
        documentUrl: z.string().url(),
        selfieUrl: z.string().url().optional(),
        documentTypeHint: z.string().optional(),
        isPdf: z.boolean().default(false),
        stakeholderType: z.enum([
          "FARMER",
          "TRADER",
          "BROKER",
          "WAREHOUSE_OPERATOR",
          "MARKET_MAKER",
        ]),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.user.id;

      // Call the Python microservice
      let serviceResult;
      try {
        serviceResult = await callKycService({
          document_url: input.documentUrl,
          selfie_url: input.selfieUrl,
          document_type_hint: input.documentTypeHint,
          is_pdf: input.isPdf,
        });
      } catch (err) {
        // Return a degraded result if the microservice is unavailable
        serviceResult = {
          success: false,
          ocr: { error: String(err) },
          document_analysis: { error: "Service unavailable" },
          selfie_analysis: {},
          passive_liveness: {},
          docling_analysis: {},
          overall_risk_level: "UNKNOWN",
          overall_score: 0,
          risk_flags: ["KYC_SERVICE_UNAVAILABLE"],
          recommendation:
            "KYC analysis service is temporarily unavailable. Manual review required.",
        };
      }

      const da = serviceResult.document_analysis as Record<string, unknown>;
      const sa = serviceResult.selfie_analysis as Record<string, unknown>;
      const pl = serviceResult.passive_liveness as Record<string, unknown>;
      const ocr = serviceResult.ocr as Record<string, unknown>;

      // Persist to DB
      const dbConn = await getDb();
      if (!dbConn) throw new Error("Database unavailable");

      // Check KYC confidence threshold setting
      const [thresholdRow] = await dbConn
        .select()
        .from(platformSettings)
        .where(eq(platformSettings.key, "kyc_confidence_threshold"))
        .limit(1);
      const [autoApproveRow] = await dbConn
        .select()
        .from(platformSettings)
        .where(eq(platformSettings.key, "kyc_auto_approve_above_threshold"))
        .limit(1);
      const threshold = thresholdRow ? parseFloat(thresholdRow.value) : 0.7;
      const autoApprove = autoApproveRow ? autoApproveRow.value === "true" : false;
      const belowThreshold = serviceResult.overall_score < threshold;
      // Add threshold flag to risk_flags if below threshold
      if (belowThreshold && !serviceResult.risk_flags.includes("BELOW_CONFIDENCE_THRESHOLD")) {
        serviceResult.risk_flags.push("BELOW_CONFIDENCE_THRESHOLD");
      }
      // If auto-approve is enabled and score is above threshold, override recommendation
      if (autoApprove && !belowThreshold && serviceResult.overall_risk_level !== "CRITICAL") {
        serviceResult.recommendation = `AUTO_APPROVED: Score ${serviceResult.overall_score.toFixed(2)} meets threshold ${threshold.toFixed(2)}.`;
      }

      const [inserted] = await dbConn
        .insert(kycAnalysisResults)
        .values({
          userId,
          stakeholderType: input.stakeholderType,
          documentUrl: input.documentUrl,
          selfieUrl: input.selfieUrl ?? null,
          isPdf: input.isPdf,
          ocrExtractedFields: ocr.extracted_fields
            ? JSON.stringify(ocr.extracted_fields)
            : null,
          ocrAvgConfidence:
            typeof ocr.avg_confidence === "number"
              ? ocr.avg_confidence
              : null,
          ocrLineCount:
            typeof ocr.line_count === "number" ? ocr.line_count : null,
          documentAuthenticityScore:
            typeof da.authenticity_score === "number"
              ? da.authenticity_score
              : null,
          documentType:
            typeof da.document_type === "string" ? da.document_type : null,
          documentRiskFlags: da.risk_flags
            ? JSON.stringify(da.risk_flags)
            : null,
          selfieOverallScore:
            typeof sa.overall_score === "number" ? sa.overall_score : null,
          selfielivenessAssessment:
            typeof sa.liveness_assessment === "string"
              ? sa.liveness_assessment
              : null,
          passiveLivenessScore:
            typeof pl.liveness_score === "number" ? pl.liveness_score : null,
          passiveLivenessFlags: pl.flags
            ? JSON.stringify(pl.flags)
            : null,
          overallScore: serviceResult.overall_score,
          overallRiskLevel: serviceResult.overall_risk_level as
            | "LOW"
            | "MEDIUM"
            | "HIGH"
            | "CRITICAL"
            | "UNKNOWN",
          allRiskFlags: JSON.stringify(serviceResult.risk_flags),
          recommendation: serviceResult.recommendation,
          serviceVersion: "1.0.0",
        })
        .returning();

      return {
        id: inserted?.id ?? null,
        success: serviceResult.success,
        overallRiskLevel: serviceResult.overall_risk_level,
        overallScore: serviceResult.overall_score,
        riskFlags: serviceResult.risk_flags,
        recommendation: serviceResult.recommendation,
        documentType: da.document_type ?? null,
        documentAuthenticityScore: da.authenticity_score ?? null,
        ocrExtractedFields: ocr.extracted_fields ?? {},
        selfieScore: sa.overall_score ?? null,
        livenessAssessment: sa.liveness_assessment ?? null,
        passiveLivenessScore: pl.liveness_score ?? null,
        passiveLivenessFlags: (pl.flags as string[]) ?? [],
        documentSummary: da.summary ?? null,
        selfieSummary: sa.summary ?? null,
        belowThreshold,
        threshold,
        autoApproved: autoApprove && !belowThreshold && serviceResult.overall_risk_level !== "CRITICAL",
      };
    }),

  /**
   * Get the latest analysis result for the current user.
   */
  myLatestResult: protectedProcedure
    .input(
      z.object({
        stakeholderType: z.enum([
          "FARMER",
          "TRADER",
          "BROKER",
          "WAREHOUSE_OPERATOR",
          "MARKET_MAKER",
        ]),
      })
    )
    .query(async ({ ctx, input }) => {
      const dbConn = await getDb();
      if (!dbConn) return null;
      const [result] = await dbConn
        .select()
        .from(kycAnalysisResults)
        .where(
          and(
            eq(kycAnalysisResults.userId, ctx.user.id),
            eq(kycAnalysisResults.stakeholderType, input.stakeholderType)
          )
        )
        .orderBy(desc(kycAnalysisResults.analysedAt))
        .limit(1);

      return result ?? null;
    }),

  /**
   * Admin: list all analysis results with filters.
   */
  adminList: adminProcedure
    .input(
      z.object({
        stakeholderType: z
          .enum([
            "FARMER",
            "TRADER",
            "BROKER",
            "WAREHOUSE_OPERATOR",
            "MARKET_MAKER",
          ])
          .optional(),
        riskLevel: z
          .enum(["LOW", "MEDIUM", "HIGH", "CRITICAL", "UNKNOWN"])
          .optional(),
        limit: z.number().int().min(1).max(100).default(50),
        offset: z.number().int().min(0).default(0),
      })
    )
    .query(async ({ input }) => {
      const dbConn = await getDb();
      if (!dbConn) return [];
      const conditions = [];
      if (input.stakeholderType) {
        conditions.push(
          eq(kycAnalysisResults.stakeholderType, input.stakeholderType)
        );
      }
      if (input.riskLevel) {
        conditions.push(
          eq(kycAnalysisResults.overallRiskLevel, input.riskLevel)
        );
      }

      const rows = await dbConn
        .select()
        .from(kycAnalysisResults)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(kycAnalysisResults.analysedAt))
        .limit(input.limit)
        .offset(input.offset);

      return rows;
    }),

  /**
   * Check if the KYC microservice is healthy.
   */
  serviceHealth: protectedProcedure.query(async () => {
    try {
      const resp = await fetch(`${KYC_SERVICE_URL}/health`, {
        signal: AbortSignal.timeout(5_000),
      });
      if (!resp.ok) return { healthy: false, status: resp.status };
      const data = await resp.json();
      return { healthy: true, ...data };
    } catch {
      return { healthy: false, error: "Service unreachable" };
    }
  }),

  /**
   * Get microservice capabilities.
   */
  serviceCapabilities: protectedProcedure.query(async () => {
    try {
      const resp = await fetch(`${KYC_SERVICE_URL}/capabilities`, {
        signal: AbortSignal.timeout(5_000),
      });
      if (!resp.ok) return null;
      return resp.json();
    } catch {
      return null;
    }
  }),

  // ─── Re-KYC Flags ────────────────────────────────────────────────────────────

  /**
   * Admin: list Re-KYC flags.
   */
  listReKycFlags: adminProcedure
    .input(z.object({
      includeResolved: z.boolean().default(false),
      page: z.number().int().min(1).default(1),
      pageSize: z.number().int().min(1).max(100).default(50),
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return { flags: [], total: 0 };
      const all = await db
        .select()
        .from(reKycFlags)
        .orderBy(desc(reKycFlags.createdAt));
      const filtered = input.includeResolved ? all : all.filter(f => !f.resolvedAt);
      const total = filtered.length;
      const offset = (input.page - 1) * input.pageSize;
      return { flags: filtered.slice(offset, offset + input.pageSize), total };
    }),

  /**
   * Admin: dismiss a Re-KYC flag.
   */
  dismissReKycFlag: adminProcedure
    .input(z.object({ flagId: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("DB unavailable");
      const [updated] = await db
        .update(reKycFlags)
        .set({ resolvedAt: new Date() })
        .where(eq(reKycFlags.id, input.flagId))
        .returning();
      return updated;
    }),

  /**
   * Admin: send a Re-KYC reminder — in-app notification + owner email fallback.
   * The in-app notification reaches the user directly. The notifyOwner call
   * sends the platform owner an alert with the user's email address so they
   * can follow up via email if the user has not logged in recently.
   */
  sendReKycReminder: adminProcedure
    .input(z.object({ flagId: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("DB unavailable");
      const [flag] = await db
        .select()
        .from(reKycFlags)
        .where(eq(reKycFlags.id, input.flagId))
        .limit(1);
      if (!flag) throw new Error("Flag not found");

      // 1. In-app notification (primary channel)
      await db.insert(notifications).values({
        userId: flag.userId,
        title: "Re-KYC Required",
        message: `Your KYC verification is due for renewal. Please update your KYC documents to continue trading. Reason: ${flag.reason}`,
        type: "SYSTEM",
      });

      // 2. Fetch user details for email fallback
      const [user] = await db
        .select({ name: users.name, email: users.email })
        .from(users)
        .where(eq(users.id, flag.userId))
        .limit(1);

      // 3. Email fallback via notifyOwner — owner can then send a direct email
      const emailFallbackSent = await notifyOwner({
        title: `Re-KYC Reminder Sent — ${flag.stakeholderType} #${flag.userId}`,
        content: [
          `User: ${user?.name ?? "Unknown"} (ID: ${flag.userId})`,
          `Email on file: ${user?.email ?? "not set"}`,
          `Stakeholder type: ${flag.stakeholderType}`,
          `Reason: ${flag.reason}`,
          `KYC approved at: ${flag.kycApprovedAt ? new Date(flag.kycApprovedAt).toISOString() : "unknown"}`,
          ``,
          `An in-app notification has been sent. If the user has not logged in recently,`,
          `please follow up via email: ${user?.email ?? "(no email on file)"}.`,
        ].join("\n"),
      }).catch(() => false);

      await db
        .update(reKycFlags)
        .set({ notifiedAt: new Date() })
        .where(eq(reKycFlags.id, input.flagId));

      return { sent: true, emailFallbackSent };
    }),

  // ─── KYC Confidence Threshold Setting ────────────────────────────────────────

  /**
   * Admin: get the current KYC confidence threshold (0–1, default 0.7).
   * Documents with overallScore < threshold are flagged for manual review.
   */
  getKycThreshold: adminProcedure
    .query(async () => {
      const db = await getDb();
      if (!db) return { threshold: 0.7, autoApproveAboveThreshold: false };
      const [row] = await db
        .select()
        .from(platformSettings)
        .where(eq(platformSettings.key, "kyc_confidence_threshold"))
        .limit(1);
      const [autoRow] = await db
        .select()
        .from(platformSettings)
        .where(eq(platformSettings.key, "kyc_auto_approve_above_threshold"))
        .limit(1);
      return {
        threshold: row ? parseFloat(row.value) : 0.7,
        autoApproveAboveThreshold: autoRow ? autoRow.value === "true" : false,
      };
    }),

  /**
   * Admin: update the KYC confidence threshold.
   * @param threshold - float 0–1; documents scoring below this are flagged for manual review.
   * @param autoApproveAboveThreshold - if true, documents scoring >= threshold are auto-approved.
   */
  setKycThreshold: adminProcedure
    .input(z.object({
      threshold: z.number().min(0).max(1),
      autoApproveAboveThreshold: z.boolean().optional().default(false),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new Error("DB unavailable");

      // Upsert threshold
      const existing = await db
        .select({ id: platformSettings.id })
        .from(platformSettings)
        .where(eq(platformSettings.key, "kyc_confidence_threshold"))
        .limit(1);
      if (existing.length > 0) {
        await db.update(platformSettings)
          .set({ value: String(input.threshold), updatedBy: ctx.user.id, updatedAt: new Date() })
          .where(eq(platformSettings.key, "kyc_confidence_threshold"));
      } else {
        await db.insert(platformSettings).values({
          key: "kyc_confidence_threshold",
          value: String(input.threshold),
          description: "KYC document analysis confidence threshold (0–1). Documents scoring below this are flagged for manual review.",
          updatedBy: ctx.user.id,
        });
      }

      // Upsert auto-approve flag
      const existingAuto = await db
        .select({ id: platformSettings.id })
        .from(platformSettings)
        .where(eq(platformSettings.key, "kyc_auto_approve_above_threshold"))
        .limit(1);
      if (existingAuto.length > 0) {
        await db.update(platformSettings)
          .set({ value: String(input.autoApproveAboveThreshold), updatedBy: ctx.user.id, updatedAt: new Date() })
          .where(eq(platformSettings.key, "kyc_auto_approve_above_threshold"));
      } else {
        await db.insert(platformSettings).values({
          key: "kyc_auto_approve_above_threshold",
          value: String(input.autoApproveAboveThreshold),
          description: "If true, KYC submissions scoring >= kyc_confidence_threshold are automatically approved without manual review.",
          updatedBy: ctx.user.id,
        });
      }

      return { threshold: input.threshold, autoApproveAboveThreshold: input.autoApproveAboveThreshold };
    }),

  // ─── Dual-Auth Audit Trail ────────────────────────────────────────────────────

  /**
   * Admin: get the full audit trail for all bulk listing approval requests.
   * Shows who requested, who countersigned, timestamps, and final status.
   */
  // ─── KYC Queue Admin Actions ──────────────────────────────────────────────────

  /**
   * Admin: list pending KYC queue entries with user info.
   */
  adminListKycQueue: adminProcedure
    .input(z.object({
      status: z.enum(["PENDING", "UNDER_REVIEW", "APPROVED", "REJECTED", "ALL"]).default("ALL"),
      limit: z.number().int().min(1).max(100).default(50),
      offset: z.number().int().min(0).default(0),
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return { records: [], total: 0 };
      const conditions = input.status !== "ALL" ? [eq(kycQueue.status, input.status as "PENDING" | "UNDER_REVIEW" | "APPROVED" | "REJECTED")] : [];
      const rows = await db
        .select({
          id: kycQueue.id,
          userId: kycQueue.userId,
          status: kycQueue.status,
          reviewedBy: kycQueue.reviewedBy,
          reviewNotes: kycQueue.reviewNotes,
          documents: kycQueue.documents,
          submittedAt: kycQueue.submittedAt,
          reviewedAt: kycQueue.reviewedAt,
          userName: users.name,
          userEmail: users.email,
        })
        .from(kycQueue)
        .leftJoin(users, eq(kycQueue.userId, users.id))
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(kycQueue.submittedAt))
        .limit(input.limit)
        .offset(input.offset);
      return { records: rows, total: rows.length };
    }),

  /**
   * Admin: approve or reject a KYC queue entry.
   */
  adminDecideKyc: adminProcedure
    .use(requireKycApprove)
    .input(z.object({
      kycQueueId: z.number().int(),
      /** APPROVED | REJECTED | UNDER_REVIEW (= "request more info") */
      decision: z.enum(["APPROVED", "REJECTED", "UNDER_REVIEW"]),
      reviewNotes: z.string().max(2000).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database unavailable");
      const [updated] = await db
        .update(kycQueue)
        .set({
          status: input.decision,
          reviewedBy: ctx.user!.id,
          reviewNotes: input.reviewNotes ?? null,
          reviewedAt: new Date(),
        })
        .where(eq(kycQueue.id, input.kycQueueId))
        .returning();
      if (!updated) throw new Error("KYC record not found");

      // Auto-provision TigerBeetle ledger accounts on KYC approval (fire-and-forget)
      if (input.decision === "APPROVED") {
        const userId = String(updated.userId);
        const accountTypes: Array<"Trading" | "Settlement" | "Margin"> = [
          "Trading", "Settlement", "Margin",
        ];
        for (const accountType of accountTypes) {
          createLedgerAccount({ user_id: userId, currency: "NGN", account_type: accountType })
            .catch((e) => console.warn(`[KYC] TigerBeetle ${accountType} account provision skipped: ${e}`));
        }
      }

      // Notify owner
      const decisionLabel =
        input.decision === "APPROVED" ? "Approved" :
        input.decision === "REJECTED" ? "Rejected" :
        "Returned for More Information";
      await notifyOwner({
        title: `KYC ${decisionLabel}`,
        content: `KYC application #${input.kycQueueId} has been ${decisionLabel.toLowerCase()} by admin #${ctx.user!.id}${input.reviewNotes ? `: ${input.reviewNotes}` : ""}.`,
      }).catch(() => {});
      // Notify the applicant in-app
      await db.insert(notifications).values({
        userId: updated.userId,
        type: "SECURITY_ALERT",
        title: `KYC Application ${decisionLabel}`,
        message: input.decision === "APPROVED"
          ? "Congratulations! Your KYC application has been approved. You now have full platform access."
          : input.decision === "REJECTED"
          ? `Your KYC application has been rejected. Reason: ${input.reviewNotes ?? "Please contact support for details."}`
          : `Your KYC application requires additional information. ${input.reviewNotes ?? "Please resubmit with the requested documents."}`,
        read: false,
        metadata: { kycQueueId: input.kycQueueId, decision: input.decision },
      }).catch(() => {});
      return updated;
    }),

  listDualAuthAuditTrail: adminProcedure
    .input(z.object({
      page: z.number().int().min(1).default(1),
      pageSize: z.number().int().min(1).max(100).default(50),
      statusFilter: z.enum(["ALL", "PENDING", "COUNTERSIGNED", "REJECTED", "EXPIRED"]).default("ALL"),
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return { entries: [], total: 0, page: input.page, pageSize: input.pageSize, totalPages: 0 };

      // Fetch all approvals joined with initiator user info
      const allRows = await db
        .select({
          id: bulkListingApprovals.id,
          uploadId: bulkListingApprovals.uploadId,
          cooperativeUserId: bulkListingApprovals.cooperativeUserId,
          counterSignerId: bulkListingApprovals.counterSignerId,
          status: bulkListingApprovals.status,
          memberCount: bulkListingApprovals.memberCount,
          cropType: bulkListingApprovals.cropType,
          totalQuantityKg: bulkListingApprovals.totalQuantityKg,
          pricePerKg: bulkListingApprovals.pricePerKg,
          initiatorNotes: bulkListingApprovals.initiatorNotes,
          counterSignerNotes: bulkListingApprovals.counterSignerNotes,
          expiresAt: bulkListingApprovals.expiresAt,
          createdAt: bulkListingApprovals.createdAt,
          updatedAt: bulkListingApprovals.updatedAt,
          initiatorName: users.name,
          initiatorEmail: users.email,
        })
        .from(bulkListingApprovals)
        .leftJoin(users, eq(bulkListingApprovals.cooperativeUserId, users.id))
        .orderBy(desc(bulkListingApprovals.createdAt));

      // Fetch countersigner names separately for rows that have one
      const countersignerIds = [...new Set(allRows.filter(r => r.counterSignerId).map(r => r.counterSignerId!))];
      const countersignerMap: Record<number, { name: string | null; email: string | null }> = {};
      if (countersignerIds.length > 0) {
        const countersigners = await db
          .select({ id: users.id, name: users.name, email: users.email })
          .from(users)
          .where(or(...countersignerIds.map(id => eq(users.id, id))));
        countersigners.forEach(u => { countersignerMap[u.id] = { name: u.name ?? null, email: u.email ?? null }; });
      }

      const enriched = allRows.map(row => ({
        ...row,
        counterSignerName: row.counterSignerId ? (countersignerMap[row.counterSignerId]?.name ?? null) : null,
        counterSignerEmail: row.counterSignerId ? (countersignerMap[row.counterSignerId]?.email ?? null) : null,
      }));

      const filtered = input.statusFilter === "ALL" ? enriched : enriched.filter(r => r.status === input.statusFilter);
      const total = filtered.length;
      const offset = (input.page - 1) * input.pageSize;
      return {
        entries: filtered.slice(offset, offset + input.pageSize),
        total,
        page: input.page,
        pageSize: input.pageSize,
        totalPages: Math.ceil(total / input.pageSize),
      };
    }),
});
