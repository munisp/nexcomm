/**
 * livenessRouter.ts  (DOCAI deposit snippet)
 * ─────────────────────────────────────────────────────────────────────────────
 * tRPC router proxying the next-gen liveness protocol to the Python
 * kyc-service (docai/liveness.py):
 *
 *   liveness.issueChallenge  → POST /api/v1/liveness/challenge
 *   liveness.verifyChallenge → POST /api/v1/liveness/verify
 *
 * FAIL-CLOSED: any kyc-service error, timeout, or non-OK status surfaces as a
 * TRPCError and never as a passing verdict. The challenge record (nonce,
 * sequence, TTL) is issued and owned server-side by kyc-service; the portal
 * is a transport layer only.
 *
 * Registration (server/routers.ts — apply manually, this file does not edit it):
 *   import { livenessRouter } from "./routers/livenessRouter";
 *   // inside appRouter:
 *   liveness: livenessRouter,
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";

const KYC_SERVICE_URL = process.env.KYC_SERVICE_URL ?? "http://localhost:3002";
const TIMEOUT_MS = 30_000;

const challengeResponseSchema = z.object({
  action: z.string(),
  passed: z.boolean(),
  face_detected: z.boolean(),
  latency_ms: z.number().nonnegative(),
});

export type IssuedChallenge = {
  success: boolean;
  challenge_id: string;
  nonce: string;
  sequence: string[];
  expires_at_epoch: number;
  ttl_seconds: number;
  per_challenge_ms: number;
  application_id?: string | null;
  store_backend: string;
};

export type LivenessVerdict = {
  success: boolean;
  challenge_id: string;
  passed: boolean;
  state: "issued" | "passed" | "failed" | "expired";
  reasons: string[];
  spoof_score: number | null;
  face_match_score: number | null;
  challenge_results: Array<Record<string, unknown>>;
  anti_spoof_available: boolean;
  capabilities: Record<string, unknown>;
};

async function postJson<T>(path: string, body: unknown): Promise<T> {
  let resp: Response;
  try {
    resp = await fetch(`${KYC_SERVICE_URL}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    // Fail-closed: transport failure ⇒ no liveness verdict at all.
    throw new TRPCError({
      code: "BAD_GATEWAY",
      message: `kyc-service unreachable: ${err instanceof Error ? err.message : String(err)}`,
    });
  }
  if (!resp.ok) {
    throw new TRPCError({
      code: resp.status === 410 ? "TIMEOUT" : "BAD_GATEWAY",
      message: `kyc-service returned HTTP ${resp.status}`,
    });
  }
  return (await resp.json()) as T;
}

export const livenessRouter = router({
  /** Issue a single-use server-side challenge (nonce + random action sequence). */
  issueChallenge: protectedProcedure
    .input(z.object({ applicationId: z.string().optional() }))
    .mutation(async ({ input }) => {
      // kyc-service accepts application_id as a query param
      const qs = input.applicationId
        ? `?application_id=${encodeURIComponent(input.applicationId)}`
        : "";
      const issued = await postJson<IssuedChallenge>(
        `/api/v1/liveness/challenge${qs}`,
        {},
      );
      if (!issued.success || !issued.challenge_id || !issued.nonce) {
        throw new TRPCError({
          code: "BAD_GATEWAY",
          message: "kyc-service returned a malformed challenge",
        });
      }
      return issued;
    }),

  /** Submit challenge responses + frames; returns the fail-closed verdict. */
  verifyChallenge: protectedProcedure
    .input(
      z.object({
        challenge_id: z.string().min(1),
        nonce: z.string().min(1),
        responses: z.array(challengeResponseSchema),
        frames: z.array(z.string()).max(8).default([]),
        selfie_frame: z.string().optional(),
        document_photo_url: z.string().url().optional(),
        require_face_match: z.boolean().default(false),
      }),
    )
    .mutation(async ({ input }) => {
      const verdict = await postJson<LivenessVerdict>(
        "/api/v1/liveness/verify",
        input,
      );
      // Honest pass-through: the Python side owns the decision; we surface
      // spoof_score=null (no model) and reasons verbatim.
      return verdict;
    }),
});
