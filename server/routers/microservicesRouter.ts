/**
 * Microservices Router — Gap Closure
 * Wires the 8 orphan microservices that had no tRPC API surface:
 *   - credit-scoring (Rust)
 *   - fraud-engine (Python)
 *   - crypto-guard (Rust)
 *   - ddos-guard (Go)
 *   - aml-alert-subscriber (Go)
 *   - opensearch-sync (Go)
 *   - middleware-hub (Go)
 *   - bot-logic (Python) — supplemental procedures beyond telegramRouter
 *
 * All calls gracefully degrade when the microservice is unavailable
 * (returns { available: false, error: string } instead of throwing).
 */
import { z } from "zod";
import { router, protectedProcedure, publicProcedure } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import { ENV } from "../_core/env";

// ─── Generic HTTP helper ──────────────────────────────────────────────────────
async function callService<T>(
  url: string,
  path: string,
  options?: RequestInit,
): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  try {
    const res = await fetch(`${url}${path}`, {
      headers: { "Content-Type": "application/json", "X-Internal-Secret": ENV.internalSecret },
      ...options,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { ok: false, error: `HTTP ${res.status}: ${text.slice(0, 200)}` };
    }
    const data = (await res.json()) as T;
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

const adminProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (ctx.user.role !== "admin") {
    throw new TRPCError({ code: "FORBIDDEN", message: "Admin access required" });
  }
  return next({ ctx });
});

// ─── Credit Scoring Microservice ──────────────────────────────────────────────
const creditScoringRouter = router({
  health: publicProcedure.query(async () => {
    const result = await callService<{ status: string }>(ENV.creditScoringUrl, "/health");
    return result.ok ? result.data : { status: "unavailable", error: (result as any).error };
  }),

  scoreUser: adminProcedure
    .input(z.object({
      userId: z.number().int().positive(),
      farmerId: z.number().int().positive().optional(),
      model: z.enum(["NEXCOM_AGRI_V1", "NEXCOM_TRADER_V1", "BUREAU_EXTERNAL"]).default("NEXCOM_AGRI_V1"),
      features: z.record(z.string(), z.unknown()).optional(),
    }))
    .mutation(async ({ input }) => {
      const result = await callService<{
        score: number; band: string; maxLoanNgn: number; interestRatePct: number; factors: Record<string, unknown>;
      }>(ENV.creditScoringUrl, "/score", {
        method: "POST",
        body: JSON.stringify(input),
      });
      if (!result.ok) return { available: false, error: (result as any).error };
      return { available: true, ...result.data };
    }),

  getScoreExplanation: protectedProcedure
    .input(z.object({ userId: z.number().int().positive() }))
    .query(async ({ input }) => {
      const result = await callService<{ explanation: string; factors: Record<string, unknown>[] }>(
        ENV.creditScoringUrl, `/explain/${input.userId}`
      );
      if (!result.ok) return { available: false, explanation: "Service unavailable", factors: [] };
      return { available: true, ...result.data };
    }),

  getModelMetrics: adminProcedure.query(async () => {
    const result = await callService<{ models: unknown[] }>(ENV.creditScoringUrl, "/models/metrics");
    if (!result.ok) return { available: false, models: [] };
    return { available: true, ...result.data };
  }),

  batchScore: adminProcedure
    .input(z.object({
      userIds: z.array(z.number().int().positive()).min(1).max(500),
      model: z.enum(["NEXCOM_AGRI_V1", "NEXCOM_TRADER_V1", "BUREAU_EXTERNAL"]).default("NEXCOM_AGRI_V1"),
    }))
    .mutation(async ({ input }) => {
      const result = await callService<{ results: unknown[] }>(ENV.creditScoringUrl, "/score/batch", {
        method: "POST",
        body: JSON.stringify(input),
      });
      if (!result.ok) return { available: false, results: [], error: (result as any).error };
      return { available: true, ...result.data };
    }),
});

// ─── Fraud Engine Microservice ─────────────────────────────────────────────────
const fraudEngineRouter = router({
  health: publicProcedure.query(async () => {
    const result = await callService<{ status: string }>(
      ENV.fraudEngineUrl, "/health"
    );
    if (!result.ok) return { available: false, status: "unreachable" };
    return { available: true, ...result.data };
  }),


  getAlerts: adminProcedure
    .input(z.object({
      status: z.enum(["OPEN", "REVIEWED", "RESOLVED", "FALSE_POSITIVE"]).optional(),
      severity: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]).optional(),
      limit: z.number().int().min(1).max(200).default(50),
      offset: z.number().int().min(0).default(0),
    }).optional())
    .query(async ({ input }) => {
      const params = new URLSearchParams();
      if (input?.status) params.set("status", input.status);
      if (input?.severity) params.set("severity", input.severity);
      params.set("limit", String(input?.limit ?? 50));
      params.set("offset", String(input?.offset ?? 0));
      const result = await callService<{ alerts: unknown[]; total: number }>(
        ENV.fraudEngineUrl, `/alerts?${params}`
      );
      if (!result.ok) return { available: false, alerts: [], total: 0 };
      return { available: true, ...result.data };
    }),

  resolveAlert: adminProcedure
    .input(z.object({
      alertId: z.string().min(1),
      resolution: z.enum(["RESOLVED", "FALSE_POSITIVE"]),
      notes: z.string().max(1000).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const result = await callService<{ success: boolean }>(
        ENV.fraudEngineUrl, `/alerts/${input.alertId}/resolve`, {
          method: "POST",
          body: JSON.stringify({ resolution: input.resolution, notes: input.notes, reviewedBy: ctx.user.id }),
        }
      );
      if (!result.ok) return { available: false, success: false, error: (result as any).error };
      return { available: true, success: true };
    }),

  getStats: adminProcedure.query(async () => {
    const result = await callService<{ stats: unknown }>(ENV.fraudEngineUrl, "/stats");
    if (!result.ok) return { available: false, stats: null };
    return { available: true, ...result.data };
  }),
});

// ─── Crypto Guard Microservice ─────────────────────────────────────────────────
const cryptoGuardRouter = router({
  health: publicProcedure.query(async () => {
    const result = await callService<{ status: string }>(
      ENV.blockchainServiceUrl, "/health"
    );
    if (!result.ok) return { available: false, status: "unreachable" };
    return { available: true, ...result.data };
  }),


  encryptData: protectedProcedure
    .input(z.object({
      plaintext: z.string().min(1),
      recipientPublicKey: z.string().min(1),
      algorithm: z.enum(["AES_256_GCM", "CHACHA20_POLY1305"]).default("AES_256_GCM"),
    }))
    .mutation(async ({ input }) => {
      const result = await callService<{ ciphertext: string; nonce: string }>(
        process.env.CRYPTO_GUARD_URL ?? "http://localhost:8013", "/encrypt", {
          method: "POST",
          body: JSON.stringify(input),
        }
      );
      if (!result.ok) return { available: false, ciphertext: "", nonce: "" };
      return { available: true, ...result.data };
    }),

  getKeyPairs: adminProcedure.query(async () => {
    const result = await callService<{ keys: unknown[] }>(
      process.env.CRYPTO_GUARD_URL ?? "http://localhost:8013", "/keys"
    );
    if (!result.ok) return { available: false, keys: [] };
    return { available: true, ...result.data };
  }),

  rotateKey: adminProcedure
    .input(z.object({ keyId: z.string().min(1) }))
    .mutation(async ({ input }) => {
      const result = await callService<{ success: boolean; newKeyId: string }>(
        process.env.CRYPTO_GUARD_URL ?? "http://localhost:8013", `/keys/${input.keyId}/rotate`, {
          method: "POST",
        }
      );
      if (!result.ok) return { available: false, success: false };
      return { available: true, ...result.data };
    }),
});

// ─── DDoS Guard Microservice ──────────────────────────────────────────────────
const ddosGuardRouter = router({
  health: publicProcedure.query(async () => {
    const result = await callService<{ status: string }>(
      ENV.gatewayServiceUrl, "/health"
    );
    if (!result.ok) return { available: false, status: "unreachable" };
    return { available: true, ...result.data };
  }),


  blockIP: adminProcedure
    .input(z.object({
      ip: z.union([z.ipv4(), z.ipv6()]),
      reason: z.string().max(500),
      durationMinutes: z.number().int().min(1).max(525600).default(60),
    }))
    .mutation(async ({ ctx, input }) => {
      const result = await callService<{ success: boolean }>(
        process.env.DDOS_GUARD_URL ?? "http://localhost:8014", "/block", {
          method: "POST",
          body: JSON.stringify({ ...input, blockedBy: ctx.user.id }),
        }
      );
      if (!result.ok) return { available: false, success: false, error: (result as any).error };
      return { available: true, success: true };
    }),

  unblockIP: adminProcedure
    .input(z.object({ ip: z.union([z.ipv4(), z.ipv6()]) }))
    .mutation(async ({ input }) => {
      const result = await callService<{ success: boolean }>(
        process.env.DDOS_GUARD_URL ?? "http://localhost:8014", `/block/${input.ip}`, {
          method: "DELETE",
        }
      );
      if (!result.ok) return { available: false, success: false };
      return { available: true, success: true };
    }),

  getRules: adminProcedure.query(async () => {
    const result = await callService<{ rules: unknown[] }>(
      process.env.DDOS_GUARD_URL ?? "http://localhost:8014", "/rules"
    );
    if (!result.ok) return { available: false, rules: [] };
    return { available: true, ...result.data };
  }),

  updateRule: adminProcedure
    .input(z.object({
      ruleId: z.string().min(1),
      enabled: z.boolean().optional(),
      threshold: z.number().int().positive().optional(),
      windowSeconds: z.number().int().positive().optional(),
    }))
    .mutation(async ({ input }) => {
      const { ruleId, ...body } = input;
      const result = await callService<{ success: boolean }>(
        process.env.DDOS_GUARD_URL ?? "http://localhost:8014", `/rules/${ruleId}`, {
          method: "PATCH",
          body: JSON.stringify(body),
        }
      );
      if (!result.ok) return { available: false, success: false };
      return { available: true, success: true };
    }),

  getStats: adminProcedure.query(async () => {
    const result = await callService<{
      totalBlocked: number; activeRules: number; requestsPerSecond: number;
    }>(process.env.DDOS_GUARD_URL ?? "http://localhost:8014", "/stats");
    if (!result.ok) return { available: false, totalBlocked: 0, activeRules: 0, requestsPerSecond: 0 };
    return { available: true, ...result.data };
  }),
  getBlockedIPs: adminProcedure
    .input(z.object({ limit: z.number().int().min(1).max(500).default(50) }))
    .query(async ({ input }) => {
      const result = await callService<{ ips: unknown[] }>(
        process.env.DDOS_GUARD_URL ?? "http://localhost:8014", `/blocked?limit=${input.limit}`
      );
      if (!result.ok) return { available: false, ips: [] };
      return { available: true, ...result.data };
    }),
});

// ─── AML Alert Subscriber ─────────────────────────────────────────────────────
const amlAlertSubscriberRouter = router({
  health: publicProcedure.query(async () => {
    const result = await callService<{ status: string }>(
      ENV.channelGatewayUrl, "/health"
    );
    if (!result.ok) return { available: false, status: "unreachable" };
    return { available: true, ...result.data };
  }),


  acknowledgeAlert: adminProcedure
    .input(z.object({
      alertId: z.string().min(1),
      notes: z.string().max(1000).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const result = await callService<{ success: boolean }>(
        process.env.AML_ALERT_SUBSCRIBER_URL ?? "http://localhost:8016",
        `/alerts/${input.alertId}/acknowledge`, {
          method: "POST",
          body: JSON.stringify({ notes: input.notes, acknowledgedBy: ctx.user.id }),
        }
      );
      if (!result.ok) return { available: false, success: false };
      return { available: true, success: true };
    }),

  escalateAlert: adminProcedure
    .input(z.object({
      alertId: z.string().min(1),
      escalateTo: z.string().max(200),
      reason: z.string().max(1000),
    }))
    .mutation(async ({ ctx, input }) => {
      const result = await callService<{ success: boolean; escalationRef: string }>(
        process.env.AML_ALERT_SUBSCRIBER_URL ?? "http://localhost:8016",
        `/alerts/${input.alertId}/escalate`, {
          method: "POST",
          body: JSON.stringify({ ...input, escalatedBy: ctx.user.id }),
        }
      );
      if (!result.ok) return { available: false, success: false, escalationRef: "" };
      return { available: true, ...result.data };
    }),

  getMetrics: adminProcedure.query(async () => {
    const result = await callService<{
      alertsToday: number; alertsThisWeek: number; avgResolutionTimeHours: number;
    }>(process.env.AML_ALERT_SUBSCRIBER_URL ?? "http://localhost:8016", "/metrics");
    if (!result.ok) return { available: false, alertsToday: 0, alertsThisWeek: 0, avgResolutionTimeHours: 0 };
    return { available: true, ...result.data };
  }),
});

// ─── OpenSearch Sync ──────────────────────────────────────────────────────────
const opensearchSyncRouter = router({
  health: publicProcedure.query(async () => {
    const result = await callService<{ status: string }>(
      ENV.opensearchUrl, "/health"
    );
    if (!result.ok) return { available: false, status: "unreachable" };
    return { available: true, ...result.data };
  }),


  getReindexStatus: adminProcedure
    .input(z.object({ jobId: z.string().min(1) }))
    .query(async ({ input }) => {
      const result = await callService<{ status: string; progress: number; documentsIndexed: number }>(
        process.env.OPENSEARCH_SYNC_URL ?? "http://localhost:8017", `/reindex/${input.jobId}`
      );
      if (!result.ok) return { available: false, status: "unknown", progress: 0, documentsIndexed: 0 };
      return { available: true, ...result.data };
    }),

  getSyncLag: adminProcedure.query(async () => {
    const result = await callService<{ lagSeconds: number; lastEventAt: string; pendingEvents: number }>(
      process.env.OPENSEARCH_SYNC_URL ?? "http://localhost:8017", "/lag"
    );
    if (!result.ok) return { available: false, lagSeconds: -1, lastEventAt: "", pendingEvents: -1 };
    return { available: true, ...result.data };
  }),
});

// ─── Middleware Hub ───────────────────────────────────────────────────────────
const middlewareHubRouter = router({
  health: publicProcedure.query(async () => {
    const result = await callService<{ status: string }>(
      ENV.channelGatewayUrl, "/health"
    );
    if (!result.ok) return { available: false, status: "unreachable" };
    return { available: true, ...result.data };
  }),
  getMetrics: adminProcedure.query(async () => {
    const result = await callService<{
      requestsPerSecond: number; avgLatencyMs: number; errorRate: number; activeConnections: number;
    }>(ENV.channelGatewayUrl, "/metrics");
    if (!result.ok) return { available: false, requestsPerSecond: 0, avgLatencyMs: 0, errorRate: 0, activeConnections: 0 };
    return { available: true, ...result.data };
  }),
  getCircuitBreakers: adminProcedure.query(async () => {
    const result = await callService<{ breakers: unknown[] }>(
      ENV.channelGatewayUrl, "/circuit-breakers"
    );
    if (!result.ok) return { available: false, breakers: [] };
    return { available: true, ...result.data };
  }),
  resetCircuitBreaker: adminProcedure
    .input(z.object({ breakerName: z.string().min(1) }))
    .mutation(async ({ input }) => {
      const result = await callService<{ success: boolean }>(
        ENV.channelGatewayUrl, `/circuit-breakers/${input.breakerName}/reset`, { method: "POST" }
      );
      if (!result.ok) return { available: false, success: false };
      return { available: true, success: true };
    }),

});

// ─── Bot Logic (supplemental — beyond telegramRouter) ────────────────────────
const botLogicRouter = router({
  health: publicProcedure.query(async () => {
    const result = await callService<{ status: string }>(
      ENV.botLogicUrl, "/health"
    );
    if (!result.ok) return { available: false, status: "unreachable" };
    return { available: true, ...result.data };
  }),


  getConversationLogs: adminProcedure
    .input(z.object({
      channel: z.enum(["telegram", "whatsapp", "ussd"]).optional(),
      userId: z.number().int().positive().optional(),
      limit: z.number().int().min(1).max(200).default(50),
    }))
    .query(async ({ input }) => {
      const params = new URLSearchParams();
      if (input.channel) params.set("channel", input.channel);
      if (input.userId) params.set("userId", String(input.userId));
      params.set("limit", String(input.limit));
      const result = await callService<{ logs: unknown[]; total: number }>(
        ENV.botLogicUrl, `/conversations?${params}`
      );
      if (!result.ok) return { available: false, logs: [], total: 0 };
      return { available: true, ...result.data };
    }),

  getBotMetrics: adminProcedure.query(async () => {
    const result = await callService<{
      messagesProcessed: number; activeUsers: number; avgResponseTimeMs: number;
    }>(ENV.botLogicUrl, "/metrics");
    if (!result.ok) return { available: false, messagesProcessed: 0, activeUsers: 0, avgResponseTimeMs: 0 };
    return { available: true, ...result.data };
  }),
});

// ─── Unified microservices router ─────────────────────────────────────────────
export const microservicesRouter = router({
  creditScoring: creditScoringRouter,
  fraudEngine: fraudEngineRouter,
  cryptoGuard: cryptoGuardRouter,
  ddosGuard: ddosGuardRouter,
  amlAlertSubscriber: amlAlertSubscriberRouter,
  opensearchSync: opensearchSyncRouter,
  middlewareHub: middlewareHubRouter,
  botLogic: botLogicRouter,
});
