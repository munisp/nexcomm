/**
 * NEXCOM Exchange — Health Router
 * Provides a public tRPC procedure for checking database and server health.
 * Used by the frontend to show connection status and by ops for monitoring.
 */
import { writeAuditLog } from "../audit";
import { publicProcedure, protectedProcedure, router } from "../_core/trpc";
import { z } from "zod";
import { getDb } from "../db";

export const healthRouter = router({
  /**
   * Returns server status, database connectivity, and version info.
   * Public — no authentication required.
   */
  check: publicProcedure.query(async () => {
    const start = Date.now();
    let dbConnected = false;
    let dbLatencyMs: number | null = null;
    let dbError: string | null = null;

    try {
      const db = await getDb();
      if (db) {
        const dbStart = Date.now();
        // Simple connectivity check — select 1
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
      database: {
        connected: dbConnected,
        latencyMs: dbLatencyMs,
        error: dbError,
        dialect: "postgresql",
      },
      version: {
        node: process.version,
        env: process.env.NODE_ENV ?? "unknown",
      },
    };
  }),

  list: publicProcedure
    .query(async () => {
      return { services: [], timestamp: new Date().toISOString() };
    }),
  create: protectedProcedure
    .input(z.object({ service: z.string(), status: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await writeAuditLog(ctx.user.id, "health.create", input);
      return { success: true };
    }),
  update: protectedProcedure
    .input(z.object({ service: z.string(), status: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await writeAuditLog(ctx.user.id, "health.update", input);
      return { success: true };
    }),
  delete: protectedProcedure
    .input(z.object({ service: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await writeAuditLog(ctx.user.id, "health.delete", input);
      return { success: true };
    }),
});
