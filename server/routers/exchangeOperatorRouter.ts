import { TRPCError } from "@trpc/server";
import { z } from "zod/v4";
import { adminProcedure, protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import {
  exchangeOperators,
  operatorInstruments,
  operatorFees,
  operatorSettlementRules,
  instruments,
} from "../../drizzle/schema";
import { eq, desc, and, sql } from "drizzle-orm";
import { writeAuditLog } from "../audit";
import { notifyOwner } from "../_core/notification";
import { syncUserToKeycloak } from "../keycloak/keycloakClient";
import { triggerTemporalWorkflow } from "../temporal/temporalClient";
import { publishFluvioEvent, FLUVIO_TOPICS } from "../fluvio/fluvioClient";
import { cacheDel } from "../cache";

// ─── Router ──────────────────────────────────────────────────────────────────

export const exchangeOperatorRouter = router({
  /** Step 1: Register a new exchange operator */
  register: adminProcedure
    .input(
      z.object({
        operatorCode:        z.string().min(3).max(20).regex(/^[A-Z0-9_]+$/),
        legalName:           z.string().min(3).max(255),
        tradingName:         z.string().max(255).optional(),
        registrationNumber:  z.string().max(100).optional(),
        regulatoryLicenseNo: z.string().max(100).optional(),
        contactEmail:        z.string().email(),
        contactPhone:        z.string().max(50).optional(),
        country:             z.string().length(3).default("NGA"),
        logoUrl:             z.string().url().optional(),
        websiteUrl:          z.string().url().optional(),
        tier:                z.enum(["BASIC", "STANDARD", "PREMIUM", "ENTERPRISE"]).default("BASIC"),
        adminUserId:         z.number().int().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      // Check for duplicate operator code
      const existing = await db
        .select({ id: exchangeOperators.id })
        .from(exchangeOperators)
        .where(eq(exchangeOperators.operatorCode, input.operatorCode))
        .limit(1);

      if (existing.length > 0)
        throw new TRPCError({ code: "CONFLICT", message: `Operator code '${input.operatorCode}' already exists` });

      const [op] = await db.insert(exchangeOperators).values({
        operatorCode:        input.operatorCode,
        legalName:           input.legalName,
        tradingName:         input.tradingName,
        registrationNumber:  input.registrationNumber,
        regulatoryLicenseNo: input.regulatoryLicenseNo,
        contactEmail:        input.contactEmail,
        contactPhone:        input.contactPhone,
        country:             input.country,
        logoUrl:             input.logoUrl,
        websiteUrl:          input.websiteUrl,
        tier:                input.tier,
        adminUserId:         input.adminUserId ?? ctx.user.id,
        status:              "PENDING",
        onboardingStep:      1,
      }).returning();

      // Sync admin user to Keycloak with operator-admin role
      void syncUserToKeycloak({
        openId: ctx.user.openId,
        email: ctx.user.email ?? "",
        name: ctx.user.name ?? "",
        role: "admin",
        nexcomUserId: ctx.user.id,
      }).catch(() => {});

      // Trigger onboarding workflow
      void triggerTemporalWorkflow("OperatorOnboardingWorkflow", {
        operatorId: op.id,
        step: "REGISTRATION",
      }, `operator-onboard-${op.id}`).catch(() => {});

      // Publish event
      void publishFluvioEvent(FLUVIO_TOPICS.SYSTEM_EVENTS, {
        event: "OPERATOR_REGISTERED",
        operatorId: op.id,
        operatorCode: op.operatorCode,
      }).catch(() => {});

      await writeAuditLog({
        userId:     ctx.user.id,
        action:     "OPERATOR_REGISTER",
        resource:   "exchangeOperators",
        resourceId: String(op.id),
        details:    { operatorCode: op.operatorCode },
      });

      await notifyOwner({
        title:   `New Exchange Operator Registered: ${op.operatorCode}`,
        content: `${op.legalName} (${op.operatorCode}) has registered as a ${op.tier} tier operator. Review and activate via the admin panel.`,
      });

      return { success: true, operator: op };
    }),

  /** Step 2: Configure instruments for an operator */
  setInstruments: adminProcedure
    .input(
      z.object({
        operatorId: z.number().int(),
        instruments: z.array(
          z.object({
            instrumentId:   z.number().int(),
            isEnabled:      z.boolean().default(true),
            minOrderSize:   z.string().optional(),
            maxOrderSize:   z.string().optional(),
            maxDailyVolume: z.string().optional(),
            priceBandPct:   z.string().optional(),
            tickSize:       z.string().optional(),
            lotSize:        z.string().optional(),
            listingDate:    z.string().datetime().optional(),
            delistingDate:  z.string().datetime().optional(),
          })
        ).min(1).max(500),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const op = await db
        .select({ id: exchangeOperators.id, status: exchangeOperators.status })
        .from(exchangeOperators)
        .where(eq(exchangeOperators.id, input.operatorId))
        .limit(1);

      if (op.length === 0)
        throw new TRPCError({ code: "NOT_FOUND", message: "Operator not found" });

      // Upsert instruments
      for (const instr of input.instruments) {
        const existing = await db
          .select({ id: operatorInstruments.id })
          .from(operatorInstruments)
          .where(and(
            eq(operatorInstruments.operatorId, input.operatorId),
            eq(operatorInstruments.instrumentId, instr.instrumentId)
          ))
          .limit(1);

        if (existing.length > 0) {
          await db.update(operatorInstruments)
            .set({
              isEnabled:      instr.isEnabled,
              minOrderSize:   instr.minOrderSize,
              maxOrderSize:   instr.maxOrderSize,
              maxDailyVolume: instr.maxDailyVolume,
              priceBandPct:   instr.priceBandPct,
              tickSize:       instr.tickSize,
              lotSize:        instr.lotSize,
              listingDate:    instr.listingDate ? new Date(instr.listingDate) : undefined,
              delistingDate:  instr.delistingDate ? new Date(instr.delistingDate) : undefined,
              updatedAt:      new Date(),
            })
            .where(eq(operatorInstruments.id, existing[0].id));
        } else {
          await db.insert(operatorInstruments).values({
            operatorId:     input.operatorId,
            instrumentId:   instr.instrumentId,
            isEnabled:      instr.isEnabled,
            minOrderSize:   instr.minOrderSize,
            maxOrderSize:   instr.maxOrderSize,
            maxDailyVolume: instr.maxDailyVolume,
            priceBandPct:   instr.priceBandPct,
            tickSize:       instr.tickSize,
            lotSize:        instr.lotSize,
            listingDate:    instr.listingDate ? new Date(instr.listingDate) : undefined,
            delistingDate:  instr.delistingDate ? new Date(instr.delistingDate) : undefined,
          });
        }
      }

      // Advance onboarding step
      await db.update(exchangeOperators)
        .set({ onboardingStep: sql`greatest(onboarding_step, 2)`, updatedAt: new Date() })
        .where(eq(exchangeOperators.id, input.operatorId));

      await cacheDel(`operator:instruments:${input.operatorId}`);

      await writeAuditLog({
        userId:     ctx.user.id,
        action:     "OPERATOR_SET_INSTRUMENTS",
        resource:   "operatorInstruments",
        resourceId: String(input.operatorId),
        details:    { count: input.instruments.length },
      });

      return { success: true, configured: input.instruments.length };
    }),

  /** Step 3: Set fee schedule for an operator */
  setFees: adminProcedure
    .input(
      z.object({
        operatorId: z.number().int(),
        fees: z.array(
          z.object({
            feeType:      z.enum(["MAKER", "TAKER", "SETTLEMENT", "WITHDRAWAL", "DEPOSIT", "LISTING"]),
            instrumentId: z.number().int().optional(),
            rateBps:      z.number().int().min(0).max(10000),
            minFeeNgn:    z.string().optional(),
            maxFeeNgn:    z.string().optional(),
            effectiveFrom: z.string().datetime().optional(),
            effectiveTo:   z.string().datetime().optional(),
          })
        ).min(1).max(100),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      // Deactivate existing fees for this operator
      await db.update(operatorFees)
        .set({ isActive: false })
        .where(eq(operatorFees.operatorId, input.operatorId));

      // Insert new fee schedule
      await db.insert(operatorFees).values(
        input.fees.map((f) => ({
          operatorId:    input.operatorId,
          feeType:       f.feeType,
          instrumentId:  f.instrumentId ?? null,
          rateBps:       f.rateBps,
          minFeeNgn:     f.minFeeNgn ?? "0",
          maxFeeNgn:     f.maxFeeNgn ?? null,
          isActive:      true,
          effectiveFrom: f.effectiveFrom ? new Date(f.effectiveFrom) : new Date(),
          effectiveTo:   f.effectiveTo ? new Date(f.effectiveTo) : null,
        }))
      );

      // Advance onboarding step
      await db.update(exchangeOperators)
        .set({ onboardingStep: sql`greatest(onboarding_step, 3)`, updatedAt: new Date() })
        .where(eq(exchangeOperators.id, input.operatorId));

      await writeAuditLog({
        userId:     ctx.user.id,
        action:     "OPERATOR_SET_FEES",
        resource:   "operatorFees",
        resourceId: String(input.operatorId),
        details:    { feeCount: input.fees.length },
      });

      return { success: true, configured: input.fees.length };
    }),

  /** Step 4: Set settlement rules for an operator */
  setSettlementRules: adminProcedure
    .input(
      z.object({
        operatorId:          z.number().int(),
        settlementModel:     z.enum(["DVP", "FOP", "CASH_ONLY", "BILATERAL"]).default("DVP"),
        settlementCycleDays: z.number().int().min(0).max(5).default(2),
        cutoffTimeUtc:       z.string().regex(/^\d{2}:\d{2}:\d{2}$/).default("14:00:00"),
        autoNetEnabled:      z.boolean().default(true),
        failedTradePolicy:   z.string().max(50).default("RETRY_ONCE"),
        marginRequiredPct:   z.string().default("10"),
        custodianBankCode:   z.string().max(20).optional(),
        clearingHouseCode:   z.string().max(20).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      // Deactivate existing rules
      await db.update(operatorSettlementRules)
        .set({ isActive: false, updatedAt: new Date() })
        .where(eq(operatorSettlementRules.operatorId, input.operatorId));

      const [rule] = await db.insert(operatorSettlementRules).values({
        operatorId:          input.operatorId,
        settlementModel:     input.settlementModel,
        settlementCycleDays: input.settlementCycleDays,
        cutoffTimeUtc:       input.cutoffTimeUtc,
        autoNetEnabled:      input.autoNetEnabled,
        failedTradePolicy:   input.failedTradePolicy,
        marginRequiredPct:   input.marginRequiredPct,
        custodianBankCode:   input.custodianBankCode,
        clearingHouseCode:   input.clearingHouseCode,
        isActive:            true,
      }).returning();

      // Advance onboarding step to 4 (complete)
      await db.update(exchangeOperators)
        .set({
          onboardingStep:        4,
          onboardingCompletedAt: new Date(),
          updatedAt:             new Date(),
        })
        .where(eq(exchangeOperators.id, input.operatorId));

      await writeAuditLog({
        userId:     ctx.user.id,
        action:     "OPERATOR_SET_SETTLEMENT_RULES",
        resource:   "operatorSettlementRules",
        resourceId: String(input.operatorId),
        details:    { model: input.settlementModel },
      });

      return { success: true, rule };
    }),

  /** Activate an operator (after onboarding is complete) */
  activate: adminProcedure
    .input(z.object({ operatorId: z.number().int() }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const [op] = await db
        .select()
        .from(exchangeOperators)
        .where(eq(exchangeOperators.id, input.operatorId))
        .limit(1);

      if (!op) throw new TRPCError({ code: "NOT_FOUND", message: "Operator not found" });
      if (op.onboardingStep < 4)
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: `Onboarding incomplete (step ${op.onboardingStep}/4)` });

      await db.update(exchangeOperators)
        .set({ status: "ACTIVE", activatedAt: new Date(), updatedAt: new Date() })
        .where(eq(exchangeOperators.id, input.operatorId));

      void publishFluvioEvent(FLUVIO_TOPICS.SYSTEM_EVENTS, {
        event: "OPERATOR_ACTIVATED",
        operatorId: op.id,
        operatorCode: op.operatorCode,
      }).catch(() => {});

      await writeAuditLog({
        userId:     ctx.user.id,
        action:     "OPERATOR_ACTIVATE",
        resource:   "exchangeOperators",
        resourceId: String(op.id),
        details:    { operatorCode: op.operatorCode },
      });

      await notifyOwner({
        title:   `Exchange Operator Activated: ${op.operatorCode}`,
        content: `${op.legalName} is now ACTIVE on the exchange.`,
      });

      return { success: true, operatorCode: op.operatorCode };
    }),

  /** Suspend an operator */
  suspend: adminProcedure
    .input(z.object({ operatorId: z.number().int(), reason: z.string().min(10) }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      await db.update(exchangeOperators)
        .set({
          status:          "SUSPENDED",
          suspendedAt:     new Date(),
          suspensionReason: input.reason,
          updatedAt:       new Date(),
        })
        .where(eq(exchangeOperators.id, input.operatorId));

      await writeAuditLog({
        userId:     ctx.user.id,
        action:     "OPERATOR_SUSPEND",
        resource:   "exchangeOperators",
        resourceId: String(input.operatorId),
        details:    { reason: input.reason },
      });

      return { success: true };
    }),

  /** List all operators (admin) */
  list: adminProcedure
    .input(
      z.object({
        status: z.enum(["PENDING", "ACTIVE", "SUSPENDED", "TERMINATED"]).optional(),
        tier:   z.enum(["BASIC", "STANDARD", "PREMIUM", "ENTERPRISE"]).optional(),
        limit:  z.number().int().min(1).max(100).default(20),
        offset: z.number().int().min(0).default(0),
      })
    )
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const conditions = [];
      if (input.status) conditions.push(eq(exchangeOperators.status, input.status));
      if (input.tier)   conditions.push(eq(exchangeOperators.tier, input.tier));

      const rows = await db
        .select()
        .from(exchangeOperators)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(exchangeOperators.createdAt))
        .limit(input.limit)
        .offset(input.offset);

      const [{ count }] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(exchangeOperators)
        .where(conditions.length > 0 ? and(...conditions) : undefined);

      return { operators: rows, total: count };
    }),

  /** Get operator detail with instruments, fees, and settlement rules */
  getDetail: adminProcedure
    .input(z.object({ operatorId: z.number().int() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const [op] = await db
        .select()
        .from(exchangeOperators)
        .where(eq(exchangeOperators.id, input.operatorId))
        .limit(1);

      if (!op) throw new TRPCError({ code: "NOT_FOUND", message: "Operator not found" });

      const [instrList, feeList, ruleList] = await Promise.all([
        db.select({
          id:           operatorInstruments.id,
          instrumentId: operatorInstruments.instrumentId,
          isEnabled:    operatorInstruments.isEnabled,
          minOrderSize: operatorInstruments.minOrderSize,
          maxOrderSize: operatorInstruments.maxOrderSize,
          tickSize:     operatorInstruments.tickSize,
          lotSize:      operatorInstruments.lotSize,
          symbol:       instruments.symbol,
          name:         instruments.name,
          assetClass:   instruments.assetClass,
        })
          .from(operatorInstruments)
          .leftJoin(instruments, eq(operatorInstruments.instrumentId, instruments.id))
          .where(eq(operatorInstruments.operatorId, input.operatorId)),
        db.select()
          .from(operatorFees)
          .where(and(eq(operatorFees.operatorId, input.operatorId), eq(operatorFees.isActive, true))),
        db.select()
          .from(operatorSettlementRules)
          .where(and(eq(operatorSettlementRules.operatorId, input.operatorId), eq(operatorSettlementRules.isActive, true)))
          .limit(1),
      ]);

      return {
        operator:        op,
        instruments:     instrList,
        fees:            feeList,
        settlementRules: ruleList[0] ?? null,
      };
    }),

  /** List available instruments to configure */
  listAvailableInstruments: adminProcedure
    .query(async () => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      // Cache invalidation handled by setInstruments

      return db.select({
        id:         instruments.id,
        symbol:     instruments.symbol,
        name:       instruments.name,
        assetClass: instruments.assetClass,
        currency:   instruments.baseCurrency,
        status:     instruments.status,
      }).from(instruments).where(eq(instruments.status, "ACTIVE")).orderBy(instruments.symbol);
    }),
});
