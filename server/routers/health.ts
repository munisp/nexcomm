/**
 * NEXCOM Exchange — Health Router
 * Shallow check: database + server.
 * Deep check: pings all 25 downstream microservices in parallel.
 */
import { writeAuditLog } from "../audit";
import { publicProcedure, protectedProcedure, router } from "../_core/trpc";
import { z } from "zod";
import { getDb } from "../db";
import { ENV } from "../_core/env";

const SERVICES: { name: string; url: string }[] = [
  { name: "core-banking",         url: ENV.coreBankingUrl },
  { name: "channel-gateway",      url: ENV.channelGatewayUrl },
  { name: "bot-logic",            url: ENV.botLogicUrl },
  { name: "ussd-engine",          url: ENV.ussdEngineUrl },
  { name: "indices-service",      url: ENV.indicesServiceUrl },
  { name: "ai-ml-service",        url: ENV.aiMlServiceUrl },
  { name: "analytics-engine",     url: ENV.analyticsEngineUrl },
  { name: "kyc-service",          url: ENV.kycServiceUrl },
  { name: "trading-engine",       url: ENV.tradingEngineUrl },
  { name: "risk-service",         url: ENV.riskServiceUrl },
  { name: "mojaloop-adapter",     url: ENV.mojaloopAdapterUrl },
  { name: "user-management",      url: ENV.userManagementUrl },
  { name: "ingestion-engine",     url: ENV.ingestionEngineUrl },
  { name: "notification-service", url: ENV.notificationServiceUrl },
  { name: "gateway-service",      url: ENV.gatewayServiceUrl },
  { name: "blockchain-service",   url: ENV.blockchainServiceUrl },
  { name: "fraud-engine",         url: ENV.fraudEngineUrl },
  { name: "credit-scoring",       url: ENV.creditScoringUrl },
  { name: "opensearch",           url: ENV.opensearchUrl },
  { name: "temporal",             url: ENV.temporalUrl },
  { name: "tigerbeetle",          url: ENV.tigerBeetleUrl },
  { name: "dapr",                 url: ENV.daprHttpUrl },
  { name: "permify",              url: ENV.permifyUrl },
];

type ServiceStatus = {
  name: string;
  url: string;
  status: "up" | "down" | "unknown";
  latencyMs: number | null;
  error: string | null;
};

async function pingService(name: string, url: string): Promise<ServiceStatus> {
  if (!url || url.startsWith("http://localhost")) {
    return { name, url, status: "unknown", latencyMs: null, error: "URL not configured for this environment" };
  }
  const start = Date.now();
  try {
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), 3000);
    const res = await fetch(`${url}/health`, {
      signal: controller.signal,
      headers: { "x-internal-secret": ENV.internalSecret },
    });
    clearTimeout(tid);
    return {
      name, url,
      status: res.ok ? "up" : "down",
      latencyMs: Date.now() - start,
      error: res.ok ? null : `HTTP ${res.status}`,
    };
  } catch (e: unknown) {
    return {
      name, url,
      status: "down",
      latencyMs: Date.now() - start,
      error: e instanceof Error ? e.message : "Unknown error",
    };
  }
}

export const healthRouter = router({
  /** Shallow health check — DB + server only. */
  check: publicProcedure.query(async () => {
    const start = Date.now();
    let dbConnected = false;
    let dbLatencyMs: number | null = null;
    let dbError: string | null = null;
    try {
      const db = await getDb();
      if (db) {
        const dbStart = Date.now();
        await db.execute("SELECT 1 AS ok" as unknown as Parameters<typeof db.execute>[0]);
        dbLatencyMs = Date.now() - dbStart;
        dbConnected = true;
      } else {
        dbError = "DATABASE_URL not configured";
      }
    } catch (e) {
      dbError = e instanceof Error ? e.message : "Unknown database error";
    }
    return {
      status: "ok" as const,
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      responseMs: Date.now() - start,
      database: { connected: dbConnected, latencyMs: dbLatencyMs, error: dbError, dialect: "postgresql" },
      version: { node: process.version, env: process.env.NODE_ENV ?? "unknown" },
    };
  }),

  /** Deep health check — pings all 25 downstream microservices in parallel. */
  deep: publicProcedure.query(async () => {
    const start = Date.now();
    const results = await Promise.all(SERVICES.map((s) => pingService(s.name, s.url)));
    const up      = results.filter((r) => r.status === "up").length;
    const down    = results.filter((r) => r.status === "down").length;
    const unknown = results.filter((r) => r.status === "unknown").length;
    return {
      timestamp: new Date().toISOString(),
      totalMs: Date.now() - start,
      summary: {
        total: results.length,
        up,
        down,
        unknown,
        overallStatus: down > 0 ? ("degraded" as const) : ("healthy" as const),
      },
      services: results,
    };
  }),

  list: publicProcedure.query(async () => ({
    services: SERVICES.map((s) => ({ name: s.name, url: s.url })),
    timestamp: new Date().toISOString(),
  })),

  create: protectedProcedure
    .input(z.object({ service: z.string(), status: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await writeAuditLog({ userId: ctx.user.id, action: "health.create", details: input });
      return { success: true };
    }),

  update: protectedProcedure
    .input(z.object({ service: z.string(), status: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await writeAuditLog({ userId: ctx.user.id, action: "health.update", details: input });
      return { success: true };
    }),

  delete: protectedProcedure
    .input(z.object({ service: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await writeAuditLog({ userId: ctx.user.id, action: "health.delete", details: input });
      return { success: true };
    }),
});
