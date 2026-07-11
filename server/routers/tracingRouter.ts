import { TRPCError } from "@trpc/server";
import { z } from "zod/v4";
import { adminProcedure, protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { traceSnapshots } from "../../drizzle/schema";
import { eq, desc, gte, lte, and, sql, lt, ilike } from "drizzle-orm";
import { writeAuditLog } from "../audit";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const OTLP_ENDPOINT =
  process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? "http://localhost:4318";

/** Fetch traces from Jaeger/Tempo HTTP API (if available) */
async function fetchFromCollector(path: string): Promise<unknown | null> {
  try {
    const res = await fetch(`${OTLP_ENDPOINT}${path}`, {
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

// ─── Router ──────────────────────────────────────────────────────────────────

export const tracingRouter = router({
  /** List recent traces from the local DB snapshot store */
  getTraces: adminProcedure
    .input(
      z.object({
        serviceName:   z.string().optional(),
        operationName: z.string().optional(),
        minDurationMs: z.number().int().optional(),
        maxDurationMs: z.number().int().optional(),
        statusCode:    z.enum(["OK", "ERROR", "UNSET"]).optional(),
        fromMs:        z.number().int().optional(),
        toMs:          z.number().int().optional(),
        limit:         z.number().int().min(1).max(200).default(50),
        offset:        z.number().int().min(0).default(0),
      })
    )
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const conditions = [];
      if (input.serviceName)   conditions.push(eq(traceSnapshots.serviceName, input.serviceName));
      if (input.operationName) conditions.push(ilike(traceSnapshots.operationName, `%${input.operationName}%`));
      if (input.statusCode)    conditions.push(eq(traceSnapshots.statusCode, input.statusCode));
      if (input.minDurationMs !== undefined)
        conditions.push(gte(traceSnapshots.durationMs, input.minDurationMs));
      if (input.maxDurationMs !== undefined)
        conditions.push(lte(traceSnapshots.durationMs, input.maxDurationMs));
      if (input.fromMs !== undefined)
        conditions.push(gte(traceSnapshots.startTimeMs, input.fromMs));
      if (input.toMs !== undefined)
        conditions.push(lte(traceSnapshots.startTimeMs, input.toMs));

      const rows = await db
        .select()
        .from(traceSnapshots)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(traceSnapshots.startTimeMs))
        .limit(input.limit)
        .offset(input.offset);

      const [{ count }] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(traceSnapshots)
        .where(conditions.length > 0 ? and(...conditions) : undefined);

      return { traces: rows, total: count };
    }),

  /** Get all spans for a single trace ID */
  getTraceDetail: adminProcedure
    .input(z.object({ traceId: z.string().min(1) }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const spans = await db
        .select()
        .from(traceSnapshots)
        .where(eq(traceSnapshots.traceId, input.traceId))
        .orderBy(traceSnapshots.startTimeMs);

      if (spans.length === 0)
        throw new TRPCError({ code: "NOT_FOUND", message: "Trace not found" });

      // Build waterfall tree
      const root = spans.find((s) => !s.parentSpanId) ?? spans[0];
      const totalDurationMs = Math.max(...spans.map((s) => s.startTimeMs + s.durationMs)) - root.startTimeMs;

      return { traceId: input.traceId, rootSpan: root, spans, totalDurationMs };
    }),

  /** Service dependency map derived from trace data */
  getServiceMap: adminProcedure
    .input(z.object({ windowHours: z.number().int().min(1).max(168).default(24) }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const fromMs = Date.now() - input.windowHours * 3600 * 1000;

      const services = await db
        .select({
          serviceName:    traceSnapshots.serviceName,
          spanCount:      sql<number>`count(*)::int`,
          errorCount:     sql<number>`sum(case when status_code = 'ERROR' then 1 else 0 end)::int`,
          avgDurationMs:  sql<number>`avg(duration_ms)::int`,
          p99DurationMs:  sql<number>`percentile_cont(0.99) within group (order by duration_ms)::int`,
        })
        .from(traceSnapshots)
        .where(gte(traceSnapshots.startTimeMs, fromMs))
        .groupBy(traceSnapshots.serviceName)
        .orderBy(desc(sql`count(*)`));

      const operations = await db
        .select({
          serviceName:    traceSnapshots.serviceName,
          operationName:  traceSnapshots.operationName,
          callCount:      sql<number>`count(*)::int`,
          errorRate:      sql<number>`round(100.0 * sum(case when status_code = 'ERROR' then 1 else 0 end) / count(*), 2)::float`,
          avgDurationMs:  sql<number>`avg(duration_ms)::int`,
        })
        .from(traceSnapshots)
        .where(gte(traceSnapshots.startTimeMs, fromMs))
        .groupBy(traceSnapshots.serviceName, traceSnapshots.operationName)
        .orderBy(desc(sql`count(*)`))
        .limit(100);

      return { services, operations, windowHours: input.windowHours };
    }),

  /** Top slow operations in the last N hours */
  getSlowOperations: adminProcedure
    .input(
      z.object({
        windowHours:   z.number().int().min(1).max(168).default(24),
        minDurationMs: z.number().int().default(500),
        limit:         z.number().int().min(1).max(100).default(20),
      })
    )
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const fromMs = Date.now() - input.windowHours * 3600 * 1000;

      const slow = await db
        .select()
        .from(traceSnapshots)
        .where(
          and(
            gte(traceSnapshots.startTimeMs, fromMs),
            gte(traceSnapshots.durationMs, input.minDurationMs)
          )
        )
        .orderBy(desc(traceSnapshots.durationMs))
        .limit(input.limit);

      return { operations: slow, windowHours: input.windowHours, minDurationMs: input.minDurationMs };
    }),

  /** Ingest a batch of spans (called by OTel collector sidecar or test harness) */
  ingestTrace: protectedProcedure
    .input(
      z.object({
        spans: z.array(
          z.object({
            traceId:       z.string(),
            spanId:        z.string(),
            parentSpanId:  z.string().optional(),
            operationName: z.string(),
            serviceName:   z.string(),
            startTimeMs:   z.number().int(),
            durationMs:    z.number().int(),
            statusCode:    z.string().default("OK"),
            errorMessage:  z.string().optional(),
            attributes:    z.record(z.string(), z.unknown()).optional(),
            events:        z.array(z.unknown()).optional(),
          })
        ).max(500),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      if (input.spans.length === 0) return { inserted: 0 };

      await db.insert(traceSnapshots).values(
        input.spans.map((s) => ({
          traceId:       s.traceId,
          spanId:        s.spanId,
          parentSpanId:  s.parentSpanId ?? null,
          operationName: s.operationName,
          serviceName:   s.serviceName,
          startTimeMs:   s.startTimeMs,
          durationMs:    s.durationMs,
          statusCode:    s.statusCode,
          errorMessage:  s.errorMessage ?? null,
          attributes:    s.attributes ?? null,
          events:        s.events ?? null,
        }))
      );

      await writeAuditLog({
        userId:     ctx.user.id,
        action:     "TRACE_INGEST",
        resource:   "traceSnapshots",
        resourceId: input.spans[0].traceId,
        details:    { spanCount: input.spans.length },
      });

      return { inserted: input.spans.length };
    }),

  /** Purge old traces (admin only) */
  purgeOldTraces: adminProcedure
    .input(z.object({ olderThanHours: z.number().int().min(1).max(8760).default(168) }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const cutoffMs = Date.now() - input.olderThanHours * 3600 * 1000;
      const cutoffDate = new Date(cutoffMs);

      const result = await db
        .delete(traceSnapshots)
        .where(lt(traceSnapshots.capturedAt, cutoffDate));

      await writeAuditLog({
        userId:   ctx.user.id,
        action:   "TRACE_PURGE",
        resource: "traceSnapshots",
        details:  { olderThanHours: input.olderThanHours },
      });

      return { success: true, message: `Purged traces older than ${input.olderThanHours}h` };
    }),
});
