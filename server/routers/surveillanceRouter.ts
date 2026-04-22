import { z } from "zod";
import { protectedProcedure, publicProcedure, router } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import { getDb } from "../db";
import {
  circuitBreakerRules,
  circuitBreakerEvents,
  washTradeFlags,
  orders,
} from "../../drizzle/schema";
import { eq, desc, and, lt, gte, sql, inArray, or } from "drizzle-orm";
import { notifyOwner } from "../_core/notification";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function calcMovePct(priceBefore: number, priceAfter: number): number {
  if (priceBefore <= 0) return 0;
  return Math.abs((priceAfter - priceBefore) / priceBefore) * 100;
}

// ─── Router ──────────────────────────────────────────────────────────────────

export const surveillanceRouter = router({
  // ─── Circuit Breaker Rules ───────────────────────────────────────────────

  adminCreateCircuitBreakerRule: protectedProcedure
    .input(z.object({
      instrument: z.string().min(1).max(32), // use "*" for all instruments
      assetClass: z.string().default("COMMODITY"),
      triggerPct: z.number().min(0.1).max(100), // e.g. 5 = 5%
      windowMinutes: z.number().int().min(1).max(1440),
      haltDurationMinutes: z.number().int().min(1).max(1440),
      notes: z.string().max(500).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const [rule] = await db.insert(circuitBreakerRules).values({
        instrument: input.instrument,
        assetClass: input.assetClass,
        triggerPct: String(input.triggerPct),
        windowMinutes: input.windowMinutes,
        haltDurationMinutes: input.haltDurationMinutes,
        notes: input.notes ?? null,
        createdBy: ctx.user.id,
      }).returning();
      return rule;
    }),

  adminListCircuitBreakerRules: protectedProcedure
    .input(z.object({
      assetClass: z.string().optional(),
      activeOnly: z.boolean().default(true),
    }))
    .query(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const conditions = [];
      if (input.activeOnly) conditions.push(eq(circuitBreakerRules.isActive, true));
      if (input.assetClass) conditions.push(eq(circuitBreakerRules.assetClass, input.assetClass));

      return db.select().from(circuitBreakerRules)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(circuitBreakerRules.createdAt));
    }),

  adminUpdateCircuitBreakerRule: protectedProcedure
    .input(z.object({
      ruleId: z.number().int().positive(),
      triggerPct: z.number().min(0.1).max(100).optional(),
      windowMinutes: z.number().int().min(1).max(1440).optional(),
      haltDurationMinutes: z.number().int().min(1).max(1440).optional(),
      isActive: z.boolean().optional(),
      notes: z.string().max(500).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const updates: Record<string, unknown> = { updatedAt: new Date() };
      if (input.triggerPct !== undefined) updates.triggerPct = String(input.triggerPct);
      if (input.windowMinutes !== undefined) updates.windowMinutes = input.windowMinutes;
      if (input.haltDurationMinutes !== undefined) updates.haltDurationMinutes = input.haltDurationMinutes;
      if (input.isActive !== undefined) updates.isActive = input.isActive;
      if (input.notes !== undefined) updates.notes = input.notes;

      const [updated] = await db.update(circuitBreakerRules)
        .set(updates)
        .where(eq(circuitBreakerRules.id, input.ruleId))
        .returning();
      if (!updated) throw new TRPCError({ code: "NOT_FOUND" });
      return updated;
    }),

  adminDeleteCircuitBreakerRule: protectedProcedure
    .input(z.object({ ruleId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const [deleted] = await db.delete(circuitBreakerRules)
        .where(eq(circuitBreakerRules.id, input.ruleId))
        .returning();
      if (!deleted) throw new TRPCError({ code: "NOT_FOUND" });
      return { success: true };
    }),

  // ─── Circuit Breaker Events ──────────────────────────────────────────────

  checkCircuitBreaker: protectedProcedure
    .input(z.object({
      instrument: z.string().min(1).max(32),
      assetClass: z.string().default("COMMODITY"),
      currentPrice: z.number().positive(),
      referencePrice: z.number().positive(), // price at start of window
    }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      // Check if already halted
      const now = new Date();
      const [activeHalt] = await db.select().from(circuitBreakerEvents)
        .where(and(
          eq(circuitBreakerEvents.instrument, input.instrument),
          eq(circuitBreakerEvents.status, "ACTIVE"),
          gte(circuitBreakerEvents.haltUntil, now),
        )).limit(1);
      if (activeHalt) return { halted: true, event: activeHalt, triggered: false };

      // Find matching rules
      const rules = await db.select().from(circuitBreakerRules)
        .where(and(
          eq(circuitBreakerRules.isActive, true),
          or(
            eq(circuitBreakerRules.instrument, input.instrument),
            eq(circuitBreakerRules.instrument, "*"),
          ),
        ));

      const movePct = calcMovePct(input.referencePrice, input.currentPrice);
      const triggeredRule = rules.find(r => movePct >= parseFloat(r.triggerPct));
      if (!triggeredRule) return { halted: false, triggered: false, movePct };

      // Create halt event
      const haltUntil = new Date(now.getTime() + triggeredRule.haltDurationMinutes * 60_000);
      const [event] = await db.insert(circuitBreakerEvents).values({
        ruleId: triggeredRule.id,
        instrument: input.instrument,
        assetClass: input.assetClass,
        triggerPct: triggeredRule.triggerPct,
        priceBefore: String(input.referencePrice),
        priceAfter: String(input.currentPrice),
        actualMovePct: String(movePct.toFixed(4)),
        haltUntil,
        status: "ACTIVE",
      }).returning();

      await notifyOwner({
        title: `Circuit Breaker Triggered: ${input.instrument}`,
        content: `Trading halted for ${input.instrument}. Price moved ${movePct.toFixed(2)}% (threshold: ${triggeredRule.triggerPct}%). Halt until: ${haltUntil.toLocaleString()}.`,
      });

      return { halted: true, triggered: true, event, movePct };
    }),

  adminListCircuitBreakerEvents: protectedProcedure
    .input(z.object({
      instrument: z.string().optional(),
      status: z.enum(["ACTIVE", "LIFTED", "EXPIRED"]).optional(),
      limit: z.number().int().min(1).max(200).default(50),
      page: z.number().int().min(1).default(1),
    }))
    .query(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const offset = (input.page - 1) * input.limit;
      const conditions = [];
      if (input.instrument) conditions.push(eq(circuitBreakerEvents.instrument, input.instrument));
      if (input.status) conditions.push(eq(circuitBreakerEvents.status, input.status));

      const [countRow] = await db.select({ total: sql<number>`count(*)::int` })
        .from(circuitBreakerEvents)
        .where(conditions.length > 0 ? and(...conditions) : undefined);
      const events = await db.select().from(circuitBreakerEvents)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(circuitBreakerEvents.haltedAt))
        .limit(input.limit).offset(offset);

      return { events, total: countRow?.total ?? 0 };
    }),

  adminGetHaltedInstruments: protectedProcedure
    .query(async ({ ctx }) => {
      if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const now = new Date();
      // Auto-expire halts that have passed their haltUntil
      await db.update(circuitBreakerEvents)
        .set({ status: "EXPIRED" })
        .where(and(
          eq(circuitBreakerEvents.status, "ACTIVE"),
          lt(circuitBreakerEvents.haltUntil, now),
        ));

      return db.select().from(circuitBreakerEvents)
        .where(and(
          eq(circuitBreakerEvents.status, "ACTIVE"),
          gte(circuitBreakerEvents.haltUntil, now),
        ))
        .orderBy(circuitBreakerEvents.haltedAt);
    }),

  adminLiftHalt: protectedProcedure
    .input(z.object({
      eventId: z.number().int().positive(),
      notes: z.string().max(500).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const [updated] = await db.update(circuitBreakerEvents)
        .set({ status: "LIFTED", liftedAt: new Date(), liftedBy: ctx.user.id, notes: input.notes ?? null })
        .where(and(eq(circuitBreakerEvents.id, input.eventId), eq(circuitBreakerEvents.status, "ACTIVE")))
        .returning();
      if (!updated) throw new TRPCError({ code: "NOT_FOUND", message: "Active halt not found" });
      return updated;
    }),

  // ─── Manual Admin Triggers ─────────────────────────────────────────────────

  /**
   * adminTriggerCircuitBreaker — manually create a halt event for an instrument.
   * Useful for testing, drills, or manual intervention.
   */
  adminTriggerCircuitBreaker: protectedProcedure
    .input(z.object({
      instrument: z.string().min(1).max(32),
      priceBefore: z.number().positive(),
      priceAfter: z.number().positive(),
      haltDurationMinutes: z.number().int().min(1).max(1440).default(30),
      ruleId: z.number().int().positive().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const movePct = calcMovePct(input.priceBefore, input.priceAfter);
      const haltUntil = new Date(Date.now() + input.haltDurationMinutes * 60_000);

      const [event] = await db.insert(circuitBreakerEvents).values({
        ruleId: input.ruleId ?? null,
        instrument: input.instrument,
        assetClass: "COMMODITY",
        triggerPct: String(movePct.toFixed(4)),
        priceBefore: String(input.priceBefore),
        priceAfter: String(input.priceAfter),
        actualMovePct: String(movePct.toFixed(4)),
        haltUntil,
        status: "ACTIVE",
      }).returning();

      await notifyOwner({
        title: `Manual Circuit Breaker: ${input.instrument}`,
        content: `Admin ${ctx.user.id} manually triggered a trading halt for ${input.instrument}. Halt until: ${haltUntil.toLocaleString()}.`,
      });

      return event;
    }),

  /**
   * adminFlagWashTrade — manually flag a suspected wash trade pair.
   * Useful when an analyst identifies suspicious order pairs that the
   * automated scanner may have missed.
   */
  adminFlagWashTrade: protectedProcedure
    .input(z.object({
      userId: z.number().int().positive(),
      instrument: z.string().min(1).max(32),
      buyOrderId: z.number().int().positive(),
      sellOrderId: z.number().int().positive(),
      quantity: z.number().positive().optional(),
      windowMinutes: z.number().int().min(1).max(1440).default(60),
      notes: z.string().max(500).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const [flag] = await db.insert(washTradeFlags).values({
        userId: input.userId,
        instrument: input.instrument,
        assetClass: "COMMODITY",
        buyOrderId: input.buyOrderId,
        sellOrderId: input.sellOrderId,
        quantity: input.quantity ? String(input.quantity) : null,
        windowMinutes: input.windowMinutes,
        reviewNotes: input.notes ?? null,
      }).returning();

      await notifyOwner({
        title: `Wash Trade Manually Flagged: User ${input.userId}`,
        content: `Admin ${ctx.user.id} manually flagged a wash trade for user ${input.userId} on ${input.instrument}.`,
      });

      return flag;
    }),

  // ─── Wash Trade Detection ────────────────────────────────────────────────

  detectWashTrade: protectedProcedure
    .input(z.object({
      userId: z.number().int().positive(),
      instrument: z.string().min(1).max(32),
      assetClass: z.string().default("COMMODITY"),
      windowMinutes: z.number().int().min(1).max(1440).default(60),
    }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const windowStart = new Date(Date.now() - input.windowMinutes * 60_000);

      // Find buy and sell orders by same user for same instrument in window
      const recentOrders = await db.select().from(orders)
        .where(and(
          eq(orders.userId, input.userId),
          eq(orders.symbol, input.instrument),
          gte(orders.createdAt, windowStart),
          inArray(orders.status, ["FILLED", "PARTIALLY_FILLED"]),
        ))
        .orderBy(orders.createdAt);

      const buys = recentOrders.filter(o => o.side === "BUY");
      const sells = recentOrders.filter(o => o.side === "SELL");

      if (buys.length === 0 || sells.length === 0) {
        return { detected: false, flags: [] };
      }

      const flags: typeof washTradeFlags.$inferInsert[] = [];
      for (const buy of buys) {
        for (const sell of sells) {
          const timeDiff = Math.abs(buy.createdAt.getTime() - sell.createdAt.getTime());
          const timeDiffMinutes = timeDiff / 60_000;
          if (timeDiffMinutes <= input.windowMinutes) {
            // Check if already flagged
            const [existing] = await db.select({ id: washTradeFlags.id })
              .from(washTradeFlags)
              .where(and(
                eq(washTradeFlags.userId, input.userId),
                eq(washTradeFlags.buyOrderId, buy.id),
                eq(washTradeFlags.sellOrderId, sell.id),
              )).limit(1);
            if (!existing) {
              flags.push({
                userId: input.userId,
                instrument: input.instrument,
                assetClass: input.assetClass,
                buyOrderId: buy.id,
                sellOrderId: sell.id,
                buyPrice: buy.price ?? null,
                sellPrice: sell.price ?? null,
                quantity: buy.filledQty,
                windowMinutes: input.windowMinutes,
              });
            }
          }
        }
      }

      if (flags.length === 0) return { detected: false, flags: [] };

      const inserted = await db.insert(washTradeFlags).values(flags).returning();

      await notifyOwner({
        title: `Wash Trade Detected: User ${input.userId}`,
        content: `${inserted.length} potential wash trade(s) detected for user ${input.userId} on ${input.instrument} within ${input.windowMinutes} minutes.`,
      });

      return { detected: true, flags: inserted };
    }),

  adminListWashTradeFlags: protectedProcedure
    .input(z.object({
      status: z.enum(["PENDING", "CONFIRMED", "DISMISSED"]).optional(),
      userId: z.number().int().positive().optional(),
      limit: z.number().int().min(1).max(200).default(50),
      page: z.number().int().min(1).default(1),
    }))
    .query(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const offset = (input.page - 1) * input.limit;
      const conditions = [];
      if (input.status) conditions.push(eq(washTradeFlags.status, input.status));
      if (input.userId) conditions.push(eq(washTradeFlags.userId, input.userId));

      const [countRow] = await db.select({ total: sql<number>`count(*)::int` })
        .from(washTradeFlags)
        .where(conditions.length > 0 ? and(...conditions) : undefined);
      const flags = await db.select().from(washTradeFlags)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(washTradeFlags.detectedAt))
        .limit(input.limit).offset(offset);

      return { flags, total: countRow?.total ?? 0 };
    }),

  adminReviewWashTradeFlag: protectedProcedure
    .input(z.object({
      flagId: z.number().int().positive(),
      decision: z.enum(["CONFIRMED", "DISMISSED"]),
      penaltyApplied: z.boolean().default(false),
      reviewNotes: z.string().max(500).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      // Fetch the flag first to check its current status
      const [existing] = await db.select({ id: washTradeFlags.id, status: washTradeFlags.status })
        .from(washTradeFlags)
        .where(eq(washTradeFlags.id, input.flagId))
        .limit(1);
      if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "Wash trade flag not found" });
      if (existing.status !== "PENDING") {
        throw new TRPCError({ code: "BAD_REQUEST", message: `Flag is already ${existing.status} and cannot be reviewed again` });
      }

      const [updated] = await db.update(washTradeFlags)
        .set({
          status: input.decision,
          reviewedBy: ctx.user.id,
          reviewedAt: new Date(),
          reviewNotes: input.reviewNotes ?? null,
          penaltyApplied: input.penaltyApplied,
        })
        .where(eq(washTradeFlags.id, input.flagId))
        .returning();
      if (!updated) throw new TRPCError({ code: "NOT_FOUND" });
      return updated;
    }),

  adminGetSurveillanceStats: protectedProcedure
    .query(async ({ ctx }) => {
      if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const now = new Date();

      const [cbStats] = await db.select({
        totalRules: sql<number>`count(*)::int`,
        activeRules: sql<number>`count(*) filter (where is_active = true)::int`,
      }).from(circuitBreakerRules);

      const [haltStats] = await db.select({
        totalHalts: sql<number>`count(*)::int`,
        activeHalts: sql<number>`count(*) filter (where status = 'ACTIVE' and halt_until > now())::int`,
        liftedHalts: sql<number>`count(*) filter (where status = 'LIFTED')::int`,
      }).from(circuitBreakerEvents);

      const [washStats] = await db.select({
        totalFlags: sql<number>`count(*)::int`,
        pendingFlags: sql<number>`count(*) filter (where status = 'PENDING')::int`,
        confirmedFlags: sql<number>`count(*) filter (where status = 'CONFIRMED')::int`,
        dismissedFlags: sql<number>`count(*) filter (where status = 'DISMISSED')::int`,
        penaltiesApplied: sql<number>`count(*) filter (where penalty_applied = true)::int`,
      }).from(washTradeFlags);

      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const [todayHalts] = await db.select({
        total: sql<number>`count(*)::int`,
      }).from(circuitBreakerEvents)
        .where(gte(circuitBreakerEvents.haltedAt, todayStart));

      return {
        circuitBreakers: {
          totalRules: cbStats?.totalRules ?? 0,
          activeRules: cbStats?.activeRules ?? 0,
          totalHalts: haltStats?.totalHalts ?? 0,
          activeHalts: haltStats?.activeHalts ?? 0,
          liftedHalts: haltStats?.liftedHalts ?? 0,
          totalHaltsToday: todayHalts?.total ?? 0,
        },
        washTrades: {
          totalFlags: washStats?.totalFlags ?? 0,
          pendingFlags: washStats?.pendingFlags ?? 0,
          confirmedFlags: washStats?.confirmedFlags ?? 0,
          dismissedFlags: washStats?.dismissedFlags ?? 0,
          penaltiesApplied: washStats?.penaltiesApplied ?? 0,
        },
      };
    }),

  // ─── Circuit Breaker Background Job (called by cron) ────────────────────

  runCircuitBreakerScan: protectedProcedure
    .input(z.object({
      priceData: z.array(z.object({
        instrument: z.string().trim(),
        assetClass: z.string().trim(),
        currentPrice: z.number().positive(),
        referencePrice: z.number().positive(),
      })),
    }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const results: { instrument: string; halted: boolean; movePct: number }[] = [];
      const now = new Date();

      // Auto-expire old halts
      await db.update(circuitBreakerEvents)
        .set({ status: "EXPIRED" })
        .where(and(
          eq(circuitBreakerEvents.status, "ACTIVE"),
          lt(circuitBreakerEvents.haltUntil, now),
        ));

      // Get all active rules
      const rules = await db.select().from(circuitBreakerRules)
        .where(eq(circuitBreakerRules.isActive, true));

      for (const item of input.priceData) {
        const movePct = calcMovePct(item.referencePrice, item.currentPrice);

        // Check if already halted
        const [activeHalt] = await db.select({ id: circuitBreakerEvents.id })
          .from(circuitBreakerEvents)
          .where(and(
            eq(circuitBreakerEvents.instrument, item.instrument),
            eq(circuitBreakerEvents.status, "ACTIVE"),
            gte(circuitBreakerEvents.haltUntil, now),
          )).limit(1);

        if (activeHalt) {
          results.push({ instrument: item.instrument, halted: true, movePct });
          continue;
        }

        const matchingRule = rules.find(r =>
          (r.instrument === item.instrument || r.instrument === "*") &&
          movePct >= parseFloat(r.triggerPct)
        );

        if (matchingRule) {
          const haltUntil = new Date(now.getTime() + matchingRule.haltDurationMinutes * 60_000);
          await db.insert(circuitBreakerEvents).values({
            ruleId: matchingRule.id,
            instrument: item.instrument,
            assetClass: item.assetClass,
            triggerPct: matchingRule.triggerPct,
            priceBefore: String(item.referencePrice),
            priceAfter: String(item.currentPrice),
            actualMovePct: String(movePct.toFixed(4)),
            haltUntil,
            status: "ACTIVE",
          });
          results.push({ instrument: item.instrument, halted: true, movePct });
        } else {
          results.push({ instrument: item.instrument, halted: false, movePct });
        }
      }

      const newHalts = results.filter(r => r.halted);
      if (newHalts.length > 0) {
        await notifyOwner({
          title: `Circuit Breaker Scan: ${newHalts.length} instrument(s) halted`,
          content: newHalts.map(h => `${h.instrument}: ${h.movePct.toFixed(2)}% move`).join(", "),
        });
      }

      return { scanned: input.priceData.length, halted: newHalts.length, results };
    }),
});
