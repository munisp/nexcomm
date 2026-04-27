/**
 * NEXCOM Exchange — Mojaloop DFSP Tier & Fee Management tRPC Router
 * ─────────────────────────────────────────────────────────────────────────────
 * Provides:
 *  - calculateFee: compute transfer fee for a given amount/currency/DFSP
 *  - listTiers: list all DFSP tiers with their fee schedules
 *  - getTier: get a single tier by name
 *  - createTier / updateTier: admin CRUD for tiers
 *  - listFeeSchedules: list fee schedules for a tier
 *  - upsertFeeSchedule: admin CRUD for fee schedules
 *  - assignTier: assign a tier to a DFSP
 */

import { z } from "zod";
import { router, protectedProcedure, adminProcedure } from "../_core/trpc";
import { getDb } from "../db";
import {
  dfspTiers,
  mojaloopFeeSchedules,
  mojaloopDfsps,
} from "../../drizzle/schema";
import { eq, and } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { writeAuditLog } from "../audit";

const TIER_NAMES = ["STANDARD", "PREMIUM", "INSTITUTIONAL", "CORRESPONDENT"] as const;
type TierName = (typeof TIER_NAMES)[number];

// ─── Fee Calculation Helper ───────────────────────────────────────────────────
/**
 * Calculate the transfer fee for a given amount, currency, and tier.
 * Formula: max(minFee, min(flatFee + amount * percentageFee / 100, maxFee))
 */
function computeFee(params: {
  amount: number;
  flatFee: number;
  percentageFee: number;
  minFee: number;
  maxFee: number | null;
}): number {
  const { amount, flatFee, percentageFee, minFee, maxFee } = params;
  const rawFee = flatFee + (amount * percentageFee) / 100;
  const cappedFee = maxFee !== null ? Math.min(rawFee, maxFee) : rawFee;
  return Math.max(minFee, cappedFee);
}

// ─── Router ───────────────────────────────────────────────────────────────────
export const mojaloopTiersRouter = router({
  // ── Calculate transfer fee ─────────────────────────────────────────────────
  // Returns the fee for a given amount/currency/DFSP combination.
  // If the DFSP has no tier or no matching fee schedule, falls back to STANDARD.
  calculateFee: protectedProcedure
    .input(
      z.object({
        amount: z.number().positive(),
        currency: z.string().min(1).max(8).toUpperCase(),
        fspId: z.string().optional(), // DFSP FSP ID (to look up tier)
        tierName: z.enum(TIER_NAMES).optional(), // explicit tier override
      })
    )
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) {
        // Fallback: flat 0.5% with no DB
        const fee = input.amount * 0.005;
        return {
          fee: Math.round(fee * 100) / 100,
          flatFee: 0,
          percentageFee: 0.5,
          minFee: 0,
          maxFee: null,
          tierName: "STANDARD" as TierName,
          currency: input.currency,
          breakdown: `0.50% of ${input.amount} ${input.currency} (DB unavailable)`,
        };
      }

      // Resolve tier name: explicit override > DFSP tier > STANDARD
      let resolvedTier: TierName = input.tierName ?? "STANDARD";
      if (!input.tierName && input.fspId) {
        const [dfsp] = await db
          .select({ tier: mojaloopDfsps.tier })
          .from(mojaloopDfsps)
          .where(eq(mojaloopDfsps.fspId, input.fspId))
          .limit(1);
        if (dfsp?.tier) {
          resolvedTier = dfsp.tier as TierName;
        }
      }

      // Look up fee schedule for tier + currency
      let schedule = await db
        .select()
        .from(mojaloopFeeSchedules)
        .where(
          and(
            eq(mojaloopFeeSchedules.tierName, resolvedTier),
            eq(mojaloopFeeSchedules.currency, input.currency),
            eq(mojaloopFeeSchedules.isActive, true)
          )
        )
        .limit(1)
        .then((r) => r[0] ?? null);

      // Fallback to STANDARD if no schedule found for this tier/currency
      if (!schedule && resolvedTier !== "STANDARD") {
        schedule = await db
          .select()
          .from(mojaloopFeeSchedules)
          .where(
            and(
              eq(mojaloopFeeSchedules.tierName, "STANDARD"),
              eq(mojaloopFeeSchedules.currency, input.currency),
              eq(mojaloopFeeSchedules.isActive, true)
            )
          )
          .limit(1)
          .then((r) => r[0] ?? null);
        if (schedule) resolvedTier = "STANDARD";
      }

      if (!schedule) {
        // No schedule at all — default 0.5% flat
        const fee = Math.round(input.amount * 0.005 * 100) / 100;
        return {
          fee,
          flatFee: 0,
          percentageFee: 0.5,
          minFee: 0,
          maxFee: null,
          tierName: resolvedTier,
          currency: input.currency,
          breakdown: `0.50% of ${input.amount} ${input.currency} (default rate, no schedule configured)`,
        };
      }

      const flatFee = parseFloat(schedule.flatFee);
      const percentageFee = parseFloat(schedule.percentageFee);
      const minFee = parseFloat(schedule.minFee);
      const maxFee = schedule.maxFee ? parseFloat(schedule.maxFee) : null;

      const fee = computeFee({
        amount: input.amount,
        flatFee,
        percentageFee,
        minFee,
        maxFee,
      });

      const rounded = Math.round(fee * 100) / 100;

      return {
        fee: rounded,
        flatFee,
        percentageFee,
        minFee,
        maxFee,
        tierName: resolvedTier,
        currency: input.currency,
        breakdown:
          `Flat: ${flatFee} ${input.currency} + ` +
          `${percentageFee.toFixed(4)}% of ${input.amount} = ` +
          `${rounded} ${input.currency}` +
          (maxFee !== null ? ` (capped at ${maxFee})` : ""),
      };
    }),

  // ── List all tiers ─────────────────────────────────────────────────────────
  listTiers: protectedProcedure.query(async () => {
    const db = await getDb();
    if (!db) return [];
    const tiers = await db.select().from(dfspTiers).orderBy(dfspTiers.name);
    // Attach fee schedules to each tier
    const schedules = await db.select().from(mojaloopFeeSchedules);
    return tiers.map((t) => ({
      ...t,
      feeSchedules: schedules.filter((s) => s.tierName === t.name),
    }));
  }),

  // ── Get single tier ────────────────────────────────────────────────────────
  getTier: protectedProcedure
    .input(z.object({ name: z.enum(TIER_NAMES) }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      const [tier] = await db
        .select()
        .from(dfspTiers)
        .where(eq(dfspTiers.name, input.name))
        .limit(1);
      if (!tier) throw new TRPCError({ code: "NOT_FOUND", message: `Tier ${input.name} not found` });
      const schedules = await db
        .select()
        .from(mojaloopFeeSchedules)
        .where(eq(mojaloopFeeSchedules.tierName, input.name));
      return { ...tier, feeSchedules: schedules };
    }),

  // ── Update tier limits (admin) ─────────────────────────────────────────────
  updateTier: adminProcedure
    .input(
      z.object({
        name: z.enum(TIER_NAMES),
        displayName: z.string().min(1).max(64).optional(),
        description: z.string().optional(),
        dailyLimitAmount: z.string().optional(),
        minTransferAmount: z.string().optional(),
        maxTransferAmount: z.string().optional(),
        allowedCurrencies: z.string().optional(),
        settlementWindowHrs: z.number().int().min(1).max(168).optional(),
        isActive: z.boolean().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      const { name, ...updates } = input;
      const filtered = Object.fromEntries(
        Object.entries(updates).filter(([, v]) => v !== undefined)
      );
      if (Object.keys(filtered).length === 0) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "No fields to update" });
      }
      await db
        .update(dfspTiers)
        .set({ ...filtered, updatedAt: new Date() })
        .where(eq(dfspTiers.name, name));
      return { success: true };
    }),

  // ── List fee schedules ─────────────────────────────────────────────────────
  listFeeSchedules: protectedProcedure
    .input(z.object({ tierName: z.enum(TIER_NAMES).optional() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return [];
      if (input.tierName) {
        return db
          .select()
          .from(mojaloopFeeSchedules)
          .where(eq(mojaloopFeeSchedules.tierName, input.tierName));
      }
      return db.select().from(mojaloopFeeSchedules);
    }),

  // ── Upsert fee schedule (admin) ────────────────────────────────────────────
  upsertFeeSchedule: adminProcedure
    .input(
      z.object({
        tierName: z.enum(TIER_NAMES),
        currency: z.string().min(1).max(8).toUpperCase(),
        flatFee: z.string().trim(),
        percentageFee: z.string().trim(),
        minFee: z.string().trim(),
        maxFee: z.string().nullable(),
        isActive: z.boolean().default(true),
      })
    )
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      // Check if schedule exists
      const [existing] = await db
        .select({ id: mojaloopFeeSchedules.id })
        .from(mojaloopFeeSchedules)
        .where(
          and(
            eq(mojaloopFeeSchedules.tierName, input.tierName),
            eq(mojaloopFeeSchedules.currency, input.currency)
          )
        )
        .limit(1);

      if (existing) {
        await db
          .update(mojaloopFeeSchedules)
          .set({
            flatFee: input.flatFee,
            percentageFee: input.percentageFee,
            minFee: input.minFee,
            maxFee: input.maxFee,
            isActive: input.isActive,
            updatedAt: new Date(),
          })
          .where(eq(mojaloopFeeSchedules.id, existing.id));
        return { success: true, action: "updated" as const };
      } else {
        await db.insert(mojaloopFeeSchedules).values({
          tierName: input.tierName,
          currency: input.currency,
          flatFee: input.flatFee,
          percentageFee: input.percentageFee,
          minFee: input.minFee,
          maxFee: input.maxFee,
          isActive: input.isActive,
        });
        return { success: true, action: "created" as const };
      }
    }),

  // ── Assign tier to DFSP (admin) ────────────────────────────────────────────
  assignTier: adminProcedure
    .input(
      z.object({
        fspId: z.string().min(1).max(64),
        tierName: z.enum(TIER_NAMES),
      })
    )
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      const result = await db
        .update(mojaloopDfsps)
        .set({ tier: input.tierName, updatedAt: new Date() })
        .where(eq(mojaloopDfsps.fspId, input.fspId));
      return { success: true, fspId: input.fspId, tier: input.tierName };
    }),

  // ── Get DFSP list with tier info ───────────────────────────────────────────
  listDfspsWithTiers: protectedProcedure.query(async () => {
    const db = await getDb();
    if (!db) return [];
    return db
      .select({
        fspId: mojaloopDfsps.fspId,
        name: mojaloopDfsps.name,
        status: mojaloopDfsps.status,
        tier: mojaloopDfsps.tier,
        currency: mojaloopDfsps.currency,
        createdAt: mojaloopDfsps.createdAt,
      })
      .from(mojaloopDfsps)
      .orderBy(mojaloopDfsps.name);
  }),
});

export type MojaloopTiersRouter = typeof mojaloopTiersRouter;
