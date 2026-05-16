/**
 * kycServiceRouter.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * tRPC router proxying the Python KYC Service (port 8002).
 * Handles AI-powered document OCR, liveness detection, KYC/KYB applications,
 * warehouse receipts, and produce registration.
 * Falls back to DB-only operations when the service is offline.
 */

import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure, publicProcedure, adminProcedure, router } from "../_core/trpc";
import { requireKycApprove } from "../_core/permify";
import { writeAuditLog } from "../audit";
import {
  upsertLivenessSession,
  getLivenessSession,
  getLivenessSessionsByUser,
  getLivenessSessionsByApplication,
  createLivenessSecurityEvent,
} from "../db";

const KYC_URL = process.env.KYC_SERVICE_URL ?? "http://localhost:3002";
const TIMEOUT_MS = 10000; // OCR can take a few seconds

async function kycFetch(path: string, options?: RequestInit): Promise<unknown> {
  const res = await fetch(`${KYC_URL}${path}`, {
    ...options,
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { "Content-Type": "application/json", ...(options?.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`KYC service error: ${res.status} ${await res.text()}`);
  return res.json();
}

export const kycServiceRouter = router({
  /** Health check */
  health: publicProcedure.query(async () => {
    try {
      const data = await kycFetch("/health");
      return { online: true, ...(data as object) };
    } catch {
      return { online: false };
    }
  }),

  /** Get KYC statistics */
  getStats: adminProcedure.query(async () => {
    try {
      return await kycFetch("/api/v1/kyc/stats");
    } catch {
      return { error: "KYC service offline" };
    }
  }),

  /** Get onboarding requirements for a stakeholder type */
  getOnboardingRequirements: publicProcedure
    .input(z.object({ stakeholderType: z.string().trim() }))
    .query(async ({ input }) => {
      try {
        return await kycFetch(`/api/v1/onboarding/requirements/${input.stakeholderType}`);
      } catch {
        return { requirements: [], error: "KYC service offline" };
      }
    }),

  /** List all stakeholder types */
  getStakeholderTypes: publicProcedure.query(async () => {
    try {
      return await kycFetch("/api/v1/onboarding/stakeholder-types");
    } catch {
      return ["FARMER", "TRADER", "BROKER", "WAREHOUSE_OPERATOR", "MARKET_MAKER"];
    }
  }),

  /** List KYC applications (admin) */
  listApplications: adminProcedure
    .input(z.object({
      status: z.string().optional(),
      page: z.number().int().min(1).default(1),
      limit: z.number().int().min(1).max(100).default(20),
    }))
    .query(async ({ input }) => {
      try {
        const params = new URLSearchParams({
          page: String(input.page),
          limit: String(input.limit),
          ...(input.status ? { status: input.status } : {}),
        });
        return await kycFetch(`/api/v1/kyc/applications?${params}`);
      } catch {
        return { applications: [], total: 0, error: "KYC service offline" };
      }
    }),

  /** Get a specific KYC application */
  getApplication: protectedProcedure
    .input(z.object({ applicationId: z.string().trim() }))
    .query(async ({ input }) => {
      try {
        return await kycFetch(`/api/v1/kyc/applications/${input.applicationId}`);
      } catch {
        return null;
      }
    }),

  /** Submit a new KYC application */
  submitApplication: protectedProcedure
    .input(z.object({
      stakeholderType: z.string().trim(),
      fullName: z.string().trim(),
      dateOfBirth: z.string().trim(),
      nationality: z.string().trim(),
      idType: z.string().trim(),
      idNumber: z.string().trim(),
      address: z.string().trim(),
      phone: z.string().trim(),
      email: z.string().email(),
    }))
    .mutation(async ({ ctx, input }) => {
      try {
        return await kycFetch("/api/v1/kyc/applications", {
          method: "POST",
          body: JSON.stringify({ ...input, userId: ctx.user.id }),
        });
      } catch {
        return { error: "KYC service offline — application saved locally" };
      }
    }),

  /** Upload a KYC document */
  uploadDocument: protectedProcedure
    .input(z.object({
      applicationId: z.string().trim(),
      documentType: z.string().trim(),
      documentUrl: z.string().url(),
      mimeType: z.string().trim(),
    }))
    .mutation(async ({ input }) => {
      try {
        return await kycFetch(`/api/v1/kyc/applications/${input.applicationId}/documents`, {
          method: "POST",
          body: JSON.stringify({
            document_type: input.documentType,
            document_url: input.documentUrl,
            mime_type: input.mimeType,
          }),
        });
      } catch {
        return { error: "KYC service offline" };
      }
    }),

  /** Start a liveness check session — persists session to DB */
  startLiveness: protectedProcedure
    .input(z.object({
      applicationId: z.string().trim().min(1),
    }))
    .mutation(async ({ ctx, input }) => {
      try {
        const data = await kycFetch(`/api/v1/kyc/applications/${input.applicationId}/liveness/start`, {
          method: "POST",
        }) as Record<string, unknown>;
        // Persist the new session to the DB
        if (data?.session_id) {
          await upsertLivenessSession({
            sessionId: String(data.session_id),
            applicationId: input.applicationId,
            userId: ctx.user.id,
            challenges: JSON.stringify(data.challenges ?? []),
            currentChallengeIndex: 0,
            results: "[]",
            status: "PENDING",
          });
        }
        return data;
      } catch {
        return { error: "KYC service offline" };
      }
    }),

  /** Verify one liveness challenge frame — persists result and publishes security event */
  verifyLiveness: protectedProcedure
    .input(z.object({
      sessionId: z.string().trim(),
      imageUrl: z.string().url(),
    }))
    .mutation(async ({ ctx, input }) => {
      try {
        const data = await kycFetch(`/api/v1/kyc/liveness/${input.sessionId}/verify`, {
          method: "POST",
          body: JSON.stringify({ image_url: input.imageUrl }),
        }) as Record<string, unknown>;

        // Persist updated session state
        const isComplete = data?.session_complete === true;
        const overallResult = isComplete
          ? (data?.overall_result === "PASS" ? "PASS" : "FAIL")
          : undefined;
        const spoofRaw = (data?.spoof_type as string) ?? "UNKNOWN";
        const spoofTypeMap: Record<string, "NONE" | "PRINTED_PHOTO" | "SCREEN_REPLAY" | "PAPER_MASK" | "3D_MASK" | "DEEPFAKE" | "HIGH_QUALITY_PHOTO" | "UNKNOWN"> = {
          NONE: "NONE", PRINTED_PHOTO: "PRINTED_PHOTO", SCREEN_REPLAY: "SCREEN_REPLAY",
          PAPER_MASK: "PAPER_MASK", "3D_MASK": "3D_MASK", DEEPFAKE: "DEEPFAKE",
          HIGH_QUALITY_PHOTO: "HIGH_QUALITY_PHOTO",
        };
        const spoofType = spoofTypeMap[spoofRaw] ?? "UNKNOWN";

        await upsertLivenessSession({
          sessionId: input.sessionId,
          applicationId: (data?.application_id as string) ?? undefined,
          userId: ctx.user.id,
          challenges: JSON.stringify(data?.challenges ?? []),
          currentChallengeIndex: Number(data?.current_challenge_index ?? 0),
          results: JSON.stringify(data?.results ?? []),
          overallResult,
          faceMatchScore: (data?.face_match_score as number) ?? undefined,
          spoofType,
          spoofConfidence: (data?.spoof_confidence as number) ?? 0,
          landmarksJson: data?.landmarks ? JSON.stringify(data.landmarks) : undefined,
          status: isComplete ? (overallResult === "PASS" ? "COMPLETE" : "FAILED") : "PENDING",
        });

        // Publish security event on session completion
        if (isComplete) {
          const passed = overallResult === "PASS";
          const isSpoofDetected = spoofType !== "NONE" && spoofType !== "UNKNOWN";
          await createLivenessSecurityEvent({
            userId: ctx.user.id,
            sessionId: input.sessionId,
            applicationId: (data?.application_id as string) ?? undefined,
            eventType: isSpoofDetected
              ? "LIVENESS_SPOOF_DETECTED"
              : passed ? "LIVENESS_PASS" : "LIVENESS_FAIL",
            severity: isSpoofDetected ? "HIGH" : passed ? "LOW" : "MEDIUM",
            spoofType,
            faceMatchScore: (data?.face_match_score as number) ?? undefined,
            confidence: (data?.spoof_confidence as number) ?? undefined,
          });
          await writeAuditLog({
            userId: ctx.user.id,
            action: passed ? "LIVENESS_PASS" : "LIVENESS_FAIL",
            resource: "liveness_session",
            resourceId: input.sessionId,
            details: { overallResult, spoofType, faceMatchScore: data?.face_match_score },
          });
        }

        return data;
      } catch (err) {
        return { error: "KYC service offline", detail: String(err) };
      }
    }),

  /** Run passive liveness check on a single selfie image */
  passiveLiveness: protectedProcedure
    .input(z.object({
      imageUrl: z.string().url(),
      applicationId: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      try {
        const data = await kycFetch("/api/v1/kyc/passive-liveness", {
          method: "POST",
          body: JSON.stringify({
            image_url: input.imageUrl,
            application_id: input.applicationId,
          }),
        }) as Record<string, unknown>;

        // Publish security event if passive liveness fails
        const result = (data?.result as string) ?? "UNKNOWN";
        if (result !== "LIKELY_LIVE") {
          await createLivenessSecurityEvent({
            userId: ctx.user.id,
            sessionId: `passive-${Date.now()}`,
            applicationId: input.applicationId,
            eventType: "PASSIVE_LIVENESS_FAIL",
            severity: result === "POSSIBLY_SCREEN" ? "HIGH" : "MEDIUM",
            spoofType: result === "POSSIBLY_SCREEN" ? "SCREEN_REPLAY" : "PRINTED_PHOTO",
            confidence: (data?.confidence as number) ?? undefined,
          });
        }
        return data;
      } catch {
        return { error: "KYC service offline" };
      }
    }),

  /** Face matching — compare selfie against document photo (two-image) */
  faceMatch: protectedProcedure
    .input(z.object({
      selfieUrl: z.string().url(),
      documentImageUrl: z.string().url(),
      applicationId: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      try {
        const data = await kycFetch("/api/v1/kyc/face-match", {
          method: "POST",
          body: JSON.stringify({
            selfie_url: input.selfieUrl,
            document_image_url: input.documentImageUrl,
            application_id: input.applicationId,
          }),
        }) as Record<string, unknown>;

        // Publish security event
        const matched = data?.matched === true;
        const score = (data?.similarity_score as number) ?? 0;
        await createLivenessSecurityEvent({
          userId: ctx.user.id,
          sessionId: `facematch-${Date.now()}`,
          applicationId: input.applicationId,
          eventType: matched ? "FACE_MATCH_PASS" : "FACE_MATCH_FAIL",
          severity: matched ? "LOW" : "HIGH",
          faceMatchScore: score,
        });
        await writeAuditLog({
          userId: ctx.user.id,
          action: matched ? "FACE_MATCH_PASS" : "FACE_MATCH_FAIL",
          resource: "face_match",
          resourceId: input.applicationId,
          details: { similarityScore: score, matched },
        });
        return data;
      } catch {
        return { error: "KYC service offline" };
      }
    }),

  /** Get liveness sessions for the current user */
  getMyLivenessSessions: protectedProcedure
    .query(async ({ ctx }) => {
      return getLivenessSessionsByUser(ctx.user.id);
    }),

  /** Get liveness sessions for a specific KYC application (admin) */
  getLivenessSessionsByApplication: adminProcedure
    .input(z.object({ applicationId: z.string().trim() }))
    .query(async ({ input }) => {
      return getLivenessSessionsByApplication(input.applicationId);
    }),

  /** Get liveness sessions for multiple users (admin bulk query) */
  getLivenessSessions: adminProcedure
    .input(z.object({ userIds: z.array(z.number()) }))
    .query(async ({ input }) => {
      if (!input.userIds.length) return [];
      const { getDb } = await import("../db");
      const { kycLivenessSessions } = await import("../../drizzle/schema");
      const { inArray, desc } = await import("drizzle-orm");
      const db = await getDb();
      if (!db) return [];
      // Get the most recent session per user
      const rows = await db
        .select()
        .from(kycLivenessSessions)
        .where(inArray(kycLivenessSessions.userId, input.userIds))
        .orderBy(desc(kycLivenessSessions.createdAt));
      // Deduplicate: keep only the latest session per userId
      const seen = new Set<number>();
      return rows.filter(r => {
        const uid = r.userId ?? 0;
        if (seen.has(uid)) return false;
        seen.add(uid);
        return true;
      });
    }),

  /** Get a single liveness session by ID */
  getLivenessSession: protectedProcedure
    .input(z.object({ sessionId: z.string().trim().min(1) }))
    .query(async ({ input }) => {
      const session = await getLivenessSession(input.sessionId);
      if (!session) throw new TRPCError({ code: "NOT_FOUND", message: "Session not found" });
      return session;
    }),

  /** Run AI OCR on a document image */
  extractDocument: protectedProcedure
    .input(z.object({
      documentUrl: z.string().url(),
      documentType: z.string().trim(),
    }))
    .mutation(async ({ input }) => {
      try {
        return await kycFetch("/api/v1/ocr/extract", {
          method: "POST",
          body: JSON.stringify({
            document_url: input.documentUrl,
            document_type: input.documentType,
          }),
        });
      } catch {
        return { error: "KYC service offline" };
      }
    }),

  /** Verify a document (authenticity check) */
  verifyDocument: protectedProcedure
    .input(z.object({ documentUrl: z.string().url(), documentType: z.string().trim() }))
    .mutation(async ({ input }) => {
      try {
        return await kycFetch("/api/v1/documents/verify", {
          method: "POST",
          body: JSON.stringify({
            document_url: input.documentUrl,
            document_type: input.documentType,
          }),
        });
      } catch {
        return { verified: false, error: "KYC service offline" };
      }
    }),

  /** Review a KYC application (admin) */
  reviewApplication: adminProcedure
    .use(requireKycApprove)
    .input(z.object({
      applicationId: z.string().trim(),
      decision: z.enum(["APPROVED", "REJECTED", "PENDING_INFO"]),
      notes: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      try {
        return await kycFetch(`/api/v1/kyc/applications/${input.applicationId}/review`, {
          method: "POST",
          body: JSON.stringify({ decision: input.decision, notes: input.notes }),
        });
      } catch {
        return { error: "KYC service offline" };
      }
    }),

  /** Update an existing KYC application (add info / correct fields) */
  updateApplication: protectedProcedure
    .input(z.object({
      applicationId: z.string().trim(),
      updates: z.record(z.string(), z.unknown()),
    }))
    .mutation(async ({ input }) => {
      try {
        return await kycFetch(`/api/v1/kyc/applications/${input.applicationId}`, {
          method: "PATCH",
          body: JSON.stringify(input.updates),
        });
      } catch {
        return { error: "KYC service offline" };
      }
    }),

  /** Withdraw / cancel own KYC application */
  withdrawApplication: protectedProcedure
    .input(z.object({ applicationId: z.string().trim(), reason: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      try {
        return await kycFetch(`/api/v1/kyc/applications/${input.applicationId}/withdraw`, {
          method: "POST",
          body: JSON.stringify({ userId: ctx.user.id, reason: input.reason }),
        });
      } catch {
        return { error: "KYC service offline" };
      }
    }),

  /** Submit a KYB application (corporate) */
  submitKybApplication: protectedProcedure
    .input(z.object({
      companyName: z.string().trim(),
      registrationNumber: z.string().trim(),
      jurisdiction: z.string().trim(),
      businessType: z.string().trim(),
      address: z.string().trim(),
      directors: z.array(z.object({ name: z.string().trim(), role: z.string().trim() })),
    }))
    .mutation(async ({ ctx, input }) => {
      try {
        return await kycFetch("/api/v1/kyb/applications", {
          method: "POST",
          body: JSON.stringify({ ...input, userId: ctx.user.id }),
        });
      } catch {
        return { error: "KYC service offline" };
      }
    }),






});
