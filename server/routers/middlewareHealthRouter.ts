/**
 * NEXCOM Exchange — Middleware Health Router
 * Provides real-time health status for all 11 middleware systems:
 * Keycloak, TigerBeetle, PostgreSQL, APISIX, Permify, Dapr,
 * Temporal, Redis, Lakehouse, OpenAppsec, Fluvio
 */
import { protectedProcedure, router } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { getDb } from "../db";
import { middlewareHealthLog } from "../../drizzle/schema";
import { desc, gte, eq, sql } from "drizzle-orm";
import { ENV } from "../_core/env";
import { writeAuditLog } from "../audit";

// ── Middleware service definitions ────────────────────────────────────────────
const MIDDLEWARE_SERVICES = [
  { name: "keycloak",      label: "Keycloak IAM",       healthUrl: `${ENV.oAuthServerUrl ?? "http://keycloak:8080"}/health/ready` },
  { name: "tigerbeetle",   label: "TigerBeetle Ledger", healthUrl: `${ENV.gatewayServiceUrl ?? "http://tigerbeetle-gateway:4000"}/health` },
  { name: "postgresql",    label: "PostgreSQL",          healthUrl: null /* checked via DB query */ },
  { name: "apisix",        label: "APISIX Gateway",     healthUrl: `${ENV.gatewayServiceUrl ?? "http://apisix:9080"}/apisix/admin/health` },
  { name: "permify",       label: "Permify AuthZ",      healthUrl: `${ENV.permifyUrl ?? "http://permify:3476"}/healthz` },
  { name: "dapr",          label: "Dapr Sidecar",       healthUrl: `${ENV.daprHttpUrl ?? "http://localhost:3500"}/v1.0/healthz` },
  { name: "temporal",      label: "Temporal Workflow",  healthUrl: `${ENV.temporalUrl ?? "http://temporal:7233"}/health` },
  { name: "redis",         label: "Redis Cache",        healthUrl: null /* checked via Redis client */ },
  { name: "lakehouse",     label: "Lakehouse / S3",     healthUrl: `${ENV.forgeApiUrl ?? "http://lakehouse:9000"}/health` },
  { name: "openappsec",    label: "OpenAppsec WAF",     healthUrl: "http://openappsec:8090/health" },
  { name: "fluvio",        label: "Fluvio Streaming",   healthUrl: "http://fluvio:9003/health" },
];

type ServiceName = typeof MIDDLEWARE_SERVICES[number]["name"];

// ── Health check helper ───────────────────────────────────────────────────────
type MiddlewareService = { name: string; label: string; healthUrl: string | null };
async function pingService(service: MiddlewareService): Promise<{
  service: string;
  label: string;
  status: "healthy" | "degraded" | "down";
  latencyMs: number;
  error?: string;
}> {
  const start = Date.now();

  // PostgreSQL: check via DB query
  if (service.name === "postgresql") {
    try {
      const db = await getDb();
      if (!db) throw new Error("DB unavailable");
      await db.execute(sql`SELECT 1`);
      return { service: service.name, label: service.label, status: "healthy", latencyMs: Date.now() - start };
    } catch (err) {
      return { service: service.name, label: service.label, status: "down", latencyMs: Date.now() - start, error: String(err) };
    }
  }

  // Redis: check via URL reachability
  if (service.name === "redis") {
    try {
      const { cacheGet } = await import("../cache");
      await cacheGet("__health_ping__");
      return { service: service.name, label: service.label, status: "healthy", latencyMs: Date.now() - start };
    } catch (err) {
      return { service: service.name, label: service.label, status: "down", latencyMs: Date.now() - start, error: String(err) };
    }
  }

  // All other services: HTTP GET with 3s timeout
  if (!service.healthUrl) {
    return { service: service.name, label: service.label, status: "down", latencyMs: 0, error: "No health URL configured" };
  }
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    const res = await fetch(service.healthUrl, { signal: controller.signal });
    clearTimeout(timeout);
    const latencyMs = Date.now() - start;
    if (res.ok) return { service: service.name, label: service.label, status: "healthy", latencyMs };
    return { service: service.name, label: service.label, status: "degraded", latencyMs, error: `HTTP ${res.status}` };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    const status = msg.includes("abort") ? "degraded" : "down";
    return { service: service.name, label: service.label, status, latencyMs: Date.now() - start, error: msg };
  }
}

// ── Router ────────────────────────────────────────────────────────────────────
export const middlewareHealthRouter = router({
  /**
   * Get the latest health status for all 11 middleware services.
   * Returns the most recent log entry per service plus a live ping.
   */
  getHealthStatus: protectedProcedure
    .query(async ({ ctx }) => {
      const db = await getDb();
      if (!db) return MIDDLEWARE_SERVICES.map((s) => ({ service: s.name, label: s.label, status: "unknown", latencyMs: null, errorMessage: null, checkedAt: null }));

      // Fetch latest log entry per service from DB
      const latestRows = await db
        .select()
        .from(middlewareHealthLog)
        .orderBy(desc(middlewareHealthLog.checkedAt))
        .limit(100);

      // Build a map of service → latest entry
      const latestByService = new Map<string, typeof latestRows[0]>();
      for (const row of latestRows) {
        if (!latestByService.has(row.service)) {
          latestByService.set(row.service, row);
        }
      }

      return MIDDLEWARE_SERVICES.map((svc) => {
        const latest = latestByService.get(svc.name);
        return {
          service: svc.name,
          label: svc.label,
          status: (latest?.status ?? "unknown") as string,
          latencyMs: latest?.latencyMs ?? null,
          errorMessage: latest?.errorMessage ?? null,
          checkedAt: latest?.checkedAt ?? null,
        };
      });
    }),

  /**
   * Get health history for a specific service (last 100 checks).
   */
  getHealthHistory: protectedProcedure
    .input(z.object({
      service: z.string(),
      limit: z.number().int().min(1).max(500).default(100),
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return [];
      const rows = await db
        .select()
        .from(middlewareHealthLog)
        .where(eq(middlewareHealthLog.service, input.service))
        .orderBy(desc(middlewareHealthLog.checkedAt))
        .limit(input.limit);
      return rows;
    }),

  /**
   * Get aggregate health summary: counts of healthy/degraded/down services.
   */
  getHealthSummary: protectedProcedure
    .query(async () => {
      const db = await getDb();
      if (!db) return { total: MIDDLEWARE_SERVICES.length, healthy: 0, degraded: 0, down: 0, unknown: MIDDLEWARE_SERVICES.length };
      const since = new Date(Date.now() - 5 * 60 * 1000); // last 5 minutes

      const rows = await db
        .select()
        .from(middlewareHealthLog)
        .where(gte(middlewareHealthLog.checkedAt, since))
        .orderBy(desc(middlewareHealthLog.checkedAt))
        .limit(200);

      const latestByService = new Map<string, typeof rows[0]>();
      for (const row of rows) {
        if (!latestByService.has(row.service)) {
          latestByService.set(row.service, row);
        }
      }

      let healthy = 0, degraded = 0, down = 0, unknown = 0;
      for (const svc of MIDDLEWARE_SERVICES) {
        const entry = latestByService.get(svc.name);
        if (!entry) { unknown++; continue; }
        if (entry.status === "healthy") healthy++;
        else if (entry.status === "degraded") degraded++;
        else down++;
      }

      return { total: MIDDLEWARE_SERVICES.length, healthy, degraded, down, unknown };
    }),

  /**
   * Trigger a live health check for all (or a specific) middleware service.
   * Persists results to middleware_health_log.
   */
  triggerHealthCheck: protectedProcedure
    .input(z.object({
      service: z.enum([
        "all",
        "keycloak", "tigerbeetle", "postgresql", "apisix", "permify",
        "dapr", "temporal", "redis", "lakehouse", "openappsec", "fluvio",
      ]),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const targets = input.service === "all"
        ? [...MIDDLEWARE_SERVICES]
        : MIDDLEWARE_SERVICES.filter((s) => s.name === input.service);

      // Run all pings in parallel
      const results = await Promise.all(targets.map(pingService));

      // Persist to middleware_health_log
      if (results.length > 0) {
        await db.insert(middlewareHealthLog).values(
          results.map((r) => ({
            service: r.service,
            status: r.status,
            latencyMs: r.latencyMs,
            errorMessage: r.error ?? null,
          }))
        );
      }

      await writeAuditLog({
        userId: ctx.user.id,
        action: "middleware.health_check",
        details: { service: input.service, results: results.map((r) => ({ service: r.service, status: r.status })) },
      });

      return { results };
    }),

  /**
   * Get the list of all monitored middleware services.
   */
  listServices: protectedProcedure
    .query(() => {
      return MIDDLEWARE_SERVICES.map((s) => ({ name: s.name, label: s.label }));
    }),
});
