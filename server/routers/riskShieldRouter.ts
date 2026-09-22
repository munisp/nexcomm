/**
 * riskShieldRouter.ts — INNOVATION 3: TRADE RISK SHIELD
 * ─────────────────────────────────────────────────────────────────────────────
 * Inline pre-trade risk scoring: proxies the ml-platform HTTP API
 * (ML_PLATFORM_URL, default http://localhost:8015):
 *   POST /v1/predict/fraud  → transaction-level fraud probability + decision
 *   POST /v1/predict/graph  → GNN fraud-ring membership probability
 *
 * Contract notes (verified against services/ml-platform/mlplatform/serving/app.py):
 *   fraud response: { fraud_probability, decision: "allow"|"review"|"block",
 *                     cold_start, feature_source, model_version, ... }
 *   graph response: { fraud_ring_probability, is_suspicious, model_version, ... }
 *   graph returns HTTP 404 for accounts absent from the graph (honest
 *   ring-cold-start), 503 when no model is registered.
 *
 * FAIL-CLOSED: if the fraud score cannot be obtained within 800 ms the
 * procedure returns { status: "unavailable" } — the UI must render an honest
 * unavailable state. A score is NEVER fabricated here.
 *
 * Assessments are written to the shared audit_log (action "riskShield.assess")
 * so getMyRiskProfile can report the user's real recent assessment history
 * without introducing another table.
 */

import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { protectedProcedure, router } from "../_core/trpc";
import { writeAuditLog } from "../audit";
import { getDb } from "../db";
import { auditLog } from "../../drizzle/schema";

const ML_PLATFORM_URL = process.env.ML_PLATFORM_URL ?? "http://localhost:8015";
const ML_TIMEOUT_MS = 800; // fail-closed pre-trade budget

interface FraudPredictResponse {
  fraud_probability: number;
  decision: "allow" | "review" | "block";
  cold_start: boolean;
  feature_source: string;
  model_version: string;
}

interface GraphPredictResponse {
  fraud_ring_probability: number;
  is_suspicious: boolean;
  model_version: string;
}

async function mlPost<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${ML_PLATFORM_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(ML_TIMEOUT_MS),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    const err = new Error(`ml-platform ${path} -> ${res.status}`) as Error & { status?: number };
    err.status = res.status;
    err.message += detail ? `: ${detail.slice(0, 200)}` : "";
    throw err;
  }
  return (await res.json()) as T;
}

export const riskShieldRouter = router({
  /**
   * Pre-trade risk assessment for the order being composed.
   * Called (debounced) from the order ticket; also right before submit.
   */
  assessOrder: protectedProcedure
    .input(
      z.object({
        commodity: z.string().trim().min(1).max(64),
        amount: z.number().nonnegative().max(1e11),
        quantity: z.number().positive().max(1e6).optional(),
        counterparty: z.string().trim().max(64).optional(),
        channel: z.enum(["web", "ussd", "whatsapp", "agent"]).default("web"),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const accountId = String(ctx.user.id);
      const assessedAt = new Date().toISOString();

      // Fraud score is mandatory (fail-closed); ring score is best-effort
      // (graph 404/503 is an honest cold-start, not a failure).
      let fraud: FraudPredictResponse;
      try {
        fraud = await mlPost<FraudPredictResponse>("/v1/predict/fraud", {
          account_id: accountId,
          amount: input.amount,
          currency: "NGN",
          transaction_type: "ORDER",
          channel: input.channel,
          commodity: input.commodity,
          payee_id: input.counterparty,
          quantity_mt: input.quantity,
          timestamp: Date.now(),
        });
      } catch (err) {
        const reason = err instanceof Error ? err.message : "ml-platform unreachable";
        await writeAuditLog({
          userId: ctx.user.id,
          action: "riskShield.assess",
          resource: "orders",
          details: { status: "unavailable", reason, commodity: input.commodity, amount: input.amount },
        });
        return {
          status: "unavailable" as const,
          reason,
          assessed_at: assessedAt,
        };
      }

      let ringProbability: number | null = null;
      let ringColdStart = true;
      let ringModelVersion: string | null = null;
      try {
        const graph = await mlPost<GraphPredictResponse>("/v1/predict/graph", {
          account_id: accountId,
        });
        ringProbability = graph.fraud_ring_probability;
        ringColdStart = false;
        ringModelVersion = graph.model_version;
      } catch {
        // 404 unknown account / 503 no graph model — honest null, not 0.
      }

      const result = {
        status: "ok" as const,
        fraud_probability: fraud.fraud_probability,
        fraud_decision: fraud.decision,
        ring_probability: ringProbability,
        ring_cold_start: ringColdStart,
        cold_start: fraud.cold_start,
        feature_source: fraud.feature_source,
        model_version: fraud.model_version,
        ring_model_version: ringModelVersion,
        assessed_at: assessedAt,
      };
      await writeAuditLog({
        userId: ctx.user.id,
        action: "riskShield.assess",
        resource: "orders",
        details: {
          commodity: input.commodity,
          amount: input.amount,
          fraud_probability: result.fraud_probability,
          fraud_decision: result.fraud_decision,
          ring_probability: result.ring_probability,
          cold_start: result.cold_start,
          model_version: result.model_version,
        },
      });
      return result;
    }),

  /**
   * The current user's recent pre-trade assessment statistics, computed from
   * their real audit_log history (no separate storage, no fabrication).
   */
  getMyRiskProfile: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) {
      throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "Database unavailable" });
    }
    const rows = await db
      .select({ details: auditLog.details, createdAt: auditLog.createdAt })
      .from(auditLog)
      .where(and(eq(auditLog.userId, ctx.user.id), eq(auditLog.action, "riskShield.assess")))
      .orderBy(desc(auditLog.createdAt))
      .limit(100);

    const okRows = rows.filter((r) => {
      const d = r.details as Record<string, unknown> | null;
      return d && typeof d.fraud_probability === "number";
    });
    const probs = okRows.map((r) => (r.details as Record<string, number>).fraud_probability);
    const decisions = okRows.map((r) => String((r.details as Record<string, unknown>).fraud_decision));
    const last = okRows[0] ?? null;

    return {
      total_assessments: rows.length,
      scored_assessments: okRows.length,
      unavailable_assessments: rows.length - okRows.length,
      avg_fraud_probability: probs.length
        ? probs.reduce((a, b) => a + b, 0) / probs.length
        : null,
      max_fraud_probability: probs.length ? Math.max(...probs) : null,
      decision_breakdown: {
        allow: decisions.filter((d) => d === "allow").length,
        review: decisions.filter((d) => d === "review").length,
        block: decisions.filter((d) => d === "block").length,
      },
      last_assessed_at: last ? last.createdAt.toISOString() : null,
    };
  }),
});
