import { TRPCError } from "@trpc/server";
import { and, desc, eq, gte, lte, sql, inArray } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../db";
import { protectedProcedure, publicProcedure, router } from "../_core/trpc";
import { writeAuditLog } from "../audit";
import {
  optionsContracts,
  optionsPositions,
  clearingAccounts,
} from "../../drizzle/schema";

// ─── Black-Scholes Implementation ────────────────────────────────────────────

function normCdf(x: number): number {
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741;
  const a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
  const sign = x < 0 ? -1 : 1;
  const absX = Math.abs(x);
  const t = 1.0 / (1.0 + p * absX);
  const poly = t * (a1 + t * (a2 + t * (a3 + t * (a4 + t * a5))));
  return 0.5 * (1.0 + sign * (1.0 - poly * Math.exp(-absX * absX / 2)));
}

function normPdf(x: number): number {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}

export interface BSGreeks {
  premium: number; delta: number; gamma: number; theta: number;
  vega: number; rho: number; d1: number; d2: number;
  timeToExpiry: number; intrinsicValue: number; timeValue: number;
}

export function blackScholes(
  S: number, K: number, T: number, r: number, sigma: number,
  optionType: "CALL" | "PUT",
): BSGreeks {
  if (T <= 0) {
    const intrinsicValue = optionType === "CALL" ? Math.max(0, S - K) : Math.max(0, K - S);
    return { premium: intrinsicValue, delta: optionType === "CALL" ? (S > K ? 1 : 0) : (S < K ? -1 : 0), gamma: 0, theta: 0, vega: 0, rho: 0, d1: 0, d2: 0, timeToExpiry: 0, intrinsicValue, timeValue: 0 };
  }
  const sqrtT = Math.sqrt(T);
  const d1 = (Math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * sqrtT);
  const d2 = d1 - sigma * sqrtT;
  let premium: number, delta: number, rho: number;
  if (optionType === "CALL") {
    premium = S * normCdf(d1) - K * Math.exp(-r * T) * normCdf(d2);
    delta = normCdf(d1);
    rho = K * T * Math.exp(-r * T) * normCdf(d2) / 100;
  } else {
    premium = K * Math.exp(-r * T) * normCdf(-d2) - S * normCdf(-d1);
    delta = normCdf(d1) - 1;
    rho = -K * T * Math.exp(-r * T) * normCdf(-d2) / 100;
  }
  const gamma = normPdf(d1) / (S * sigma * sqrtT);
  const thetaAnnual = optionType === "CALL"
    ? -(S * normPdf(d1) * sigma) / (2 * sqrtT) - r * K * Math.exp(-r * T) * normCdf(d2)
    : -(S * normPdf(d1) * sigma) / (2 * sqrtT) + r * K * Math.exp(-r * T) * normCdf(-d2);
  const theta = thetaAnnual / 365;
  const vega = S * normPdf(d1) * sqrtT / 100;
  const intrinsicValue = optionType === "CALL" ? Math.max(0, S - K) : Math.max(0, K - S);
  const timeValue = Math.max(0, Math.max(0, premium) - intrinsicValue);
  return { premium: Math.max(0, premium), delta, gamma, theta, vega, rho, d1, d2, timeToExpiry: T, intrinsicValue, timeValue };
}

function timeToExpiryYears(expiryDate: Date): number {
  const msPerYear = 365.25 * 24 * 60 * 60 * 1000;
  return Math.max(0, (expiryDate.getTime() - Date.now()) / msPerYear);
}

// ─── In-Memory Fallback Stores ────────────────────────────────────────────────

let _ocSeq = 1;
let _opSeq = 1;
const _memOContracts = new Map<number, any>();
const _memOPositions = new Map<number, any>();
const _memOClearingAccounts = new Map<number, any>(); // userId -> account

// ─── Router ──────────────────────────────────────────────────────────────────

export const optionsRouter = router({

  adminCreateOptionsContract: protectedProcedure
    .input(z.object({
      symbol: z.string().min(3).max(50),
      underlyingContractId: z.number().int().positive().optional(),
      optionType: z.enum(["CALL", "PUT"]),
      strikePrice: z.number().positive(),
      expiryDate: z.string().trim(),
      contractSize: z.number().positive().default(1),
      riskFreeRate: z.number().min(0).max(1).default(0.05),
      impliedVolatility: z.number().min(0.01).max(5).default(0.20),
    }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
      const expiry = new Date(input.expiryDate);
      if (isNaN(expiry.getTime())) throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid expiry date" });
      if (expiry <= new Date()) throw new TRPCError({ code: "BAD_REQUEST", message: "Expiry must be in the future" });

      const db = await getDb();
      if (!db) {
        const id = _ocSeq++;
        const now = new Date();
        const contract = {
          id, symbol: input.symbol.toUpperCase(), underlyingContractId: input.underlyingContractId ?? null,
          optionType: input.optionType, strikePrice: String(input.strikePrice),
          expiryDate: expiry, contractSize: String(input.contractSize),
          riskFreeRate: String(input.riskFreeRate), impliedVolatility: String(input.impliedVolatility),
          status: "ACTIVE", openInterest: 0, lastPrice: null,
          createdBy: ctx.user.id, createdAt: now, updatedAt: now,
        };
        _memOContracts.set(id, contract);
        return contract;
      }

      const [contract] = await db.insert(optionsContracts).values({
        symbol: input.symbol.toUpperCase(),
        underlyingContractId: input.underlyingContractId ?? null,
        optionType: input.optionType,
        strikePrice: String(input.strikePrice),
        expiryDate: expiry,
        contractSize: String(input.contractSize),
        riskFreeRate: String(input.riskFreeRate),
        impliedVolatility: String(input.impliedVolatility),
        createdBy: ctx.user.id,
      }).returning();
      return contract;
    }),

  adminListOptionsContracts: protectedProcedure
    .input(z.object({
      status: z.enum(["ACTIVE", "EXPIRED", "SETTLED", "ALL"]).default("ACTIVE"),
      optionType: z.enum(["CALL", "PUT", "ALL"]).default("ALL"),
      page: z.number().int().min(1).default(1),
      limit: z.number().int().min(1).max(100).default(20),
    }))
    .query(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
      const db = await getDb();
      if (!db) {
        let contracts = Array.from(_memOContracts.values());
        if (input.status !== "ALL") contracts = contracts.filter(c => c.status === input.status);
        if (input.optionType !== "ALL") contracts = contracts.filter(c => c.optionType === input.optionType);
        const offset = (input.page - 1) * input.limit;
        return { contracts: contracts.slice(offset, offset + input.limit), total: contracts.length };
      }

      const conditions = [];
      if (input.status !== "ALL") conditions.push(eq(optionsContracts.status, input.status));
      if (input.optionType !== "ALL") conditions.push(eq(optionsContracts.optionType, input.optionType));
      const offset = (input.page - 1) * input.limit;
      const [contracts, countRow] = await Promise.all([
        db.select().from(optionsContracts)
          .where(conditions.length ? and(...conditions) : undefined)
          .orderBy(desc(optionsContracts.createdAt))
          .limit(input.limit).offset(offset),
        db.select({ total: sql<number>`COUNT(*)::int` }).from(optionsContracts)
          .where(conditions.length ? and(...conditions) : undefined),
      ]);
      return { contracts, total: countRow[0]?.total ?? 0 };
    }),

  adminUpdateOptionsContract: protectedProcedure
    .input(z.object({
      contractId: z.number().int().positive(),
      impliedVolatility: z.number().min(0.01).max(5).optional(),
      riskFreeRate: z.number().min(0).max(1).optional(),
      lastPrice: z.number().positive().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
      const db = await getDb();
      if (!db) {
        const contract = _memOContracts.get(input.contractId);
        if (!contract) throw new TRPCError({ code: "NOT_FOUND", message: "Contract not found" });
        if (input.impliedVolatility !== undefined) contract.impliedVolatility = String(input.impliedVolatility);
        if (input.riskFreeRate !== undefined) contract.riskFreeRate = String(input.riskFreeRate);
        if (input.lastPrice !== undefined) contract.lastPrice = String(input.lastPrice);
        contract.updatedAt = new Date();
        return contract;
      }

      const updates: Record<string, unknown> = { updatedAt: new Date() };
      if (input.impliedVolatility !== undefined) updates.impliedVolatility = String(input.impliedVolatility);
      if (input.riskFreeRate !== undefined) updates.riskFreeRate = String(input.riskFreeRate);
      if (input.lastPrice !== undefined) updates.lastPrice = String(input.lastPrice);
      const [updated] = await db.update(optionsContracts).set(updates).where(eq(optionsContracts.id, input.contractId)).returning();
      if (!updated) throw new TRPCError({ code: "NOT_FOUND", message: "Contract not found" });
      return updated;
    }),

  adminExpireOptionsContract: protectedProcedure
    .input(z.object({ contractId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
      const db = await getDb();
      if (!db) {
        const contract = _memOContracts.get(input.contractId);
        if (!contract) throw new TRPCError({ code: "NOT_FOUND", message: "Contract not found" });
        if (contract.status !== "ACTIVE") throw new TRPCError({ code: "BAD_REQUEST", message: `Contract is already ${contract.status}` });
        contract.status = "EXPIRED";
        contract.updatedAt = new Date();
        return contract;
      }

      const [contract] = await db.select().from(optionsContracts).where(eq(optionsContracts.id, input.contractId)).limit(1);
      if (!contract) throw new TRPCError({ code: "NOT_FOUND", message: "Contract not found" });
      if (contract.status !== "ACTIVE") throw new TRPCError({ code: "BAD_REQUEST", message: `Contract is already ${contract.status}` });
      const [updated] = await db.update(optionsContracts).set({ status: "EXPIRED", updatedAt: new Date() }).where(eq(optionsContracts.id, input.contractId)).returning();
      return updated;
    }),

  priceOption: publicProcedure
    .input(z.object({
      contractId: z.number().int().positive(),
      spotPrice: z.number().positive(),
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) {
        const contract = _memOContracts.get(input.contractId);
        if (!contract) throw new TRPCError({ code: "NOT_FOUND", message: "Contract not found" });
        const T = timeToExpiryYears(contract.expiryDate);
        const K = parseFloat(contract.strikePrice);
        const r = parseFloat(contract.riskFreeRate);
        const sigma = parseFloat(contract.impliedVolatility);
        const greeks = blackScholes(input.spotPrice, K, T, r, sigma, contract.optionType);
        const moneyness = input.spotPrice > K ? (contract.optionType === "CALL" ? "ITM" : "OTM") : input.spotPrice < K ? (contract.optionType === "CALL" ? "OTM" : "ITM") : "ATM";
        return { contract, spotPrice: input.spotPrice, ...greeks, moneyness };
      }

      const [contract] = await db.select().from(optionsContracts).where(eq(optionsContracts.id, input.contractId)).limit(1);
      if (!contract) throw new TRPCError({ code: "NOT_FOUND", message: "Contract not found" });
      const T = timeToExpiryYears(contract.expiryDate);
      const K = parseFloat(contract.strikePrice);
      const r = parseFloat(contract.riskFreeRate);
      const sigma = parseFloat(contract.impliedVolatility);
      const greeks = blackScholes(input.spotPrice, K, T, r, sigma, contract.optionType);
      const moneyness = input.spotPrice > K ? (contract.optionType === "CALL" ? "ITM" : "OTM") : input.spotPrice < K ? (contract.optionType === "CALL" ? "OTM" : "ITM") : "ATM";
      return { contract, spotPrice: input.spotPrice, ...greeks, moneyness };
    }),

  listActiveOptions: publicProcedure
    .input(z.object({
      underlyingContractId: z.number().int().positive().optional(),
      optionType: z.enum(["CALL", "PUT", "ALL"]).default("ALL"),
      spotPrice: z.number().positive().optional(),
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) {
        let contracts = Array.from(_memOContracts.values()).filter(c => c.status === "ACTIVE");
        if (input.underlyingContractId) contracts = contracts.filter(c => c.underlyingContractId === input.underlyingContractId);
        if (input.optionType !== "ALL") contracts = contracts.filter(c => c.optionType === input.optionType);
        if (!input.spotPrice) return contracts.map(c => ({ contract: c, greeks: null }));
        return contracts.map(c => {
          const T = timeToExpiryYears(c.expiryDate);
          const K = parseFloat(c.strikePrice);
          const r = parseFloat(c.riskFreeRate);
          const sigma = parseFloat(c.impliedVolatility);
          const greeks = blackScholes(input.spotPrice!, K, T, r, sigma, c.optionType);
          const moneyness = input.spotPrice! > K ? (c.optionType === "CALL" ? "ITM" : "OTM") : input.spotPrice! < K ? (c.optionType === "CALL" ? "OTM" : "ITM") : "ATM";
          return { contract: c, greeks, moneyness };
        });
      }

      const conditions = [eq(optionsContracts.status, "ACTIVE")];
      if (input.underlyingContractId) conditions.push(eq(optionsContracts.underlyingContractId, input.underlyingContractId));
      if (input.optionType !== "ALL") conditions.push(eq(optionsContracts.optionType, input.optionType));
      const contracts = await db.select().from(optionsContracts).where(and(...conditions)).orderBy(optionsContracts.strikePrice, optionsContracts.expiryDate);
      if (!input.spotPrice) return contracts.map(c => ({ contract: c, greeks: null }));
      return contracts.map(c => {
        const T = timeToExpiryYears(c.expiryDate);
        const K = parseFloat(c.strikePrice);
        const r = parseFloat(c.riskFreeRate);
        const sigma = parseFloat(c.impliedVolatility);
        const greeks = blackScholes(input.spotPrice!, K, T, r, sigma, c.optionType);
        const moneyness = input.spotPrice! > K ? (c.optionType === "CALL" ? "ITM" : "OTM") : input.spotPrice! < K ? (c.optionType === "CALL" ? "OTM" : "ITM") : "ATM";
        return { contract: c, greeks, moneyness };
      });
    }),

  buyOption: protectedProcedure
    .input(z.object({
      contractId: z.number().int().positive(),
      quantity: z.number().positive(),
      spotPrice: z.number().positive(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) {
        const contract = _memOContracts.get(input.contractId);
        if (!contract) throw new TRPCError({ code: "NOT_FOUND", message: "Contract not found" });
        if (contract.status !== "ACTIVE") throw new TRPCError({ code: "BAD_REQUEST", message: `Contract is ${contract.status}` });
        const T = timeToExpiryYears(contract.expiryDate);
        if (T <= 0) throw new TRPCError({ code: "BAD_REQUEST", message: "Contract has expired" });
        const K = parseFloat(contract.strikePrice);
        const r = parseFloat(contract.riskFreeRate);
        const sigma = parseFloat(contract.impliedVolatility);
        const contractSize = parseFloat(contract.contractSize);
        const { premium } = blackScholes(input.spotPrice, K, T, r, sigma, contract.optionType);
        const totalCost = premium * input.quantity * contractSize;

        let clearingAccount = _memOClearingAccounts.get(ctx.user.id);
        if (!clearingAccount) {
          clearingAccount = { id: ctx.user.id, userId: ctx.user.id, cashBalance: "50000000", portfolioValue: "50000000", status: "ACTIVE" };
          _memOClearingAccounts.set(ctx.user.id, clearingAccount);
        }
        const balance = parseFloat(clearingAccount.cashBalance);
        if (balance < totalCost) throw new TRPCError({ code: "BAD_REQUEST", message: `Insufficient funds. Required: ${totalCost.toFixed(2)}, Available: ${balance.toFixed(2)}` });
        clearingAccount.cashBalance = String(balance - totalCost);

        const id = _opSeq++;
        const now = new Date();
        const position = {
          id, userId: ctx.user.id, contractId: input.contractId,
          optionType: contract.optionType, quantity: String(input.quantity),
          premiumPaid: String(premium), totalCost: String(totalCost),
          strikePrice: contract.strikePrice, expiryDate: contract.expiryDate,
          status: "OPEN", exercisedAt: null, settlementPnl: null, closedAt: null,
          openedAt: now, updatedAt: now,
        };
        _memOPositions.set(id, position);
        contract.openInterest = (contract.openInterest || 0) + Math.round(input.quantity);
        contract.lastPrice = String(premium);
        return { position, premium, totalCost };
      }

      const [contract] = await db.select().from(optionsContracts).where(eq(optionsContracts.id, input.contractId)).limit(1);
      if (!contract) throw new TRPCError({ code: "NOT_FOUND", message: "Contract not found" });
      if (contract.status !== "ACTIVE") throw new TRPCError({ code: "BAD_REQUEST", message: `Contract is ${contract.status}` });
      const T = timeToExpiryYears(contract.expiryDate);
      if (T <= 0) throw new TRPCError({ code: "BAD_REQUEST", message: "Contract has expired" });
      const K = parseFloat(contract.strikePrice);
      const r = parseFloat(contract.riskFreeRate);
      const sigma = parseFloat(contract.impliedVolatility);
      const contractSize = parseFloat(contract.contractSize);
      const { premium } = blackScholes(input.spotPrice, K, T, r, sigma, contract.optionType);
      const totalCost = premium * input.quantity * contractSize;

      const [clearingAccount] = await db.select().from(clearingAccounts).where(eq(clearingAccounts.userId, ctx.user.id)).limit(1);
      if (!clearingAccount) throw new TRPCError({ code: "BAD_REQUEST", message: "No clearing account found. Please open a clearing account first." });
      const balance = parseFloat(clearingAccount.cashBalance);
      if (balance < totalCost) throw new TRPCError({ code: "BAD_REQUEST", message: `Insufficient funds. Required: ${totalCost.toFixed(2)}, Available: ${balance.toFixed(2)}` });
      await db.update(clearingAccounts).set({ cashBalance: String(balance - totalCost), updatedAt: new Date() }).where(eq(clearingAccounts.id, clearingAccount.id));
      const [position] = await db.insert(optionsPositions).values({
        userId: ctx.user.id, contractId: input.contractId, optionType: contract.optionType,
        quantity: String(input.quantity), premiumPaid: String(premium), totalCost: String(totalCost),
        strikePrice: contract.strikePrice, expiryDate: contract.expiryDate,
      }).returning();
      await db.update(optionsContracts).set({ openInterest: sql`${optionsContracts.openInterest} + ${Math.round(input.quantity)}`, lastPrice: String(premium), updatedAt: new Date() }).where(eq(optionsContracts.id, input.contractId));
      return { position, premium, totalCost };
    }),

  myOptionsPositions: protectedProcedure
    .input(z.object({ status: z.enum(["OPEN", "EXERCISED", "EXPIRED", "CLOSED", "ALL"]).default("OPEN") }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) {
        let positions = Array.from(_memOPositions.values()).filter(p => p.userId === ctx.user.id);
        if (input.status !== "ALL") positions = positions.filter(p => p.status === input.status);
        return positions.map(p => ({ position: p, contract: _memOContracts.get(p.contractId) ?? null }));
      }

      const conditions = [eq(optionsPositions.userId, ctx.user.id)];
      if (input.status !== "ALL") conditions.push(eq(optionsPositions.status, input.status));
      const positions = await db.select({ position: optionsPositions, contract: optionsContracts })
        .from(optionsPositions).innerJoin(optionsContracts, eq(optionsPositions.contractId, optionsContracts.id))
        .where(and(...conditions)).orderBy(desc(optionsPositions.openedAt));
      return positions;
    }),

  exerciseOption: protectedProcedure
    .input(z.object({
      positionId: z.number().int().positive(),
      spotPrice: z.number().positive(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) {
        const pos = _memOPositions.get(input.positionId);
        if (!pos || pos.userId !== ctx.user.id) throw new TRPCError({ code: "NOT_FOUND", message: "Position not found" });
        if (pos.status !== "OPEN") throw new TRPCError({ code: "BAD_REQUEST", message: `Position is already ${pos.status}` });
        const T = timeToExpiryYears(pos.expiryDate);
        if (T > 0.01) {
          const strike = parseFloat(pos.strikePrice);
          const isITM = pos.optionType === "CALL" ? input.spotPrice > strike : input.spotPrice < strike;
          if (!isITM) throw new TRPCError({ code: "BAD_REQUEST", message: "Option is not in-the-money — exercise rejected" });
        }
        const qty = parseFloat(pos.quantity);
        const strike = parseFloat(pos.strikePrice);
        const contract = _memOContracts.get(pos.contractId);
        const contractSize = contract ? parseFloat(contract.contractSize) : 1;
        const intrinsicValue = pos.optionType === "CALL" ? Math.max(0, input.spotPrice - strike) : Math.max(0, strike - input.spotPrice);
        const settlementPnl = intrinsicValue * qty * contractSize;
        if (settlementPnl > 0) {
          let ca = _memOClearingAccounts.get(ctx.user.id);
          if (!ca) { ca = { id: ctx.user.id, userId: ctx.user.id, cashBalance: "0", portfolioValue: "0", status: "ACTIVE" }; _memOClearingAccounts.set(ctx.user.id, ca); }
          ca.cashBalance = String(parseFloat(ca.cashBalance) + settlementPnl);
        }
        pos.status = "EXERCISED";
        pos.exercisedAt = new Date();
        pos.settlementPnl = String(settlementPnl);
        pos.closedAt = new Date();
        pos.updatedAt = new Date();
        return { position: pos, settlementPnl, intrinsicValue };
      }

      const [pos] = await db.select().from(optionsPositions).where(and(eq(optionsPositions.id, input.positionId), eq(optionsPositions.userId, ctx.user.id))).limit(1);
      if (!pos) throw new TRPCError({ code: "NOT_FOUND", message: "Position not found" });
      if (pos.status !== "OPEN") throw new TRPCError({ code: "BAD_REQUEST", message: `Position is already ${pos.status}` });
      const T = timeToExpiryYears(pos.expiryDate);
      if (T > 0.01) {
        const strike = parseFloat(pos.strikePrice);
        const isITM = pos.optionType === "CALL" ? input.spotPrice > strike : input.spotPrice < strike;
        if (!isITM) throw new TRPCError({ code: "BAD_REQUEST", message: "Option is not in-the-money — exercise rejected" });
      }
      const qty = parseFloat(pos.quantity);
      const strike = parseFloat(pos.strikePrice);
      const [contract] = await db.select().from(optionsContracts).where(eq(optionsContracts.id, pos.contractId)).limit(1);
      const contractSize = contract ? parseFloat(contract.contractSize) : 1;
      const intrinsicValue = pos.optionType === "CALL" ? Math.max(0, input.spotPrice - strike) : Math.max(0, strike - input.spotPrice);
      const settlementPnl = intrinsicValue * qty * contractSize;
      if (settlementPnl > 0) {
        const [ca] = await db.select().from(clearingAccounts).where(eq(clearingAccounts.userId, ctx.user.id)).limit(1);
        if (ca) await db.update(clearingAccounts).set({ cashBalance: String(parseFloat(ca.cashBalance) + settlementPnl), updatedAt: new Date() }).where(eq(clearingAccounts.id, ca.id));
      }
      const [updated] = await db.update(optionsPositions).set({ status: "EXERCISED", exercisedAt: new Date(), settlementPnl: String(settlementPnl), closedAt: new Date() }).where(eq(optionsPositions.id, input.positionId)).returning();
      return { position: updated, settlementPnl, intrinsicValue };
    }),

  adminSettleExpiredOptions: protectedProcedure
    .input(z.object({ contractId: z.number().int().positive(), settlementPrice: z.number().positive() }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
      const db = await getDb();
      if (!db) {
        const contract = _memOContracts.get(input.contractId);
        if (!contract) throw new TRPCError({ code: "NOT_FOUND", message: "Contract not found" });
        const positions = Array.from(_memOPositions.values()).filter(p => p.contractId === input.contractId && p.status === "OPEN");
        const contractSize = parseFloat(contract.contractSize);
        let totalSettled = 0, totalPayout = 0;
        for (const pos of positions) {
          const qty = parseFloat(pos.quantity);
          const strike = parseFloat(pos.strikePrice);
          const intrinsicValue = pos.optionType === "CALL" ? Math.max(0, input.settlementPrice - strike) : Math.max(0, strike - input.settlementPrice);
          const payout = intrinsicValue * qty * contractSize;
          pos.status = intrinsicValue > 0 ? "EXERCISED" : "EXPIRED";
          pos.settlementPnl = String(payout);
          pos.closedAt = new Date();
          totalSettled++; totalPayout += payout;
        }
        contract.status = "SETTLED";
        return { positionsSettled: totalSettled, totalPayout, settlementPrice: input.settlementPrice };
      }

      const [contract] = await db.select().from(optionsContracts).where(eq(optionsContracts.id, input.contractId)).limit(1);
      if (!contract) throw new TRPCError({ code: "NOT_FOUND", message: "Contract not found" });
      const openPositions = await db.select().from(optionsPositions).where(and(eq(optionsPositions.contractId, input.contractId), eq(optionsPositions.status, "OPEN")));
      const contractSize = parseFloat(contract.contractSize);
      let totalSettled = 0, totalPayout = 0;
      for (const pos of openPositions) {
        const qty = parseFloat(pos.quantity);
        const strike = parseFloat(pos.strikePrice);
        const intrinsicValue = pos.optionType === "CALL" ? Math.max(0, input.settlementPrice - strike) : Math.max(0, strike - input.settlementPrice);
        const payout = intrinsicValue * qty * contractSize;
        const newStatus = intrinsicValue > 0 ? "EXERCISED" : "EXPIRED";
        if (payout > 0) {
          const [ca] = await db.select().from(clearingAccounts).where(eq(clearingAccounts.userId, pos.userId)).limit(1);
          if (ca) await db.update(clearingAccounts).set({ cashBalance: String(parseFloat(ca.cashBalance) + payout), updatedAt: new Date() }).where(eq(clearingAccounts.id, ca.id));
        }
        await db.update(optionsPositions).set({ status: newStatus, exercisedAt: newStatus === "EXERCISED" ? new Date() : null, settlementPnl: String(payout), closedAt: new Date() }).where(eq(optionsPositions.id, pos.id));
        totalSettled++; totalPayout += payout;
      }
      await db.update(optionsContracts).set({ status: "SETTLED", updatedAt: new Date() }).where(eq(optionsContracts.id, input.contractId));
      return { positionsSettled: totalSettled, totalPayout, settlementPrice: input.settlementPrice };
    }),

  adminGetOptionsStats: protectedProcedure
    .query(async ({ ctx }) => {
      if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
      const db = await getDb();
      if (!db) {
        const contracts = Array.from(_memOContracts.values());
        const positions = Array.from(_memOPositions.values());
        return {
          totalContracts: contracts.length,
          activeContracts: contracts.filter(c => c.status === "ACTIVE").length,
          expiredContracts: contracts.filter(c => c.status === "EXPIRED").length,
          settledContracts: contracts.filter(c => c.status === "SETTLED").length,
          totalOpenInterest: contracts.reduce((s, c) => s + (c.openInterest || 0), 0),
          callContracts: contracts.filter(c => c.optionType === "CALL").length,
          putContracts: contracts.filter(c => c.optionType === "PUT").length,
          totalPositions: positions.length,
          openPositions: positions.filter(p => p.status === "OPEN").length,
          totalPremiumCollected: positions.reduce((s, p) => s + parseFloat(p.totalCost || "0"), 0),
        };
      }

      const [contractStats] = await db.select({
        totalContracts: sql<number>`COUNT(*)::int`,
        activeContracts: sql<number>`SUM(CASE WHEN status = 'ACTIVE' THEN 1 ELSE 0 END)::int`,
        expiredContracts: sql<number>`SUM(CASE WHEN status = 'EXPIRED' THEN 1 ELSE 0 END)::int`,
        settledContracts: sql<number>`SUM(CASE WHEN status = 'SETTLED' THEN 1 ELSE 0 END)::int`,
        totalOpenInterest: sql<number>`COALESCE(SUM(open_interest), 0)::int`,
        callContracts: sql<number>`SUM(CASE WHEN option_type = 'CALL' THEN 1 ELSE 0 END)::int`,
        putContracts: sql<number>`SUM(CASE WHEN option_type = 'PUT' THEN 1 ELSE 0 END)::int`,
      }).from(optionsContracts);
      const [positionStats] = await db.select({
        totalPositions: sql<number>`COUNT(*)::int`,
        openPositions: sql<number>`SUM(CASE WHEN status = 'OPEN' THEN 1 ELSE 0 END)::int`,
        totalPremiumCollected: sql<string>`COALESCE(SUM(total_cost::numeric), 0)::text`,
      }).from(optionsPositions);
      return {
        totalContracts: contractStats?.totalContracts ?? 0,
        activeContracts: contractStats?.activeContracts ?? 0,
        expiredContracts: contractStats?.expiredContracts ?? 0,
        settledContracts: contractStats?.settledContracts ?? 0,
        totalOpenInterest: contractStats?.totalOpenInterest ?? 0,
        callContracts: contractStats?.callContracts ?? 0,
        putContracts: contractStats?.putContracts ?? 0,
        totalPositions: positionStats?.totalPositions ?? 0,
        openPositions: positionStats?.openPositions ?? 0,
        totalPremiumCollected: parseFloat(positionStats?.totalPremiumCollected ?? "0"),
      };
    }),

  adminGetAllOpenOptionsPositions: protectedProcedure
    .input(z.object({ page: z.number().int().min(1).default(1), limit: z.number().int().min(1).max(100).default(50) }))
    .query(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
      const db = await getDb();
      if (!db) {
        const positions = Array.from(_memOPositions.values()).filter(p => p.status === "OPEN");
        const offset = (input.page - 1) * input.limit;
        const paged = positions.slice(offset, offset + input.limit).map(p => ({ position: p, contract: _memOContracts.get(p.contractId) ?? null }));
        return { positions: paged, total: positions.length };
      }

      const offset = (input.page - 1) * input.limit;
      const [positions, countRow] = await Promise.all([
        db.select({ position: optionsPositions, contract: optionsContracts })
          .from(optionsPositions).innerJoin(optionsContracts, eq(optionsPositions.contractId, optionsContracts.id))
          .where(eq(optionsPositions.status, "OPEN")).orderBy(desc(optionsPositions.openedAt)).limit(input.limit).offset(offset),
        db.select({ total: sql<number>`COUNT(*)::int` }).from(optionsPositions).where(eq(optionsPositions.status, "OPEN")),
      ]);
      return { positions, total: countRow[0]?.total ?? 0 };
    }),
});
