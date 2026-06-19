import { TRPCError } from "@trpc/server";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { getDb } from "../db";
import { velocityLimitConfig, velocityLedger, notifications, securityEvents } from "../../drizzle/schema";
import { protectedProcedure, router } from "../_core/trpc";
import { z } from "zod";
import { writeAuditLog } from "../audit";

const DEFAULT_LIMIT_NGN = 5_000_000; // ₦5M per 24h by default
const DEFAULT_WINDOW_HOURS = 24;

async function getActiveLimit(db: NonNullable<Awaited<ReturnType<typeof getDb>>>, userId: number, currency: string) {
  const [userLimit] = await db
    .select()
    .from(velocityLimitConfig)
    .where(
      and(
        eq(velocityLimitConfig.userId, userId),
        eq(velocityLimitConfig.isActive, true),
        eq(velocityLimitConfig.currency, currency)
      )
    );

  if (userLimit) return userLimit;

  const [globalLimit] = await db
    .select()
    .from(velocityLimitConfig)
    .where(
      and(
        sql`${velocityLimitConfig.userId} IS NULL`,
        eq(velocityLimitConfig.isActive, true),
        eq(velocityLimitConfig.currency, currency)
      )
    );

  return globalLimit ?? null;
}

async function getUsedAmount(db: NonNullable<Awaited<ReturnType<typeof getDb>>>, userId: number, currency: string, windowHours: number): Promise<number> {
  const windowStart = new Date(Date.now() - windowHours * 60 * 60 * 1000);

  const [sumResult] = await db
    .select({ total: sql<string>`COALESCE(SUM(${velocityLedger.amount}), 0)` })
    .from(velocityLedger)
    .where(
      and(
        eq(velocityLedger.userId, userId),
        eq(velocityLedger.currency, currency),
        gte(velocityLedger.recordedAt, windowStart)
      )
    );

  return parseFloat(sumResult?.total ?? "0");
}

export const velocityLimitRouter = router({
  // Check if a proposed withdrawal amount would breach the velocity limit
  checkLimit: protectedProcedure
    .input(
      z.object({
        amount: z.number().positive(),
        currency: z.string().default("NGN"),
      })
    )
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable — please try again" });

      const activeLimit = await getActiveLimit(db, ctx.user.id, input.currency);
      const limitAmount = activeLimit ? parseFloat(activeLimit.maxAmount) : DEFAULT_LIMIT_NGN;
      const windowHours = activeLimit?.windowHours ?? DEFAULT_WINDOW_HOURS;
      const usedAmount = await getUsedAmount(db, ctx.user.id, input.currency, windowHours);
      const remaining = Math.max(0, limitAmount - usedAmount);
      const allowed = input.amount <= remaining;

      return {
        allowed,
        remaining,
        limitAmount,
        usedAmount,
        windowHours,
        windowStart: new Date(Date.now() - windowHours * 60 * 60 * 1000),
      };
    }),

  // Record a completed withdrawal for velocity tracking
  recordWithdrawal: protectedProcedure
    .input(
      z.object({
        amount: z.number().positive(),
        currency: z.string().default("NGN"),
        reference: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable — please try again" });

      const activeLimit = await getActiveLimit(db, ctx.user.id, input.currency);
      const limitAmount = activeLimit ? parseFloat(activeLimit.maxAmount) : DEFAULT_LIMIT_NGN;
      const windowHours = activeLimit?.windowHours ?? DEFAULT_WINDOW_HOURS;
      const usedAmount = await getUsedAmount(db, ctx.user.id, input.currency, windowHours);
      const newTotal = usedAmount + input.amount;

      if (newTotal > limitAmount) {
        await db.insert(securityEvents).values({
          userId: ctx.user.id,
          eventType: "LARGE_WITHDRAWAL",
          severity: "HIGH",
          title: "Withdrawal Velocity Limit Exceeded",
          description: `Withdrawal velocity limit exceeded: attempted ₦${input.amount.toLocaleString()}, limit ₦${limitAmount.toLocaleString()} per ${windowHours}h`,
          metadata: JSON.stringify({ amount: input.amount, limitAmount, usedAmount, windowHours }),
          status: "OPEN",
        });

        await db.insert(notifications).values({
          userId: ctx.user.id,
          title: "Withdrawal Blocked — Velocity Limit Reached",
          message: `Your ₦${input.amount.toLocaleString()} withdrawal was blocked. You have used ₦${usedAmount.toLocaleString()} of your ₦${limitAmount.toLocaleString()} / ${windowHours}h limit.`,
          type: "SECURITY_ALERT",
        });

        throw new TRPCError({
          code: "FORBIDDEN",
          message: `Withdrawal exceeds your ${windowHours}-hour velocity limit. Remaining: ₦${Math.max(0, limitAmount - usedAmount).toLocaleString()}`,
        });
      }

      await db.insert(velocityLedger).values({
        userId: ctx.user.id,
        amount: input.amount.toString(),
        currency: input.currency,
        reference: input.reference ?? null,
        recordedAt: new Date(),
      });

      await writeAuditLog({
        userId: ctx.user.id,
        action: "VELOCITY_LEDGER_RECORD",
        resource: "velocity_ledger",
        details: { amount: input.amount, currency: input.currency, reference: input.reference },
      });

      return {
        success: true,
        newTotal,
        remaining: Math.max(0, limitAmount - newTotal),
        limitAmount,
      };
    }),

  // Get the current velocity usage for the logged-in user
  myUsage: protectedProcedure
    .input(z.object({ currency: z.string().default("NGN") }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable — please try again" });

      const activeLimit = await getActiveLimit(db, ctx.user.id, input.currency);
      const limitAmount = activeLimit ? parseFloat(activeLimit.maxAmount) : DEFAULT_LIMIT_NGN;
      const windowHours = activeLimit?.windowHours ?? DEFAULT_WINDOW_HOURS;
      const usedAmount = await getUsedAmount(db, ctx.user.id, input.currency, windowHours);
      const remaining = Math.max(0, limitAmount - usedAmount);
      const percentage = Math.min(100, (usedAmount / limitAmount) * 100);

      return { usedAmount, limitAmount, windowHours, remaining, percentage, currency: input.currency };
    }),

  // Get recent velocity ledger entries for the current user
  myHistory: protectedProcedure
    .input(z.object({ currency: z.string().default("NGN"), limit: z.number().int().max(50).default(20) }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable — please try again" });

      return db
        .select()
        .from(velocityLedger)
        .where(
          and(
            eq(velocityLedger.userId, ctx.user.id),
            eq(velocityLedger.currency, input.currency)
          )
        )
        .orderBy(desc(velocityLedger.recordedAt))
        .limit(input.limit);
    }),

  // Admin: list all velocity limit configurations
  adminListLimits: protectedProcedure.query(async ({ ctx }) => {
    if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable — please try again" });

    return db
      .select()
      .from(velocityLimitConfig)
      .orderBy(desc(velocityLimitConfig.createdAt));
  }),

  // Admin: create or update a velocity limit
  adminSetLimit: protectedProcedure
    .input(
      z.object({
        userId: z.number().int().positive().optional(),
        windowHours: z.number().int().min(1).max(168).default(24),
        maxAmount: z.number().positive(),
        currency: z.string().default("NGN"),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable — please try again" });

      // Deactivate any existing limit for this user/global scope
      if (input.userId) {
        await db
          .update(velocityLimitConfig)
          .set({ isActive: false })
          .where(
            and(
              eq(velocityLimitConfig.userId, input.userId),
              eq(velocityLimitConfig.currency, input.currency),
              eq(velocityLimitConfig.isActive, true)
            )
          );
      } else {
        await db
          .update(velocityLimitConfig)
          .set({ isActive: false })
          .where(
            and(
              sql`${velocityLimitConfig.userId} IS NULL`,
              eq(velocityLimitConfig.currency, input.currency),
              eq(velocityLimitConfig.isActive, true)
            )
          );
      }

      const [newLimit] = await db
        .insert(velocityLimitConfig)
        .values({
          userId: input.userId ?? null,
          windowHours: input.windowHours,
          maxAmount: input.maxAmount.toString(),
          currency: input.currency,
          isActive: true,
          createdBy: ctx.user.id,
        })
        .returning();

      return newLimit;
    }),

  // Admin: deactivate a velocity limit
  adminDeactivateLimit: protectedProcedure
    .input(z.object({ limitId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable — please try again" });

      await db
        .update(velocityLimitConfig)
        .set({ isActive: false })
        .where(eq(velocityLimitConfig.id, input.limitId));

      return { success: true };
    }),
});
