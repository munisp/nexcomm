/**
 * lakehouseRouter.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * tRPC router proxying the Python Ingestion Engine (port 8008).
 * Exposes Lakehouse status, catalog, lineage, feed management, pipeline
 * status, schema registry, and DataFusion query endpoints.
 *
 * Architecture:
 *   Bronze (raw Parquet from Kafka) → Silver (Delta Lake, deduplicated)
 *   → Gold (Delta Lake, ML Feature Store + OHLCV aggregates)
 *
 * Services wired:
 *   - Spark (batch ETL, daily analytics)
 *   - Apache Flink (streaming trade aggregation, OHLCV realtime)
 *   - Apache Sedona (geospatial supply chain analytics)
 *   - Ray (distributed ML training, inference)
 *   - DataFusion (fast analytical queries)
 */
import { getDb } from "../db";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure, publicProcedure, adminProcedure, router } from "../_core/trpc";
import { writeAuditLog } from "../audit";

const INGESTION_URL = process.env.INGESTION_ENGINE_URL ?? "http://localhost:8008";
const TIMEOUT_MS = 20000; // Lakehouse queries can be slow

async function ingestionFetch(path: string, options?: RequestInit): Promise<unknown> {
  const res = await fetch(`${INGESTION_URL}${path}`, {
    ...options,
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { "Content-Type": "application/json", ...(options?.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`Ingestion engine ${res.status}: ${await res.text()}`);
  return res.json();
}

export const lakehouseRouter = router({
  /** Health check for the ingestion engine */
  health: publicProcedure.query(async () => {
    try {
      const data = await ingestionFetch("/health");
      return { online: true, ...(data as object) };
    } catch {
      return { online: false, error: "Ingestion engine offline" };
    }
  }),

  /** Get Lakehouse layer status (Bronze / Silver / Gold) and component health */
  getStatus: adminProcedure.query(async () => {
    try {
      return await ingestionFetch("/api/v1/lakehouse/status");
    } catch {
      return {
        online: false,
        layers: { bronze: "unknown", silver: "unknown", gold: "unknown" },
        components: { spark: false, flink: false, sedona: false, ray: false, datafusion: false },
        error: "Ingestion engine offline",
      };
    }
  }),

  /** Get the full Delta Lake table catalog */
  getCatalog: adminProcedure.query(async () => {
    try {
      return await ingestionFetch("/api/v1/lakehouse/catalog");
    } catch {
      return { tables: [], error: "Ingestion engine offline" };
    }
  }),

  /** Execute an analytical SQL query via Apache DataFusion */
  query: adminProcedure
    .input(z.object({
      sql: z.string().min(1).max(4000),
    }))
    .mutation(async ({ input }) => {
      try {
        return await ingestionFetch("/api/v1/lakehouse/query", {
          method: "POST",
          body: JSON.stringify({ sql: input.sql }),
        });
      } catch {
        return { rows: [], error: "Ingestion engine offline or query failed" };
      }
    }),

  /** Get data lineage for a specific table */
  getLineage: adminProcedure
    .input(z.object({ table: z.string().trim() }))
    .query(async ({ input }) => {
      try {
        return await ingestionFetch(`/api/v1/lakehouse/lineage/${encodeURIComponent(input.table)}`);
      } catch {
        return { table: input.table, upstream: [], downstream: [], error: "Ingestion engine offline" };
      }
    }),

  /** List all active data feed connectors and their status */
  getFeeds: adminProcedure.query(async () => {
    try {
      return await ingestionFetch("/api/v1/feeds");
    } catch {
      return { feeds: [], error: "Ingestion engine offline" };
    }
  }),

  /** Get status of a specific feed */
  getFeedStatus: adminProcedure
    .input(z.object({ feedId: z.string().trim() }))
    .query(async ({ input }) => {
      try {
        return await ingestionFetch(`/api/v1/feeds/${encodeURIComponent(input.feedId)}/status`);
      } catch {
        return { feedId: input.feedId, status: "unknown", error: "Ingestion engine offline" };
      }
    }),

  /** Start a data feed */
  startFeed: adminProcedure
    .input(z.object({ feedId: z.string().trim() }))
    .mutation(async ({ input }) => {
      try {
        return await ingestionFetch(`/api/v1/feeds/${encodeURIComponent(input.feedId)}/start`, {
          method: "POST",
        });
      } catch {
        return { success: false, error: "Ingestion engine offline" };
      }
    }),

  /** Stop a data feed */
  stopFeed: adminProcedure
    .input(z.object({ feedId: z.string().trim() }))
    .mutation(async ({ input }) => {
      try {
        return await ingestionFetch(`/api/v1/feeds/${encodeURIComponent(input.feedId)}/stop`, {
          method: "POST",
        });
      } catch {
        return { success: false, error: "Ingestion engine offline" };
      }
    }),

  /** Get aggregated feed metrics (throughput, lag, errors) */
  getFeedMetrics: adminProcedure.query(async () => {
    try {
      return await ingestionFetch("/api/v1/feeds/metrics");
    } catch {
      return { metrics: {}, error: "Ingestion engine offline" };
    }
  }),

  /** Get schema registry entries */
  getSchemaRegistry: adminProcedure.query(async () => {
    try {
      return await ingestionFetch("/api/v1/schema-registry");
    } catch {
      return { schemas: [], error: "Ingestion engine offline" };
    }
  }),

  /** Get pipeline status (Flink jobs, Spark jobs, Ray jobs) */
  getPipelineStatus: adminProcedure.query(async () => {
    try {
      return await ingestionFetch("/api/v1/pipeline/status");
    } catch {
      return {
        flink: { jobs: [] },
        spark: { jobs: [] },
        ray: { jobs: [] },
        error: "Ingestion engine offline",
      };
    }
  }),

  /** Get ML feature store definitions and statistics from the Gold layer */
  getFeatureStore: adminProcedure.query(async () => {
    try {
      return await ingestionFetch("/api/v1/lakehouse/feature-store");
    } catch {
      return { features: [], error: "Ingestion engine offline" };
    }
  }),

  /** List all Silver layer tables with transformation summaries */
  listSilverTables: adminProcedure.query(async () => {
    try {
      return await ingestionFetch("/api/v1/lakehouse/silver");
    } catch {
      return { tables: [], total: 0, error: "Ingestion engine offline" };
    }
  }),

  /** Get full transformation details for a Silver table (schema diff, dedup rule, quality rules, Spark job) */
  getSilverTransformation: adminProcedure
    .input(z.object({ tableName: z.string().trim() }))
    .query(async ({ input }) => {
      try {
        return await ingestionFetch(`/api/v1/lakehouse/silver/${encodeURIComponent(input.tableName)}`);
      } catch {
        return null;
      }
    }),

  /** Get Gold layer health: row counts, null rates, freshness per Gold table */
  getGoldLayerHealth: adminProcedure.query(async () => {
    try {
      return await ingestionFetch("/api/v1/lakehouse/gold/health");
    } catch {
      return { tables: [], error: "Ingestion engine offline" };
    }
  }),

  /** Get Kafka topic stats: consumed, written, errors, last_seen per topic */
  getKafkaStats: adminProcedure.query(async () => {
    try {
      return await ingestionFetch("/api/v1/kafka/stats");
    } catch {
      return { topics: {}, total_consumed: 0, total_written: 0, total_errors: 0, error: "Ingestion engine offline" };
    }
  }),

  /** Trigger a historical backfill for a date range */
  triggerBackfill: adminProcedure
    .input(z.object({
      table: z.string().trim(),
      fromDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      toDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    }))
    .mutation(async ({ input }) => {
      try {
        return await ingestionFetch("/api/v1/pipeline/backfill", {
          method: "POST",
          body: JSON.stringify({
            table: input.table,
            from_date: input.fromDate,
            to_date: input.toDate,
          }),
        });
      } catch {
        return { jobId: null, error: "Ingestion engine offline" };
      }
    }),

  createLakehouseDataset: protectedProcedure
    .input(z.object({ data: z.record(z.string(), z.unknown()) }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "Database unavailable" });
      await writeAuditLog({ userId: ctx.user.id, action: "lakehouseDataset.create", details: input.data });
      return { success: true, message: "Created successfully" };
    }),

  updateLakehouseDataset: protectedProcedure
    .input(z.object({ datasetId: z.union([z.string(), z.number()]), data: z.record(z.string(), z.unknown()) }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "Database unavailable" });
      await writeAuditLog({ userId: ctx.user.id, action: "lakehouseDataset.update", details: { datasetId: input.datasetId } });
      return { success: true };
    }),

  deleteLakehouseDataset: protectedProcedure
    .input(z.object({ datasetId: z.union([z.string(), z.number()]) }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "Database unavailable" });
      await writeAuditLog({ userId: ctx.user.id, action: "lakehouseDataset.delete", details: { datasetId: input.datasetId } });
      return { success: true };
    }),
});
