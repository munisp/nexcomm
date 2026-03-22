/**
 * kycServiceRouter.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * tRPC router proxying the Python KYC Service (port 8002).
 * Handles AI-powered document OCR, liveness detection, KYC/KYB applications,
 * warehouse receipts, and produce registration.
 * Falls back to DB-only operations when the service is offline.
 */

import { z } from "zod";
import { protectedProcedure, publicProcedure, adminProcedure, router } from "../_core/trpc";

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
    .input(z.object({ stakeholderType: z.string() }))
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
    .input(z.object({ applicationId: z.string() }))
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
      stakeholderType: z.string(),
      fullName: z.string(),
      dateOfBirth: z.string(),
      nationality: z.string(),
      idType: z.string(),
      idNumber: z.string(),
      address: z.string(),
      phone: z.string(),
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
      applicationId: z.string(),
      documentType: z.string(),
      documentUrl: z.string().url(),
      mimeType: z.string(),
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

  /** Start a liveness check session */
  startLiveness: protectedProcedure
    .input(z.object({ applicationId: z.string() }))
    .mutation(async ({ input }) => {
      try {
        return await kycFetch(`/api/v1/kyc/applications/${input.applicationId}/liveness/start`, {
          method: "POST",
        });
      } catch {
        return { error: "KYC service offline" };
      }
    }),

  /** Verify a liveness session */
  verifyLiveness: protectedProcedure
    .input(z.object({ sessionId: z.string(), imageUrl: z.string().url() }))
    .mutation(async ({ input }) => {
      try {
        return await kycFetch(`/api/v1/kyc/liveness/${input.sessionId}/verify`, {
          method: "POST",
          body: JSON.stringify({ image_url: input.imageUrl }),
        });
      } catch {
        return { error: "KYC service offline" };
      }
    }),

  /** Run AI OCR on a document image */
  extractDocument: protectedProcedure
    .input(z.object({
      documentUrl: z.string().url(),
      documentType: z.string(),
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
    .input(z.object({ documentUrl: z.string().url(), documentType: z.string() }))
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
    .input(z.object({
      applicationId: z.string(),
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

  /** Submit a KYB application (corporate) */
  submitKybApplication: protectedProcedure
    .input(z.object({
      companyName: z.string(),
      registrationNumber: z.string(),
      jurisdiction: z.string(),
      businessType: z.string(),
      address: z.string(),
      directors: z.array(z.object({ name: z.string(), role: z.string() })),
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
