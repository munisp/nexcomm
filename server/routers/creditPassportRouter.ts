/**
 * creditPassportRouter.ts — INNOVATION 4: CREDIT PASSPORT
 * ─────────────────────────────────────────────────────────────────────────────
 * Verifiable credit-score passport backed by the ml-platform CreditNet API
 * (ML_PLATFORM_URL, default http://localhost:8015, POST /v1/predict/credit).
 *
 * Contract (verified against services/ml-platform/mlplatform/serving/app.py):
 *   { user_id, credit_score (300-900), default_probability,
 *     band: "prime"|"good"|"fair"|"subprime", cold_start, feature_source,
 *     model_version, ... }
 *
 * - getMyPassport:  live score + latest persisted passport record.
 * - issuePassport:  creates/renews a passport row (score snapshot + band +
 *                   sha256 verification code, 180-day validity). FAIL-CLOSED:
 *                   refuses to issue when the scoring service is unavailable.
 * - verifyPassport: PUBLIC — lenders verify a shared code → {valid, band,
 *                   issuedAt}. Never exposes the raw score publicly.
 * - simulate:       documented heuristic improvement simulator. The estimate
 *                   mirrors the terms of the model's training target
 *                   (tenure + settlement discipline + activity), and is
 *                   explicitly labelled is_estimate:true for the UI.
 */

import { createHash, randomBytes } from "crypto";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { desc, eq } from "drizzle-orm";
import { protectedProcedure, publicProcedure, router } from "../_core/trpc";
import { writeAuditLog } from "../audit";
import { getDb } from "../db";
import { creditPassports } from "../../drizzle/schema-credit-passport";

const ML_PLATFORM_URL = process.env.ML_PLATFORM_URL ?? "http://localhost:8015";
const ML_TIMEOUT_MS = 5000;
const PASSPORT_VALIDITY_DAYS = 180;

interface CreditPredictResponse {
  user_id: string;
  credit_score: number;
  default_probability: number;
  band: "prime" | "good" | "fair" | "subprime";
  cold_start: boolean;
  feature_source: string;
  model_version: string;
}

async function fetchCreditScore(userId: string): Promise<CreditPredictResponse> {
  const res = await fetch(`${ML_PLATFORM_URL}/v1/predict/credit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ user_id: userId, features: {} }),
    signal: AbortSignal.timeout(ML_TIMEOUT_MS),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`ml-platform /v1/predict/credit -> ${res.status}${detail ? `: ${detail.slice(0, 200)}` : ""}`);
  }
  return (await res.json()) as CreditPredictResponse;
}

function makeVerificationCode(userId: number, score: number, salt: string): string {
  return createHash("sha256")
    .update(`nexcom-credit-passport:${userId}:${score}:${salt}`)
    .digest("hex");
}

/**
 * Improvement simulator — DOCUMENTED HEURISTIC (not the model itself).
 * Mirrors the three dominant positive terms of the CreditNet training target:
 *   tenure:            +120 * min(months/66, 1)          (age_days/2000 norm)
 *   settlement rate:   +100 * (on_time_rate - 0.85)      (vs platform baseline)
 *   activity:          +60  * (log1p(txns)/8) for the added transactions
 * Negative inputs are clamped at zero; the result is clamped to [300, 900].
 */
function simulateScoreDelta(currentScore: number, deltas: {
  moreTxns: number;
  onTimeRate: number;
  monthsHistory: number;
}): { delta: number; components: { activity: number; settlement: number; tenure: number } } {
  const activity = Math.min(60, 60 * (Math.log1p(Math.max(0, deltas.moreTxns)) / 8));
  const settlement = 100 * (Math.min(1, Math.max(0, deltas.onTimeRate)) - 0.85);
  const tenure = 120 * Math.min(Math.max(0, deltas.monthsHistory) / 66, 1);
  const delta = activity + settlement + tenure;
  return {
    delta: Math.min(Math.max(currentScore + delta, 300), 900) - currentScore,
    components: {
      activity: Math.round(activity * 10) / 10,
      settlement: Math.round(settlement * 10) / 10,
      tenure: Math.round(tenure * 10) / 10,
    },
  };
}

export const creditPassportRouter = router({
  /** Live CreditNet score + latest issued passport for the current user. */
  getMyPassport: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "Database unavailable" });

    let live: CreditPredictResponse | null = null;
    let liveError: string | null = null;
    try {
      live = await fetchCreditScore(String(ctx.user.id));
    } catch (err) {
      liveError = err instanceof Error ? err.message : "scoring service unreachable";
    }

    const [latest] = await db
      .select()
      .from(creditPassports)
      .where(eq(creditPassports.userId, ctx.user.id))
      .orderBy(desc(creditPassports.issuedAt))
      .limit(1);

    return {
      status: live ? ("ok" as const) : ("unavailable" as const),
      reason: liveError,
      score: live ? live.credit_score : null,
      band: live ? live.band : null,
      default_probability: live ? live.default_probability : null,
      cold_start: live ? live.cold_start : null,
      feature_source: live ? live.feature_source : null,
      model_version: live ? live.model_version : null,
      passport: latest ?? null,
      passport_valid: latest ? latest.expiresAt > new Date() : false,
      assessed_at: new Date().toISOString(),
    };
  }),

  /** Issue or renew the user's credit passport (fail-closed on ML outage). */
  issuePassport: protectedProcedure.mutation(async ({ ctx }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "Database unavailable" });

    let live: CreditPredictResponse;
    try {
      live = await fetchCreditScore(String(ctx.user.id));
    } catch (err) {
      throw new TRPCError({
        code: "SERVICE_UNAVAILABLE",
        message: `Credit scoring unavailable — passport not issued: ${err instanceof Error ? err.message : "unreachable"}`,
      });
    }

    const now = new Date();
    const expiresAt = new Date(now.getTime() + PASSPORT_VALIDITY_DAYS * 24 * 3600 * 1000);
    const salt = randomBytes(8).toString("hex");
    const score = Math.round(live.credit_score);
    const band = live.cold_start ? "cold_start" : live.band;
    const verificationCode = makeVerificationCode(ctx.user.id, score, salt);

    const [row] = await db
      .insert(creditPassports)
      .values({
        userId: ctx.user.id,
        score,
        band,
        issuedAt: now,
        expiresAt,
        verificationCode,
      })
      .returning();

    await writeAuditLog({
      userId: ctx.user.id,
      action: "creditPassport.issue",
      resource: "credit_passports",
      resourceId: String(row.id),
      details: { score, band, cold_start: live.cold_start, model_version: live.model_version },
    });

    return {
      passport: row,
      score: live.credit_score,
      band,
      cold_start: live.cold_start,
      model_version: live.model_version,
      expires_at: expiresAt.toISOString(),
      verification_code: verificationCode,
    };
  }),

  /** Public lender verification of a shared passport code. */
  verifyPassport: publicProcedure
    .input(z.object({ code: z.string().trim().regex(/^[0-9a-f]{64}$/) }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "Database unavailable" });
      const [row] = await db
        .select()
        .from(creditPassports)
        .where(eq(creditPassports.verificationCode, input.code))
        .limit(1);
      if (!row) {
        return { valid: false as const, band: null, issuedAt: null, expired: false as const };
      }
      const expired = row.expiresAt <= new Date();
      return {
        valid: !expired,
        band: row.band,
        issuedAt: row.issuedAt.toISOString(),
        expired,
      };
    }),

  /**
   * Improvement simulator — heuristic ESTIMATE (see simulateScoreDelta).
   * Uses the live score as the base; falls back to the latest passport score.
   */
  simulate: protectedProcedure
    .input(
      z.object({
        more_txns: z.number().int().min(0).max(500),
        on_time_rate: z.number().min(0).max(1),
        months_history: z.number().min(0).max(36),
      })
    )
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "Database unavailable" });

      let baseScore: number | null = null;
      let baseSource: "live" | "passport" | null = null;
      try {
        const live = await fetchCreditScore(String(ctx.user.id));
        baseScore = live.credit_score;
        baseSource = "live";
      } catch {
        const [latest] = await db
          .select()
          .from(creditPassports)
          .where(eq(creditPassports.userId, ctx.user.id))
          .orderBy(desc(creditPassports.issuedAt))
          .limit(1);
        if (latest) {
          baseScore = latest.score;
          baseSource = "passport";
        }
      }
      if (baseScore === null) {
        return {
          status: "unavailable" as const,
          reason: "no live score and no issued passport to use as a base",
        };
      }

      const { delta, components } = simulateScoreDelta(baseScore, {
        moreTxns: input.more_txns,
        onTimeRate: input.on_time_rate,
        monthsHistory: input.months_history,
      });
      return {
        status: "ok" as const,
        is_estimate: true,
        heuristic:
          "delta = 60*log1p(more_txns)/8 (activity) + 100*(on_time_rate-0.85) (settlement) + 120*min(months/66,1) (tenure); mirrors CreditNet training-target terms; result clamped to 300-900",
        base_score: Math.round(baseScore * 10) / 10,
        base_source: baseSource,
        projected_score: Math.round((baseScore + delta) * 10) / 10,
        delta: Math.round(delta * 10) / 10,
        components,
        inputs: input,
      };
    }),
});
