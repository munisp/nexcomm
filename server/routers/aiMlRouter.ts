/**
 * aiMlRouter.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * tRPC router proxying the Python AI/ML Service (port 8003).
 * Provides risk scoring, price forecasting, market sentiment analysis,
 * and anomaly detection for the NEXCOM platform.
 */

import { z } from "zod";
import { protectedProcedure, publicProcedure, adminProcedure, router } from "../_core/trpc";
import { writeAuditLog } from "../audit";

const AIML_URL = process.env.AIML_SERVICE_URL ?? "http://localhost:8007";
const TIMEOUT_MS = 15000; // ML inference can take time

async function aimlFetch(path: string, options?: RequestInit): Promise<unknown> {
  const res = await fetch(`${AIML_URL}${path}`, {
    ...options,
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { "Content-Type": "application/json", ...(options?.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`AI/ML service error: ${res.status} ${await res.text()}`);
  return res.json();
}

export const aiMlRouter = router({
  /** Health check */
  health: publicProcedure.query(async () => {
    try {
      const data = await aimlFetch("/healthz");
      return { online: true, ...(data as object) };
    } catch {
      return { online: false };
    }
  }),

  /** Get risk score for a user/account */
  getRiskScore: protectedProcedure
    .input(z.object({
      accountId: z.string().optional(),
      symbol: z.string().optional(),
      orderValue: z.number().optional(),
      features: z.record(z.string().trim(), z.number()).optional(),
    }))
    .query(async ({ ctx, input }) => {
      try {
        return await aimlFetch("/api/v1/risk-score", {
          method: "POST",
          body: JSON.stringify({
            account_id: input.accountId ?? String(ctx.user.id),
            symbol: input.symbol,
            order_value: input.orderValue,
            features: input.features ?? {},
          }),
        });
      } catch {
        return { risk_score: 0.5, risk_level: "MEDIUM", error: "AI/ML service offline" };
      }
    }),

  /** Get price forecast for a symbol */
  getForecast: publicProcedure
    .input(z.object({
      symbol: z.string().trim(),
      horizon: z.number().int().min(1).max(90).default(7),
      model: z.enum(["ARIMA", "LSTM", "PROPHET", "ENSEMBLE"]).default("ENSEMBLE"),
    }))
    .query(async ({ input }) => {
      try {
        return await aimlFetch("/api/v1/forecast", {
          method: "POST",
          body: JSON.stringify({
            symbol: input.symbol,
            horizon: input.horizon,
            model: input.model,
          }),
        });
      } catch {
        return { forecasts: [], error: "AI/ML service offline" };
      }
    }),

  /** Get available forecast models */
  getForecastModels: publicProcedure.query(async () => {
    try {
      return await aimlFetch("/api/v1/forecast/models");
    } catch {
      return ["ARIMA", "LSTM", "PROPHET", "ENSEMBLE"];
    }
  }),

  /** Get market sentiment for a symbol */
  getSentiment: publicProcedure
    .input(z.object({ symbol: z.string().trim() }))
    .query(async ({ input }) => {
      try {
        return await aimlFetch(`/api/v1/sentiment/${input.symbol}`);
      } catch {
        return { symbol: input.symbol, sentiment: "NEUTRAL", score: 0.5, error: "AI/ML service offline" };
      }
    }),

  /** Get sentiment summary for all symbols */
  getSentimentSummary: publicProcedure.query(async () => {
    try {
      return await aimlFetch("/api/v1/sentiment/summary/all");
    } catch {
      return { sentiments: [], error: "AI/ML service offline" };
    }
  }),

  /** Get news sentiment for a symbol */
  getNewsSentiment: publicProcedure
    .input(z.object({ symbol: z.string().trim() }))
    .query(async ({ input }) => {
      try {
        return await aimlFetch(`/api/v1/sentiment/news/${input.symbol}`);
      } catch {
        return { articles: [], error: "AI/ML service offline" };
      }
    }),

  /** Get recent anomalies detected by the ML engine */
  getRecentAnomalies: adminProcedure.query(async () => {
    try {
      return await aimlFetch("/api/v1/anomalies/recent");
    } catch {
      return { anomalies: [], error: "AI/ML service offline" };
    }
  }),

  /** Get anomalies for a specific symbol */
  getAnomaliesForSymbol: adminProcedure
    .input(z.object({ symbol: z.string().trim() }))
    .query(async ({ input }) => {
      try {
        return await aimlFetch(`/api/v1/anomalies/symbol/${input.symbol}`);
      } catch {
        return { anomalies: [], error: "AI/ML service offline" };
      }
    }),

  /** Get anomaly detection statistics */
  getAnomalyStats: adminProcedure.query(async () => {
    try {
      return await aimlFetch("/api/v1/anomalies/stats");
    } catch {
      return { total: 0, by_severity: {}, error: "AI/ML service offline" };
    }
  }),

  /** Configure anomaly detection thresholds */
  configureAnomalyDetection: adminProcedure
    .input(z.object({
      symbol: z.string().optional(),
      threshold: z.number().min(0).max(1).optional(),
      sensitivity: z.enum(["LOW", "MEDIUM", "HIGH"]).optional(),
    }))
    .mutation(async ({ input }) => {
      try {
        return await aimlFetch("/api/v1/anomalies/configure", {
          method: "POST",
          body: JSON.stringify(input),
        });
      } catch {
        return { error: "AI/ML service offline" };
      }
    }),

  /** Get GNN commodity correlation graph */
  getCommodityCorrelationGraph: publicProcedure
    .input(z.object({ threshold: z.number().min(0).max(1).default(0.4) }).optional())
    .query(async ({ input }) => {
      try {
        const threshold = input?.threshold ?? 0.4;
        return await aimlFetch(`/api/v1/anomalies/correlation-graph?threshold=${threshold}`);
      } catch {
        return {
          nodes: [] as unknown[],
          edges: [] as unknown[],
          stats: { node_count: 0, edge_count: 0, avg_correlation: 0, strong_edge_count: 0, anomalous_edge_count: 0, threshold: 0.4 },
          model: { type: "GNN-GraphSAGE", embedding_dim: 64, training_source: "offline", last_updated: "" },
          error: "AI/ML service offline",
        };
      }
    }),

  /**
   * Check for co-anomalous commodity pairs in the GNN correlation graph.
   * If any pair of commodities both have anomaly_score > threshold, fires
   * notifyOwner and returns the list of co-anomalous pairs.
   */
  checkCoAnomalies: protectedProcedure
    .input(z.object({
      threshold: z.number().min(0).max(1).default(0.5),
      correlationThreshold: z.number().min(0).max(1).default(0.4),
    }).optional())
    .mutation(async ({ input }) => {
      const anomalyThreshold = input?.threshold ?? 0.5;
      const corrThreshold = input?.correlationThreshold ?? 0.4;
      try {
        const graph = await aimlFetch(
          `/api/v1/anomalies/correlation-graph?threshold=${corrThreshold}`
        ) as {
          nodes?: Array<{ id: string; label: string; anomaly_score: number; is_anomalous: boolean }>;
          edges?: Array<{ source: string; target: string; correlation: number; strength: string; is_anomalous: boolean }>;
          stats?: { anomalous_edge_count: number };
        };

        const nodesMap = new Map((graph.nodes ?? []).map((n) => [n.id, n]));
        const coAnomalousPairs = (graph.edges ?? []).filter((e) => {
          const src = nodesMap.get(e.source);
          const tgt = nodesMap.get(e.target);
          return e.is_anomalous &&
            (src?.anomaly_score ?? 0) > anomalyThreshold &&
            (tgt?.anomaly_score ?? 0) > anomalyThreshold;
        });

        if (coAnomalousPairs.length > 0) {
          const pairList = coAnomalousPairs
            .map((p) => {
              const src = nodesMap.get(p.source);
              const tgt = nodesMap.get(p.target);
              return `${src?.label ?? p.source} ↔ ${tgt?.label ?? p.target} (corr: ${p.correlation.toFixed(2)})`;
            })
            .join("\n");

          const { notifyOwner } = await import("../_core/notification");
          await notifyOwner({
            title: `⚠ GNN Co-Anomaly Alert: ${coAnomalousPairs.length} pair(s) detected`,
            content:
              `The GNN commodity correlation model detected ${coAnomalousPairs.length} co-anomalous ` +
              `pair(s) with anomaly scores above ${(anomalyThreshold * 100).toFixed(0)}%:\n\n` +
              pairList +
              `\n\nReview the AI/ML → GNN Correlation dashboard for details.`,
          });
        }

        return {
          coAnomalousPairs,
          totalAnomalousEdges: graph.stats?.anomalous_edge_count ?? 0,
          alertFired: coAnomalousPairs.length > 0,
        };
      } catch {
        return { coAnomalousPairs: [], totalAnomalousEdges: 0, alertFired: false, error: "AI/ML service offline" };
      }
    }),

  /** Batch risk scoring for multiple accounts */
  batchRiskScore: adminProcedure
    .input(z.object({
      accounts: z.array(z.object({
        account_id: z.string().trim(),
        features: z.record(z.string().trim(), z.number()).optional(),
      })),
    }))
    .mutation(async ({ input }) => {
      try {
        return await aimlFetch("/api/v1/risk-score/batch", {
          method: "POST",
          body: JSON.stringify({ accounts: input.accounts }),
        });
      } catch {
        return { results: [], error: "AI/ML service offline" };
      }
    }),
});
