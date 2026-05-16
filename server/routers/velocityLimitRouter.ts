import { TRPCError } from "@trpc/server";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { getDb } from "../db";
import { velocityLimitConfig, velocityLedger, notifications, securityEvents } from "../../drizzle/schema";
import { protectedProcedure, router } from "../_core/trpc";
import { z } from "zod";
import { writeAuditLog } from "../audit";

const DEFAULT_LIMIT_NGN = 5_000_000; // ₦5M per 24h by default
const DEFAULT_WINDOW_HOURS = 24;

// ── In-memory fallback stores ─────────────────────────────────────────────────
type MemLimit = {
  id: number;
  userId: number | null;
  windowHours: number;
  maxAmount: string;
  currency: string;
  isActive: boolean;
  createdBy: number | null;
  createdAt: Date;
  updatedAt: Date;
};
type MemLedger = {
  id: number;
  userId: number;
  amount: string;
  currency: string;
  reference: string | null;
  recordedAt: Date;
};
const _memLimits = new Map<number, MemLimit>();
const _memLedger: MemLedger[] = [];
let _limSeq = 1;
let _ledSeq = 1;

function _getActiveLimit(userId: number, currency: string): MemLimit | null {
  // User-specific limit first
  for (const lim of _memLimits.values()) {
    if (lim.userId === userId && lim.currency === currency && lim.isActive) return lim;
  }
  // Global limit
  for (const lim of _memLimits.values()) {
    if (lim.userId === null && lim.currency === currency && lim.isActive) return lim;
  }
  return null;
}

function _getUsedAmount(userId: number, currency: string, windowHours: number): number {
  const windowStart = new Date(Date.now() - windowHours * 60 * 60 * 1000);
  let total = 0;
  for (const entry of _memLedger) {
    if (entry.userId === userId && entry.currency === currency && entry.recordedAt >= windowStart) {
      total += parseFloat(entry.amount);
    }
  }
  return total;
}
// ─────────────────────────────────────────────────────────────────────────────

async function getActiveLimit(db: Awaited<ReturnType<typeof getDb>>, userId: number, currency: string) {
  if (!db) return _getActiveLimit(userId, currency);

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

async function getUsedAmount(db: Awaited<ReturnType<typeof getDb>>, userId: number, currency: string, windowHours: number): Promise<number> {
  if (!db) return _getUsedAmount(userId, currency, windowHours);
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

      const activeLimit = await getActiveLimit(db, ctx.user.id, input.currency);
      const limitAmount = activeLimit ? parseFloat(activeLimit.maxAmount) : DEFAULT_LIMIT_NGN;
      const windowHours = activeLimit?.windowHours ?? DEFAULT_WINDOW_HOURS;
      const usedAmount = await getUsedAmount(db, ctx.user.id, input.currency, windowHours);
      const newTotal = usedAmount + input.amount;

      if (newTotal > limitAmount) {
        if (db) {
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
        }

        throw new TRPCError({
          code: "FORBIDDEN",
          message: `Withdrawal exceeds your ${windowHours}-hour velocity limit. Remaining: ₦${Math.max(0, limitAmount - usedAmount).toLocaleString()}`,
        });
      }

      if (db) {
        // Record the withdrawal in the velocity ledger
        await db.insert(velocityLedger).values({
          userId: ctx.user.id,
          amount: input.amount.toString(),
          currency: input.currency,
          reference: input.reference ?? null,
          recordedAt: new Date(),
        });
      } else {
        // In-memory fallback
        _memLedger.push({
          id: _ledSeq++,
          userId: ctx.user.id,
          amount: input.amount.toString(),
          currency: input.currency,
          reference: input.reference ?? null,
          recordedAt: new Date(),
        });
      }

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
      if (!db) {
        return _memLedger
          .filter(e => e.userId === ctx.user.id && e.currency === input.currency)
          .sort((a, b) => b.recordedAt.getTime() - a.recordedAt.getTime())
          .slice(0, input.limit);
      }

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
    if (!db) {
      return Array.from(_memLimits.values()).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    }

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

      if (!db) {
        // Deactivate existing limits for the same user+currency
        for (const lim of _memLimits.values()) {
          if (lim.userId === (input.userId ?? null) && lim.currency === input.currency && lim.isActive) {
            lim.isActive = false;
          }
        }
        const id = _limSeq++;
        const now = new Date();
        const newLimit: MemLimit = {
          id,
          userId: input.userId ?? null,
          windowHours: input.windowHours,
          maxAmount: input.maxAmount.toString(),
          currency: input.currency,
          isActive: true,
          createdBy: ctx.user.id,
          createdAt: now,
          updatedAt: now,
        };
        _memLimits.set(id, newLimit);
        return newLimit;
      }

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

      if (!db) {
        const lim = _memLimits.get(input.limitId);
        if (lim) lim.isActive = false;
        return { success: true };
      }

      await db
        .update(velocityLimitConfig)
        .set({ isActive: false })
        .where(eq(velocityLimitConfig.id, input.limitId));

      return { success: true };
    }),
});
