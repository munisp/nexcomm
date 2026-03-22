/**
 * participantPerformanceRouter.ts
 * tRPC procedures for broker and market maker performance metrics.
 * Tracks monthly volume, client counts, ratings, and compliance scores.
 */
import { z } from "zod";
import { protectedProcedure, adminProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { participantPerformanceMetrics } from "../../drizzle/schema";
import { eq, desc, and } from "drizzle-orm";

const PARTICIPANT_TYPE_VALUES = ["BROKER", "MARKET_MAKER"] as const;

export const participantPerformanceRouter = router({
  /**
   * Get performance metrics for the current authenticated user.
   */
  getMyMetrics: protectedProcedure
    .input(z.object({
      participantType: z.enum(PARTICIPANT_TYPE_VALUES),
      limit: z.number().int().min(1).max(24).default(12),
    }))
    .query(async ({ ctx, input }) => {
      try {
        const db = await getDb();
        if (!db) return [];

        const rows = await db
          .select()
          .from(participantPerformanceMetrics)
          .where(
            and(
              eq(participantPerformanceMetrics.userId, ctx.user.id),
              eq(participantPerformanceMetrics.participantType, input.participantType),
            )
          )
          .orderBy(desc(participantPerformanceMetrics.periodYear), desc(participantPerformanceMetrics.periodMonth))
          .limit(input.limit);

        return rows;
      } catch {
        return [];
      }
    }),

  /**
   * List all performance metrics (admin only).
   * Supports filtering by participant type and period.
   */
  adminList: adminProcedure
    .input(z.object({
      participantType: z.enum(PARTICIPANT_TYPE_VALUES).optional(),
      periodYear: z.number().int().optional(),
      periodMonth: z.number().int().min(1).max(12).optional(),
      limit: z.number().int().min(1).max(200).default(100),
      offset: z.number().int().min(0).default(0),
    }))
    .query(async ({ input }) => {
      try {
        const db = await getDb();
        if (!db) return { metrics: [], total: 0 };

        const conditions = [];
        if (input.participantType) conditions.push(eq(participantPerformanceMetrics.participantType, input.participantType));
        if (input.periodYear) conditions.push(eq(participantPerformanceMetrics.periodYear, input.periodYear));
        if (input.periodMonth) conditions.push(eq(participantPerformanceMetrics.periodMonth, input.periodMonth));

        const query = db
          .select()
          .from(participantPerformanceMetrics)
          .orderBy(
            desc(participantPerformanceMetrics.periodYear),
            desc(participantPerformanceMetrics.periodMonth),
          )
          .limit(input.limit)
          .offset(input.offset);

        const rows = conditions.length > 0
          ? await query.where(and(...conditions))
          : await query;

        return { metrics: rows, total: rows.length };
      } catch {
        return { metrics: [], total: 0 };
      }
    }),

  /**
   * Upsert performance metrics for a participant (admin only).
   * Creates a new record or updates existing one for the same user + participant type + period.
   */
  upsertMetrics: adminProcedure
    .input(z.object({
      userId: z.number().int().positive(),
      participantType: z.enum(PARTICIPANT_TYPE_VALUES),
      periodYear: z.number().int().min(2020).max(2100),
      periodMonth: z.number().int().min(1).max(12),
      tradeCount: z.number().int().min(0).optional(),
      volumeUsd: z.number().min(0).optional(),
      clientCount: z.number().int().min(0).optional(),
      avgSpread: z.number().min(0).optional(),
      uptimePct: z.number().min(0).max(100).optional(),
      rating: z.number().min(0).max(5).optional(),
      complianceScore: z.number().int().min(0).max(100).optional(),
      notes: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database unavailable");

      await db
        .insert(participantPerformanceMetrics)
        .values({
          userId: input.userId,
          participantType: input.participantType,
          periodYear: input.periodYear,
          periodMonth: input.periodMonth,
          tradeCount: input.tradeCount ?? 0,
          volumeUsd: input.volumeUsd?.toFixed(2) ?? "0",
          clientCount: input.clientCount ?? 0,
          avgSpread: input.avgSpread?.toFixed(4) ?? null,
          uptimePct: input.uptimePct?.toFixed(2) ?? null,
          rating: input.rating?.toFixed(2) ?? null,
          complianceScore: input.complianceScore ?? 100,
          notes: input.notes ?? null,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [
            participantPerformanceMetrics.userId,
            participantPerformanceMetrics.participantType,
            participantPerformanceMetrics.periodYear,
            participantPerformanceMetrics.periodMonth,
          ],
          set: {
            tradeCount: input.tradeCount ?? 0,
            volumeUsd: input.volumeUsd?.toFixed(2) ?? "0",
            clientCount: input.clientCount ?? 0,
            avgSpread: input.avgSpread?.toFixed(4) ?? null,
            uptimePct: input.uptimePct?.toFixed(2) ?? null,
            rating: input.rating?.toFixed(2) ?? null,
            complianceScore: input.complianceScore ?? 100,
            notes: input.notes ?? null,
            updatedAt: new Date(),
          },
        });

      return { success: true };
    }),

  /**
   * Delete a performance metric record (admin only).
   */
  deleteMetrics: adminProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database unavailable");

      await db.delete(participantPerformanceMetrics).where(eq(participantPerformanceMetrics.id, input.id));
      return { success: true };
    }),
});
