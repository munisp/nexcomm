import { z } from "zod";
import { protectedProcedure, publicProcedure, router } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import { getDb } from "../db";
import {
  futuresContracts,
  futuresPositions,
  futuresSettlements,
  openInterestSnapshots,
  clearingAccounts,
} from "../../drizzle/schema";
import { eq, desc, and, lt, lte, gte, sql, inArray, ne } from "drizzle-orm";
import { notifyOwner } from "../_core/notification";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function calcLiquidationPrice(
  side: "LONG" | "SHORT",
  entryPrice: number,
  maintenancePct: number,
): number {
  if (side === "LONG") {
    // Long liquidated when price drops to: entryPrice * (1 - maintenancePct)
    return entryPrice * (1 - maintenancePct);
  } else {
    // Short liquidated when price rises to: entryPrice * (1 + maintenancePct)
    return entryPrice * (1 + maintenancePct);
  }
}

function calcUnrealizedPnl(
  side: "LONG" | "SHORT",
  entryPrice: number,
  markPrice: number,
  quantity: number,
  contractSize: number,
): number {
  const priceDiff = side === "LONG"
    ? markPrice - entryPrice
    : entryPrice - markPrice;
  return priceDiff * quantity * contractSize;
}

// ─── Router ───────────────────────────────────────────────────────────────────

export const derivativesRouter = router({

  // ─── Admin: Contract Management ──────────────────────────────────────────

  adminCreateFuturesContract: protectedProcedure
    .input(z.object({
      symbol: z.string().min(1).max(32),
      underlyingAsset: z.string().min(1).max(64),
      assetClass: z.string().default("COMMODITY"),
      contractSize: z.number().positive(),
      tickSize: z.number().positive(),
      currency: z.string().length(3).default("NGN"),
      expiryDate: z.string().datetime(),
      settlementDate: z.string().datetime(),
      initialMarginPct: z.number().min(0.01).max(1).default(0.10),
      maintenanceMarginPct: z.number().min(0.01).max(1).default(0.07),
    }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      if (new Date(input.expiryDate) <= new Date()) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Expiry date must be in the future" });
      }
      if (input.maintenanceMarginPct >= input.initialMarginPct) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Maintenance margin must be less than initial margin" });
      }

      const [existing] = await db.select({ id: futuresContracts.id })
        .from(futuresContracts)
        .where(eq(futuresContracts.symbol, input.symbol))
        .limit(1);
      if (existing) throw new TRPCError({ code: "CONFLICT", message: `Contract symbol ${input.symbol} already exists` });

      const [contract] = await db.insert(futuresContracts).values({
        symbol: input.symbol,
        underlyingAsset: input.underlyingAsset,
        assetClass: input.assetClass,
        contractSize: String(input.contractSize),
        tickSize: String(input.tickSize),
        currency: input.currency,
        expiryDate: new Date(input.expiryDate),
        settlementDate: new Date(input.settlementDate),
        initialMarginPct: String(input.initialMarginPct),
        maintenanceMarginPct: String(input.maintenanceMarginPct),
        createdBy: ctx.user.id,
      }).returning();

      return contract;
    }),

  adminListFuturesContracts: protectedProcedure
    .input(z.object({
      status: z.enum(["ACTIVE", "EXPIRED", "SETTLED", "ALL"]).default("ALL"),
      assetClass: z.string().optional(),
      page: z.number().int().min(1).default(1),
      limit: z.number().int().min(1).max(100).default(20),
    }))
    .query(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const offset = (input.page - 1) * input.limit;
      const conditions = [];
      if (input.status !== "ALL") conditions.push(eq(futuresContracts.status, input.status));
      if (input.assetClass) conditions.push(eq(futuresContracts.assetClass, input.assetClass));

      const [countRow] = await db.select({ total: sql<number>`count(*)::int` })
        .from(futuresContracts)
        .where(conditions.length > 0 ? and(...conditions) : undefined);

      const contracts = await db.select().from(futuresContracts)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(futuresContracts.expiryDate))
        .limit(input.limit).offset(offset);

      return { contracts, total: countRow?.total ?? 0 };
    }),

  adminUpdateContract: protectedProcedure
    .input(z.object({
      contractId: z.number().int().positive(),
      initialMarginPct: z.number().min(0.01).max(1).optional(),
      maintenanceMarginPct: z.number().min(0.01).max(1).optional(),
      lastMarkPrice: z.number().positive().optional(),
      status: z.enum(["ACTIVE", "EXPIRED", "SETTLED"]).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const updates: Record<string, unknown> = { updatedAt: new Date() };
      if (input.initialMarginPct !== undefined) updates.initialMarginPct = String(input.initialMarginPct);
      if (input.maintenanceMarginPct !== undefined) updates.maintenanceMarginPct = String(input.maintenanceMarginPct);
      if (input.lastMarkPrice !== undefined) updates.lastMarkPrice = String(input.lastMarkPrice);
      if (input.status !== undefined) updates.status = input.status;

      const [updated] = await db.update(futuresContracts)
        .set(updates)
        .where(eq(futuresContracts.id, input.contractId))
        .returning();
      if (!updated) throw new TRPCError({ code: "NOT_FOUND", message: "Contract not found" });
      return updated;
    }),

  adminExpireContract: protectedProcedure
    .input(z.object({
      contractId: z.number().int().positive(),
      reason: z.string().max(256).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const [contract] = await db.select().from(futuresContracts)
        .where(eq(futuresContracts.id, input.contractId)).limit(1);
      if (!contract) throw new TRPCError({ code: "NOT_FOUND", message: "Contract not found" });
      if (contract.status !== "ACTIVE") {
        throw new TRPCError({ code: "BAD_REQUEST", message: `Contract is already ${contract.status}` });
      }

      const [updated] = await db.update(futuresContracts)
        .set({ status: "EXPIRED", updatedAt: new Date() })
        .where(eq(futuresContracts.id, input.contractId))
        .returning();

      return updated;
    }),

  // ─── User: Place Futures Order ────────────────────────────────────────────

  placeFuturesOrder: protectedProcedure
    .input(z.object({
      contractId: z.number().int().positive(),
      side: z.enum(["LONG", "SHORT"]),
      quantity: z.number().positive(),
      entryPrice: z.number().positive(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      // Fetch contract
      const [contract] = await db.select().from(futuresContracts)
        .where(eq(futuresContracts.id, input.contractId)).limit(1);
      if (!contract) throw new TRPCError({ code: "NOT_FOUND", message: "Contract not found" });
      if (contract.status !== "ACTIVE") {
        throw new TRPCError({ code: "BAD_REQUEST", message: `Contract is ${contract.status} and cannot be traded` });
      }
      if (new Date(contract.expiryDate) <= new Date()) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Contract has expired" });
      }

      const contractSize = parseFloat(contract.contractSize);
      const initialMarginPct = parseFloat(contract.initialMarginPct);
      const maintenancePct = parseFloat(contract.maintenanceMarginPct);

      // Calculate required margin
      const notionalValue = input.entryPrice * input.quantity * contractSize;
      const requiredMargin = notionalValue * initialMarginPct;

      // Check clearing account balance
      const [clearingAccount] = await db.select()
        .from(clearingAccounts)
        .where(eq(clearingAccounts.userId, ctx.user.id))
        .limit(1);

      if (!clearingAccount) {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "No clearing account found. Please set up a clearing account first." });
      }

      const cashBalance = parseFloat(clearingAccount.cashBalance);
      if (cashBalance < requiredMargin) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Insufficient margin. Required: ${requiredMargin.toFixed(2)} NGN, Available: ${cashBalance.toFixed(2)} NGN`,
        });
      }

      const liquidationPrice = calcLiquidationPrice(input.side, input.entryPrice, maintenancePct);

      const [position] = await db.insert(futuresPositions).values({
        userId: ctx.user.id,
        contractId: input.contractId,
        side: input.side,
        quantity: String(input.quantity),
        entryPrice: String(input.entryPrice),
        currentMarkPrice: String(input.entryPrice),
        unrealizedPnl: "0",
        realizedPnl: "0",
        marginPosted: String(requiredMargin),
        liquidationPrice: String(liquidationPrice),
        status: "OPEN",
      }).returning();

      // Deduct margin from clearing account
      await db.update(clearingAccounts)
        .set({
          cashBalance: String(cashBalance - requiredMargin),
          updatedAt: new Date(),
        })
        .where(eq(clearingAccounts.id, clearingAccount.id));

      return { position, requiredMargin, notionalValue };
    }),

  closeFuturesPosition: protectedProcedure
    .input(z.object({
      positionId: z.number().int().positive(),
      closePrice: z.number().positive(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const [position] = await db.select().from(futuresPositions)
        .where(and(
          eq(futuresPositions.id, input.positionId),
          eq(futuresPositions.userId, ctx.user.id),
        )).limit(1);
      if (!position) throw new TRPCError({ code: "NOT_FOUND", message: "Position not found" });
      if (position.status !== "OPEN") {
        throw new TRPCError({ code: "BAD_REQUEST", message: `Position is already ${position.status}` });
      }

      const [contract] = await db.select().from(futuresContracts)
        .where(eq(futuresContracts.id, position.contractId)).limit(1);
      if (!contract) throw new TRPCError({ code: "NOT_FOUND", message: "Contract not found" });

      const contractSize = parseFloat(contract.contractSize);
      const qty = parseFloat(position.quantity);
      const entryPrice = parseFloat(position.entryPrice);
      const marginPosted = parseFloat(position.marginPosted);

      const realizedPnl = calcUnrealizedPnl(
        position.side as "LONG" | "SHORT",
        entryPrice,
        input.closePrice,
        qty,
        contractSize,
      );

      const [closed] = await db.update(futuresPositions)
        .set({
          status: "CLOSED",
          currentMarkPrice: String(input.closePrice),
          realizedPnl: String(parseFloat(position.realizedPnl) + realizedPnl),
          unrealizedPnl: "0",
          closedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(futuresPositions.id, input.positionId))
        .returning();

      // Return margin + PnL to clearing account
      const [clearingAccount] = await db.select()
        .from(clearingAccounts)
        .where(eq(clearingAccounts.userId, ctx.user.id))
        .limit(1);

      if (clearingAccount) {
        const newBalance = parseFloat(clearingAccount.cashBalance) + marginPosted + realizedPnl;
        await db.update(clearingAccounts)
          .set({ cashBalance: String(Math.max(0, newBalance)), updatedAt: new Date() })
          .where(eq(clearingAccounts.id, clearingAccount.id));
      }

      return { position: closed, realizedPnl };
    }),

  myFuturesPositions: protectedProcedure
    .input(z.object({
      status: z.enum(["OPEN", "CLOSED", "LIQUIDATED", "ALL"]).default("OPEN"),
    }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const conditions = [eq(futuresPositions.userId, ctx.user.id)];
      if (input.status !== "ALL") conditions.push(eq(futuresPositions.status, input.status));

      const positions = await db.select({
        position: futuresPositions,
        contract: futuresContracts,
      })
        .from(futuresPositions)
        .innerJoin(futuresContracts, eq(futuresPositions.contractId, futuresContracts.id))
        .where(and(...conditions))
        .orderBy(desc(futuresPositions.openedAt));

      return positions;
    }),

  // ─── Admin: Mark-to-Market & Settlement ──────────────────────────────────

  adminMarkToMarket: protectedProcedure
    .input(z.object({
      contractId: z.number().int().positive(),
      settlementPrice: z.number().positive(),
      notes: z.string().max(500).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const [contract] = await db.select().from(futuresContracts)
        .where(eq(futuresContracts.id, input.contractId)).limit(1);
      if (!contract) throw new TRPCError({ code: "NOT_FOUND", message: "Contract not found" });
      if (contract.status !== "ACTIVE") {
        throw new TRPCError({ code: "BAD_REQUEST", message: `Contract is ${contract.status}` });
      }

      const contractSize = parseFloat(contract.contractSize);

      // Fetch all open positions for this contract
      const openPositions = await db.select().from(futuresPositions)
        .where(and(
          eq(futuresPositions.contractId, input.contractId),
          eq(futuresPositions.status, "OPEN"),
        ));

      let totalLongPnl = 0;
      let totalShortPnl = 0;
      let positionsSettled = 0;

      for (const pos of openPositions) {
        const qty = parseFloat(pos.quantity);
        const entryPrice = parseFloat(pos.entryPrice);
        const prevMarkPrice = pos.currentMarkPrice ? parseFloat(pos.currentMarkPrice) : entryPrice;

        // Daily P&L is the change from previous mark price to new mark price
        const dailyPnl = calcUnrealizedPnl(
          pos.side as "LONG" | "SHORT",
          prevMarkPrice,
          input.settlementPrice,
          qty,
          contractSize,
        );

        const newUnrealizedPnl = calcUnrealizedPnl(
          pos.side as "LONG" | "SHORT",
          entryPrice,
          input.settlementPrice,
          qty,
          contractSize,
        );

        await db.update(futuresPositions)
          .set({
            currentMarkPrice: String(input.settlementPrice),
            unrealizedPnl: String(newUnrealizedPnl),
            updatedAt: new Date(),
          })
          .where(eq(futuresPositions.id, pos.id));

        // Transfer daily P&L to/from clearing accounts
        const [clearingAccount] = await db.select()
          .from(clearingAccounts)
          .where(eq(clearingAccounts.userId, pos.userId))
          .limit(1);

        if (clearingAccount) {
          const newBalance = parseFloat(clearingAccount.cashBalance) + dailyPnl;
          await db.update(clearingAccounts)
            .set({ cashBalance: String(newBalance), updatedAt: new Date() })
            .where(eq(clearingAccounts.id, clearingAccount.id));
        }

        if (pos.side === "LONG") totalLongPnl += dailyPnl;
        else totalShortPnl += dailyPnl;
        positionsSettled++;
      }

      // Update contract mark price
      await db.update(futuresContracts)
        .set({ lastMarkPrice: String(input.settlementPrice), lastSettlementPrice: String(input.settlementPrice), updatedAt: new Date() })
        .where(eq(futuresContracts.id, input.contractId));

      // Record settlement event
      const [settlement] = await db.insert(futuresSettlements).values({
        contractId: input.contractId,
        settlementType: "DAILY_MTM",
        settlementPrice: String(input.settlementPrice),
        totalLongPnl: String(totalLongPnl),
        totalShortPnl: String(totalShortPnl),
        positionsSettled,
        settledBy: ctx.user.id,
        notes: input.notes ?? null,
      }).returning();

      // Take open interest snapshot
      const longQty = openPositions
        .filter(p => p.side === "LONG")
        .reduce((s, p) => s + parseFloat(p.quantity), 0);
      const shortQty = openPositions
        .filter(p => p.side === "SHORT")
        .reduce((s, p) => s + parseFloat(p.quantity), 0);

      await db.insert(openInterestSnapshots).values({
        contractId: input.contractId,
        totalLongQty: String(longQty),
        totalShortQty: String(shortQty),
        openInterest: String(Math.min(longQty, shortQty)),
        settlementPrice: String(input.settlementPrice),
      });

      return { settlement, positionsSettled, totalLongPnl, totalShortPnl };
    }),

  adminSettleExpiredContracts: protectedProcedure
    .input(z.object({
      contractId: z.number().int().positive(),
      finalSettlementPrice: z.number().positive(),
      notes: z.string().max(500).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const [contract] = await db.select().from(futuresContracts)
        .where(eq(futuresContracts.id, input.contractId)).limit(1);
      if (!contract) throw new TRPCError({ code: "NOT_FOUND", message: "Contract not found" });
      if (contract.status === "SETTLED") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Contract is already settled" });
      }

      const contractSize = parseFloat(contract.contractSize);

      // Close all open positions at final settlement price
      const openPositions = await db.select().from(futuresPositions)
        .where(and(
          eq(futuresPositions.contractId, input.contractId),
          eq(futuresPositions.status, "OPEN"),
        ));

      let totalLongPnl = 0;
      let totalShortPnl = 0;

      for (const pos of openPositions) {
        const qty = parseFloat(pos.quantity);
        const entryPrice = parseFloat(pos.entryPrice);
        const marginPosted = parseFloat(pos.marginPosted);

        const finalPnl = calcUnrealizedPnl(
          pos.side as "LONG" | "SHORT",
          entryPrice,
          input.finalSettlementPrice,
          qty,
          contractSize,
        );

        await db.update(futuresPositions)
          .set({
            status: "CLOSED",
            currentMarkPrice: String(input.finalSettlementPrice),
            realizedPnl: String(parseFloat(pos.realizedPnl) + finalPnl),
            unrealizedPnl: "0",
            closedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(futuresPositions.id, pos.id));

        // Return margin + final P&L to clearing account
        const [clearingAccount] = await db.select()
          .from(clearingAccounts)
          .where(eq(clearingAccounts.userId, pos.userId))
          .limit(1);

        if (clearingAccount) {
          const newBalance = parseFloat(clearingAccount.cashBalance) + marginPosted + finalPnl;
          await db.update(clearingAccounts)
            .set({ cashBalance: String(Math.max(0, newBalance)), updatedAt: new Date() })
            .where(eq(clearingAccounts.id, clearingAccount.id));
        }

        if (pos.side === "LONG") totalLongPnl += finalPnl;
        else totalShortPnl += finalPnl;
      }

      // Mark contract as settled
      await db.update(futuresContracts)
        .set({
          status: "SETTLED",
          lastSettlementPrice: String(input.finalSettlementPrice),
          updatedAt: new Date(),
        })
        .where(eq(futuresContracts.id, input.contractId));

      // Record final settlement
      const [settlement] = await db.insert(futuresSettlements).values({
        contractId: input.contractId,
        settlementType: "FINAL",
        settlementPrice: String(input.finalSettlementPrice),
        totalLongPnl: String(totalLongPnl),
        totalShortPnl: String(totalShortPnl),
        positionsSettled: openPositions.length,
        settledBy: ctx.user.id,
        notes: input.notes ?? null,
      }).returning();

      await notifyOwner({
        title: `Final Settlement: ${contract.symbol}`,
        content: `Contract ${contract.symbol} has been finally settled at ${input.finalSettlementPrice} NGN. ${openPositions.length} positions closed. Long P&L: ${totalLongPnl.toFixed(2)}, Short P&L: ${totalShortPnl.toFixed(2)}.`,
      });

      return { settlement, positionsSettled: openPositions.length, totalLongPnl, totalShortPnl };
    }),

  // ─── Open Interest ────────────────────────────────────────────────────────

  getOpenInterest: protectedProcedure
    .input(z.object({
      contractId: z.number().int().positive(),
    }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const [contract] = await db.select().from(futuresContracts)
        .where(eq(futuresContracts.id, input.contractId)).limit(1);
      if (!contract) throw new TRPCError({ code: "NOT_FOUND", message: "Contract not found" });

      const [stats] = await db.select({
        totalLongQty: sql<string>`COALESCE(SUM(CASE WHEN side = 'LONG' THEN quantity::numeric ELSE 0 END), 0)::text`,
        totalShortQty: sql<string>`COALESCE(SUM(CASE WHEN side = 'SHORT' THEN quantity::numeric ELSE 0 END), 0)::text`,
        openPositions: sql<number>`COUNT(*)::int`,
      })
        .from(futuresPositions)
        .where(and(
          eq(futuresPositions.contractId, input.contractId),
          eq(futuresPositions.status, "OPEN"),
        ));

      const longQty = parseFloat(stats?.totalLongQty ?? "0");
      const shortQty = parseFloat(stats?.totalShortQty ?? "0");
      const openInterest = Math.min(longQty, shortQty);

      return {
        contractId: input.contractId,
        symbol: contract.symbol,
        totalLongQty: longQty,
        totalShortQty: shortQty,
        openInterest,
        openPositions: stats?.openPositions ?? 0,
        lastMarkPrice: contract.lastMarkPrice ? parseFloat(contract.lastMarkPrice) : null,
      };
    }),

  adminListOpenInterestHistory: protectedProcedure
    .input(z.object({
      contractId: z.number().int().positive(),
      limit: z.number().int().min(1).max(100).default(30),
    }))
    .query(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const snapshots = await db.select().from(openInterestSnapshots)
        .where(eq(openInterestSnapshots.contractId, input.contractId))
        .orderBy(desc(openInterestSnapshots.snapshotDate))
        .limit(input.limit);

      return snapshots;
    }),

  // ─── Admin: Derivatives Stats ─────────────────────────────────────────────

  adminGetDerivativesStats: protectedProcedure
    .query(async ({ ctx }) => {
      if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const now = new Date();
      const in7DaysISO = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();

      const [contractStats] = await db.select({
        totalContracts: sql<number>`COUNT(*)::int`,
        activeContracts: sql<number>`SUM(CASE WHEN status = 'ACTIVE' THEN 1 ELSE 0 END)::int`,
        expiredContracts: sql<number>`SUM(CASE WHEN status = 'EXPIRED' THEN 1 ELSE 0 END)::int`,
        settledContracts: sql<number>`SUM(CASE WHEN status = 'SETTLED' THEN 1 ELSE 0 END)::int`,
        expiringSoon: sql<number>`SUM(CASE WHEN status = 'ACTIVE' AND expiry_date::text <= ${in7DaysISO} THEN 1 ELSE 0 END)::int`,
      }).from(futuresContracts);

      const [positionStats] = await db.select({
        totalOpenPositions: sql<number>`COUNT(*)::int`,
        totalLongPositions: sql<number>`SUM(CASE WHEN side = 'LONG' THEN 1 ELSE 0 END)::int`,
        totalShortPositions: sql<number>`SUM(CASE WHEN side = 'SHORT' THEN 1 ELSE 0 END)::int`,
        totalOpenInterest: sql<string>`COALESCE(SUM(quantity::numeric), 0)::text`,
      }).from(futuresPositions).where(eq(futuresPositions.status, "OPEN"));

      const [settlementStats] = await db.select({
        totalSettlements: sql<number>`COUNT(*)::int`,
        todaySettlements: sql<number>`SUM(CASE WHEN settled_at >= CURRENT_DATE THEN 1 ELSE 0 END)::int`,
      }).from(futuresSettlements);

      return {
        totalContracts: contractStats?.totalContracts ?? 0,
        activeContracts: contractStats?.activeContracts ?? 0,
        expiredContracts: contractStats?.expiredContracts ?? 0,
        settledContracts: contractStats?.settledContracts ?? 0,
        expiringSoon: contractStats?.expiringSoon ?? 0,
        totalOpenPositions: positionStats?.totalOpenPositions ?? 0,
        totalLongPositions: positionStats?.totalLongPositions ?? 0,
        totalShortPositions: positionStats?.totalShortPositions ?? 0,
        totalOpenInterest: parseFloat(positionStats?.totalOpenInterest ?? "0"),
        totalSettlements: settlementStats?.totalSettlements ?? 0,
        todaySettlements: settlementStats?.todaySettlements ?? 0,
      };
    }),

  // ─── Admin: List All Open Positions (Risk Dashboard) ─────────────────────

  adminListAllOpenPositions: protectedProcedure
    .input(z.object({
      page: z.number().int().min(1).default(1),
      limit: z.number().int().min(1).max(200).default(50),
      contractId: z.number().int().positive().optional(),
      side: z.enum(["LONG", "SHORT", "ALL"]).default("ALL"),
    }))
    .query(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const conditions = [eq(futuresPositions.status, "OPEN")];
      if (input.contractId) conditions.push(eq(futuresPositions.contractId, input.contractId));
      if (input.side !== "ALL") conditions.push(eq(futuresPositions.side, input.side));

      const offset = (input.page - 1) * input.limit;
      const [positions, countRow] = await Promise.all([
        db.select({
          position: futuresPositions,
          contract: futuresContracts,
        })
          .from(futuresPositions)
          .innerJoin(futuresContracts, eq(futuresPositions.contractId, futuresContracts.id))
          .where(and(...conditions))
          .orderBy(desc(futuresPositions.unrealizedPnl))
          .limit(input.limit).offset(offset),
        db.select({ total: sql<number>`COUNT(*)::int` })
          .from(futuresPositions)
          .where(and(...conditions)),
      ]);

      return { positions, total: countRow[0]?.total ?? 0 };
    }),

  // ─── Admin: Force Liquidate Position ─────────────────────────────────────

  adminForceLiquidatePosition: protectedProcedure
    .input(z.object({
      positionId: z.number().int().positive(),
      liquidationPrice: z.number().positive(),
      reason: z.string().min(1).max(500).default("Admin force liquidation"),
    }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const [pos] = await db.select().from(futuresPositions)
        .where(eq(futuresPositions.id, input.positionId)).limit(1);
      if (!pos) throw new TRPCError({ code: "NOT_FOUND", message: "Position not found" });
      if (pos.status !== "OPEN") {
        throw new TRPCError({ code: "BAD_REQUEST", message: `Position is already ${pos.status}` });
      }

      const qty = parseFloat(pos.quantity);
      const entryPrice = parseFloat(pos.entryPrice);
      const liqPrice = input.liquidationPrice;

      const priceDiff = pos.side === "LONG"
        ? liqPrice - entryPrice
        : entryPrice - liqPrice;
      const realizedPnl = priceDiff * qty;

      // Update clearing account: return remaining margin after loss
      const [clearingAccount] = await db.select().from(clearingAccounts)
        .where(eq(clearingAccounts.userId, pos.userId)).limit(1);
      if (clearingAccount) {
        const marginPosted = parseFloat(pos.marginPosted);
        const returnAmount = Math.max(0, marginPosted + realizedPnl);
        const newBalance = parseFloat(clearingAccount.cashBalance) + returnAmount;
        await db.update(clearingAccounts)
          .set({ cashBalance: String(newBalance), updatedAt: new Date() })
          .where(eq(clearingAccounts.id, clearingAccount.id));
      }

      const [updated] = await db.update(futuresPositions)
        .set({
          status: "LIQUIDATED",
          currentMarkPrice: String(liqPrice),
          realizedPnl: String(realizedPnl),
          closedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(futuresPositions.id, input.positionId))
        .returning();

      return { position: updated, realizedPnl, liquidationPrice: liqPrice };
    }),

  // ─── Public: List Active Contracts ───────────────────────────────────────

  listActiveContracts: publicProcedure
    .input(z.object({
      assetClass: z.string().optional(),
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const conditions = [eq(futuresContracts.status, "ACTIVE")];
      if (input.assetClass) conditions.push(eq(futuresContracts.assetClass, input.assetClass));

      const contracts = await db.select().from(futuresContracts)
        .where(and(...conditions))
        .orderBy(futuresContracts.expiryDate);

      return contracts;
    }),
});
