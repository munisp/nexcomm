import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { adminProcedure, protectedProcedure, router } from "../_core/trpc";
import { requireSettlementApprove } from "../_core/permify";
import { getDb } from "../db";
import {
  settlementCycles,
  settlementPositions,
  settlementInstructions,
  settlementFails,
  orders,
  users,
} from "../../drizzle/schema";
import { eq, and, desc, count, sum, sql, gte, lte, inArray } from "drizzle-orm";
import { notifyOwner } from "../_core/notification";
import { writeAuditLog } from "../audit";

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function computeNetPositions(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  cycleId: number,
  cycleDate: Date,
  settlementType: string
): Promise<void> {
  const daysBack = settlementType === "T+0" ? 0 : settlementType === "T+1" ? 1 : settlementType === "T+2" ? 2 : 3;
  const windowEnd = new Date(cycleDate);
  const windowStart = new Date(cycleDate);
  windowStart.setDate(windowStart.getDate() - daysBack);
  windowStart.setHours(0, 0, 0, 0);
  windowEnd.setHours(23, 59, 59, 999);

  const filledOrders = await db.select().from(orders).where(and(eq(orders.status, "FILLED"), gte(orders.updatedAt, windowStart), lte(orders.updatedAt, windowEnd)));

  const positionMap = new Map<string, { userId: number; instrument: string; grossBuyQty: number; grossSellQty: number; grossBuyValue: number; grossSellValue: number; }>();

  for (const order of filledOrders) {
    const key = `${order.userId}:${order.symbol}`;
    const existing = positionMap.get(key) ?? { userId: order.userId, instrument: order.symbol, grossBuyQty: 0, grossSellQty: 0, grossBuyValue: 0, grossSellValue: 0 };
    const qty = parseFloat(order.filledQty);
    const price = parseFloat(order.avgFillPrice ?? order.price ?? "0");
    const value = qty * price;
    if (order.side === "BUY") { existing.grossBuyQty += qty; existing.grossBuyValue += value; }
    else { existing.grossSellQty += qty; existing.grossSellValue += value; }
    positionMap.set(key, existing);
  }

  for (const pos of Array.from(positionMap.values())) {
    const netQty = pos.grossBuyQty - pos.grossSellQty;
    const netCashObligation = pos.grossBuyValue - pos.grossSellValue;
    await db.insert(settlementPositions).values({ cycleId, userId: pos.userId, instrument: pos.instrument, grossBuyQty: String(pos.grossBuyQty), grossSellQty: String(pos.grossSellQty), netQty: String(netQty), grossBuyValue: String(pos.grossBuyValue), grossSellValue: String(pos.grossSellValue), netCashObligation: String(netCashObligation), status: "PENDING" });
  }

  const instruments = new Set(Array.from(positionMap.values()).map((p) => p.instrument));
  let totalTrades = 0;
  let matchedTrades = 0;

  for (const instrument of Array.from(instruments)) {
    const buyers = Array.from(positionMap.values()).filter((p) => p.instrument === instrument && p.grossBuyQty > p.grossSellQty);
    const sellers = Array.from(positionMap.values()).filter((p) => p.instrument === instrument && p.grossSellQty > p.grossBuyQty);
    for (const buyer of buyers) {
      for (const seller of sellers) {
        const matchQty = Math.min(buyer.grossBuyQty - buyer.grossSellQty, seller.grossSellQty - seller.grossBuyQty);
        if (matchQty <= 0) continue;
        const avgPrice = (buyer.grossBuyValue / buyer.grossBuyQty + seller.grossSellValue / seller.grossSellQty) / 2;
        const totalValue = matchQty * avgPrice;
        await db.insert(settlementInstructions).values({ cycleId, buyerUserId: buyer.userId, sellerUserId: seller.userId, instrument, quantity: String(matchQty), price: String(avgPrice), totalValue: String(totalValue), instructionType: "DVP", status: "MATCHED", confirmedAt: new Date() });
        totalTrades++;
        matchedTrades++;
      }
    }
  }

  await db.update(settlementCycles).set({ totalTrades, matchedTrades, status: "MATCHED", matchedAt: new Date(), updatedAt: new Date() }).where(eq(settlementCycles.id, cycleId));
}

// ─── In-memory fallback stores ────────────────────────────────────────────────
interface MemCycle {
  id: number; cycleDate: Date; settlementType: string; assetClass: string; currency: string;
  status: string; totalTrades: number; matchedTrades: number; failedTrades: number;
  grossValue: string; netValue: string; createdBy: number;
  openedAt: Date; matchedAt: Date | null; settledAt: Date | null; updatedAt: Date;
}
interface MemInstruction {
  id: number; cycleId: number; buyerUserId: number; sellerUserId: number;
  instrument: string; quantity: string; price: string; totalValue: string;
  instructionType: string; status: string; confirmedAt: Date | null;
  settledAt: Date | null; failureReason: string | null; createdAt: Date; updatedAt: Date;
}
interface MemFail {
  id: number; instructionId: number; cycleId: number; failType: string;
  failedPartyUserId: number; status: string; escalatedTo: string | null;
  escalatedAt: Date | null; resolvedAt: Date | null; resolutionNotes: string | null;
  penaltyAmount: string; reviewedBy: number | null; createdAt: Date; updatedAt: Date;
}

const _cycles: MemCycle[] = [];
const _instructions: MemInstruction[] = [];
const _fails: MemFail[] = [];

// ─── Router ──────────────────────────────────────────────────────────────────

export const settlementEngineRouter = router({
  // ── Admin: Cycle management ────────────────────────────────────────────────
  adminCreateCycle: adminProcedure
    .input(z.object({
      cycleDate: z.date(),
      settlementType: z.enum(["T+0", "T+1", "T+2", "T+3"]).default("T+1"),
      assetClass: z.enum(["COMMODITY", "EQUITY", "FX", "CRYPTO"]).default("COMMODITY"),
      currency: z.string().max(8).default("NGN"),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable — please try again" });
      const existing = await db.select({ id: settlementCycles.id }).from(settlementCycles).where(and(eq(settlementCycles.cycleDate, input.cycleDate), eq(settlementCycles.settlementType, input.settlementType), eq(settlementCycles.assetClass, input.assetClass))).limit(1);
      if (existing.length > 0) throw new TRPCError({ code: "CONFLICT", message: "A settlement cycle already exists for this date, type, and asset class" });
      const [cycle] = await db.insert(settlementCycles).values({ cycleDate: input.cycleDate, settlementType: input.settlementType, assetClass: input.assetClass, currency: input.currency, status: "OPEN", createdBy: ctx.user.id }).returning();
      return cycle;
    }),

  adminRunMatching: adminProcedure
    .input(z.object({ cycleId: z.number() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable — please try again" });
      const [cycle] = await db.select().from(settlementCycles).where(eq(settlementCycles.id, input.cycleId)).limit(1);
      if (!cycle) throw new TRPCError({ code: "NOT_FOUND", message: "Cycle not found" });
      if (cycle.status !== "OPEN") throw new TRPCError({ code: "BAD_REQUEST", message: `Cycle is in status ${cycle.status}, not OPEN` });
      await db.update(settlementCycles).set({ status: "MATCHING", updatedAt: new Date() }).where(eq(settlementCycles.id, input.cycleId));
      await computeNetPositions(db, input.cycleId, cycle.cycleDate, cycle.settlementType);
      const [updated] = await db.select().from(settlementCycles).where(eq(settlementCycles.id, input.cycleId)).limit(1);
      return updated;
    }),

  adminConfirmDVP: adminProcedure
    .input(z.object({ cycleId: z.number(), instructionIds: z.array(z.number()).optional() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable — please try again" });
      const conditions = [eq(settlementInstructions.cycleId, input.cycleId), eq(settlementInstructions.status, "MATCHED")];
      if (input.instructionIds && input.instructionIds.length > 0) conditions.push(inArray(settlementInstructions.id, input.instructionIds));
      const confirmed = await db.update(settlementInstructions).set({ status: "CONFIRMED", confirmedAt: new Date(), updatedAt: new Date() }).where(and(...conditions)).returning();
      return { confirmedCount: confirmed.length };
    }),

  adminSettleCycle: adminProcedure
    .use(requireSettlementApprove)
    .input(z.object({ cycleId: z.number() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable — please try again" });
      const settled = await db.update(settlementInstructions).set({ status: "SETTLED", settledAt: new Date(), updatedAt: new Date() }).where(and(eq(settlementInstructions.cycleId, input.cycleId), eq(settlementInstructions.status, "CONFIRMED"))).returning();
      await db.update(settlementPositions).set({ status: "SETTLED", settledAt: new Date(), updatedAt: new Date() }).where(and(eq(settlementPositions.cycleId, input.cycleId), eq(settlementPositions.status, "CONFIRMED")));
      const [failCount] = await db.select({ cnt: count() }).from(settlementInstructions).where(and(eq(settlementInstructions.cycleId, input.cycleId), eq(settlementInstructions.status, "FAILED")));
      const [valueStats] = await db.select({ gross: sum(settlementInstructions.totalValue) }).from(settlementInstructions).where(and(eq(settlementInstructions.cycleId, input.cycleId), eq(settlementInstructions.status, "SETTLED")));
      const grossValue = parseFloat(valueStats?.gross ?? "0");
      const [cycle] = await db.update(settlementCycles).set({ status: "SETTLED", settledAt: new Date(), failedTrades: Number(failCount?.cnt ?? 0), grossValue: String(grossValue), netValue: String(grossValue), updatedAt: new Date() }).where(eq(settlementCycles.id, input.cycleId)).returning();
      await notifyOwner({ title: `Settlement Cycle Settled: Cycle #${input.cycleId}`, content: `Settlement cycle #${input.cycleId} has been settled. ${settled.length} instructions settled, gross value: ${grossValue.toLocaleString()}.` });
      return cycle;
    }),

  adminMarkFailed: adminProcedure
    .input(z.object({ instructionId: z.number(), failType: z.enum(["INSUFFICIENT_FUNDS", "INSUFFICIENT_STOCK", "COUNTERPARTY_DEFAULT", "SYSTEM_ERROR"]), failureReason: z.string().max(1000) }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable — please try again" });
      const [instruction] = await db.update(settlementInstructions).set({ status: "FAILED", failureReason: input.failureReason, updatedAt: new Date() }).where(eq(settlementInstructions.id, input.instructionId)).returning();
      if (!instruction) throw new TRPCError({ code: "NOT_FOUND" });
      const [fail] = await db.insert(settlementFails).values({ instructionId: input.instructionId, cycleId: instruction.cycleId, failType: input.failType, failedPartyUserId: instruction.buyerUserId, status: "OPEN" }).returning();
      await db.update(settlementCycles).set({ failedTrades: sql`${settlementCycles.failedTrades} + 1`, updatedAt: new Date() }).where(eq(settlementCycles.id, instruction.cycleId));
      await notifyOwner({ title: `Settlement Fail: Instruction #${input.instructionId}`, content: `Settlement instruction #${input.instructionId} failed. Type: ${input.failType}. Reason: ${input.failureReason}` });
      return { instruction, fail };
    }),

  adminEscalateFail: adminProcedure
    .input(z.object({ failId: z.number(), escalatedTo: z.string().max(128), notes: z.string().max(2000).optional() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable — please try again" });
      const [updated] = await db.update(settlementFails).set({ status: "ESCALATED", escalatedTo: input.escalatedTo, escalatedAt: new Date(), resolutionNotes: input.notes ?? null, reviewedBy: ctx.user.id, updatedAt: new Date() }).where(eq(settlementFails.id, input.failId)).returning();
      if (!updated) throw new TRPCError({ code: "NOT_FOUND" });
      return updated;
    }),

  adminResolveFail: adminProcedure
    .input(z.object({ failId: z.number(), resolutionNotes: z.string().max(2000), penaltyAmount: z.number().min(0).optional() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable — please try again" });
      const [updated] = await db.update(settlementFails).set({ status: "RESOLVED", resolvedAt: new Date(), resolutionNotes: input.resolutionNotes, penaltyAmount: input.penaltyAmount ? String(input.penaltyAmount) : "0", reviewedBy: ctx.user.id, updatedAt: new Date() }).where(eq(settlementFails.id, input.failId)).returning();
      if (!updated) throw new TRPCError({ code: "NOT_FOUND" });
      return updated;
    }),

  adminListCycles: adminProcedure
    .input(z.object({ status: z.enum(["OPEN", "MATCHING", "MATCHED", "SETTLING", "SETTLED", "FAILED", "ALL"]).default("ALL"), limit: z.number().int().min(1).max(100).default(20), offset: z.number().int().min(0).default(0) }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable — please try again" });
      const condition = input.status !== "ALL" ? eq(settlementCycles.status, input.status) : undefined;
      const [cycles, [{ total }]] = await Promise.all([
        db.select().from(settlementCycles).where(condition).orderBy(desc(settlementCycles.openedAt)).limit(input.limit).offset(input.offset),
        db.select({ total: count() }).from(settlementCycles).where(condition),
      ]);
      return { cycles, total: Number(total) };
    }),

  adminGetCycleDetail: adminProcedure
    .input(z.object({ cycleId: z.number() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable — please try again" });
      const [cycle] = await db.select().from(settlementCycles).where(eq(settlementCycles.id, input.cycleId)).limit(1);
      if (!cycle) throw new TRPCError({ code: "NOT_FOUND" });
      const [positions, instructions, fails] = await Promise.all([
        db.select().from(settlementPositions).where(eq(settlementPositions.cycleId, input.cycleId)).orderBy(desc(settlementPositions.netCashObligation)),
        db.select().from(settlementInstructions).where(eq(settlementInstructions.cycleId, input.cycleId)).orderBy(desc(settlementInstructions.createdAt)),
        db.select().from(settlementFails).where(eq(settlementFails.cycleId, input.cycleId)).orderBy(desc(settlementFails.createdAt)),
      ]);
      return { cycle, positions, instructions, fails };
    }),

  adminGetStats: adminProcedure.query(async () => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable — please try again" });
    const [cycleStats, failStats, recentCycles] = await Promise.all([
      db.select({ status: settlementCycles.status, cnt: count(), totalGross: sum(settlementCycles.grossValue) }).from(settlementCycles).groupBy(settlementCycles.status),
      db.select({ failType: settlementFails.failType, status: settlementFails.status, cnt: count() }).from(settlementFails).groupBy(settlementFails.failType, settlementFails.status),
      db.select().from(settlementCycles).orderBy(desc(settlementCycles.openedAt)).limit(5),
    ]);
    return { cycleStats, failStats, recentCycles };
  }),

  adminListFails: adminProcedure
    .input(z.object({ status: z.enum(["OPEN", "UNDER_REVIEW", "RESOLVED", "ESCALATED", "WRITTEN_OFF", "ALL"]).default("OPEN"), limit: z.number().int().min(1).max(100).default(50), offset: z.number().int().min(0).default(0) }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable — please try again" });
      const condition = input.status !== "ALL" ? eq(settlementFails.status, input.status) : undefined;
      const [fails, [{ total }]] = await Promise.all([
        db.select().from(settlementFails).where(condition).orderBy(desc(settlementFails.createdAt)).limit(input.limit).offset(input.offset),
        db.select({ total: count() }).from(settlementFails).where(condition),
      ]);
      return { fails, total: Number(total) };
    }),

  // ── Protected: User's settlement view ─────────────────────────────────────
  myPositions: protectedProcedure
    .input(z.object({ cycleId: z.number().optional(), limit: z.number().int().min(1).max(50).default(20) }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) return [];
      const conditions = [eq(settlementPositions.userId, ctx.user.id)];
      if (input.cycleId) conditions.push(eq(settlementPositions.cycleId, input.cycleId));
      return db.select().from(settlementPositions).where(and(...conditions)).orderBy(desc(settlementPositions.createdAt)).limit(input.limit);
    }),

  // ── Test helper: create instruction directly (for test environment only) ────
  adminCreateTestInstruction: adminProcedure
    .input(z.object({
      cycleId: z.number(),
      buyerUserId: z.number(),
      sellerUserId: z.number(),
      instrument: z.string(),
      quantity: z.string(),
      price: z.string(),
      totalValue: z.string(),
      status: z.string().default("CONFIRMED"),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable — please try again" });
      const [instr] = await db.insert(settlementInstructions).values({
        cycleId: input.cycleId, buyerUserId: input.buyerUserId, sellerUserId: input.sellerUserId,
        instrument: input.instrument, quantity: input.quantity, price: input.price,
        totalValue: input.totalValue, instructionType: "DVP", status: input.status,
        confirmedAt: input.status === "CONFIRMED" ? new Date() : null,
      }).returning();
      return instr;
    }),

  myInstructions: protectedProcedure
    .input(z.object({ limit: z.number().int().min(1).max(50).default(20) }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) return [];
      return db.select().from(settlementInstructions).where(sql`${settlementInstructions.buyerUserId} = ${ctx.user.id} OR ${settlementInstructions.sellerUserId} = ${ctx.user.id}`).orderBy(desc(settlementInstructions.createdAt)).limit(input.limit);
    }),
});
