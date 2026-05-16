import { randomUUID } from 'crypto';

// ─── In-memory fallback stores ────────────────────────────────────────────────
type MemAccount = {
  id: number; userId: number; accountRef: string; status: string;
  initialMarginPct: string; maintenanceMarginPct: string;
  portfolioValue: string; cashBalance: string;
  totalMarginRequired: string; totalMarginPosted: string;
  equityRatio: string; notes: string | null;
  lastValuationAt: Date | null; createdAt: Date; updatedAt: Date;
};
type MemMarginCall = {
  id: number; clearingAccountId: number; userId: number; callRef: string;
  status: string; equityRatioAtCall: string; portfolioValueAtCall: string;
  marginDeficit: string; amountRequired: string; amountReceived: string;
  dueAt: Date; issuedBy: number | null; resolvedAt: Date | null;
  autoLiquidationTriggeredAt: Date | null; notes: string | null;
  issuedAt: Date;
};
const _memAccounts = new Map<number, MemAccount>();
const _memMarginCalls = new Map<number, MemMarginCall>();
let _accSeq = 1;
let _mcSeq = 1;
import { z } from "zod";
import { protectedProcedure, publicProcedure, router } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import { getDb } from "../db";
import {
  clearingAccounts,
  marginCalls,
  marginCallEvents,
  autoLiquidationOrders,
} from "../../drizzle/schema";
import { eq, desc, and, lt, gte, sql, inArray } from "drizzle-orm";
import { notifyOwner } from "../_core/notification";
import { writeAuditLog } from "../audit";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function generateAccountRef(): string {
  const ts = Date.now().toString(36).toUpperCase();
  return `CA-${ts}-${randomUUID().substring(0,6).toUpperCase()}`;
}

function generateCallRef(): string {
  const ts = Date.now().toString(36).toUpperCase();
  return `MC-${ts}-${randomUUID().substring(0,6).toUpperCase()}`;
}

function computeEquityRatio(portfolioValue: number, cashBalance: number, marginRequired: number): number {
  const totalEquity = portfolioValue + cashBalance;
  if (marginRequired <= 0) return 1;
  return totalEquity / marginRequired;
}

function computeMarginDeficit(
  portfolioValue: number,
  cashBalance: number,
  maintenanceMarginPct: number,
  initialMarginPct: number
): { deficit: number; required: number; equityRatio: number } {
  const maintenanceRequired = portfolioValue * maintenanceMarginPct;
  const initialRequired = portfolioValue * initialMarginPct;
  // equityRatio = cash posted vs maintenance required (< 1 means below maintenance)
  const equityRatio = maintenanceRequired > 0 ? cashBalance / maintenanceRequired : 1;
  // deficit = how much more cash is needed to meet initial margin requirement
  const deficit = Math.max(0, initialRequired - cashBalance);
  return { deficit, required: initialRequired, equityRatio };
}

// ─── Router ──────────────────────────────────────────────────────────────────

export const clearingHouseRouter = router({
  // Admin: create clearing account for a user
  adminCreateAccount: protectedProcedure
    .input(z.object({
      userId: z.number().int().positive(),
      initialMarginPct: z.number().min(0.01).max(1).default(0.10),
      maintenanceMarginPct: z.number().min(0.01).max(1).default(0.07),
      portfolioValue: z.number().min(0).default(0),
      cashBalance: z.number().min(0).default(0),
      notes: z.string().max(500).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
      const db = await getDb();
      if (!db) {
        const existing = Array.from(_memAccounts.values()).find(a => a.userId === input.userId);
        if (existing) throw new TRPCError({ code: "CONFLICT", message: "Clearing account already exists for this user" });
        const { deficit, required, equityRatio } = computeMarginDeficit(
          input.portfolioValue, input.cashBalance,
          input.maintenanceMarginPct ?? 0.07, input.initialMarginPct ?? 0.10
        );
        const id = _accSeq++;
        const now = new Date();
        const account: MemAccount = {
          id, userId: input.userId,
          accountRef: generateAccountRef(),
          status: "ACTIVE",
          initialMarginPct: String(input.initialMarginPct ?? 0.10),
          maintenanceMarginPct: String(input.maintenanceMarginPct ?? 0.07),
          portfolioValue: String(input.portfolioValue ?? 0),
          cashBalance: String(input.cashBalance ?? 0),
          totalMarginRequired: String(required),
          totalMarginPosted: String(input.cashBalance ?? 0),
          equityRatio: String(equityRatio),
          notes: input.notes ?? null,
          lastValuationAt: null, createdAt: now, updatedAt: now,
        };
        _memAccounts.set(id, account);
        return account;
      }

      // Check for existing account
      const existing = await db.select({ id: clearingAccounts.id })
        .from(clearingAccounts)
        .where(eq(clearingAccounts.userId, input.userId))
        .limit(1);
      if (existing.length > 0) throw new TRPCError({ code: "CONFLICT", message: "Clearing account already exists for this user" });

      const { deficit, required, equityRatio } = computeMarginDeficit(
        input.portfolioValue, input.cashBalance,
        input.maintenanceMarginPct, input.initialMarginPct
      );

      const [account] = await db.insert(clearingAccounts).values({
        userId: input.userId,
        accountRef: generateAccountRef(),
        initialMarginPct: String(input.initialMarginPct),
        maintenanceMarginPct: String(input.maintenanceMarginPct),
        portfolioValue: String(input.portfolioValue),
        cashBalance: String(input.cashBalance),
        totalMarginRequired: String(required),
        totalMarginPosted: String(input.cashBalance),
        equityRatio: String(equityRatio),
        notes: input.notes ?? null,
      }).returning();
      return account;
    }),

  // Admin: list all clearing accounts
  adminListAccounts: protectedProcedure
    .input(z.object({
      status: z.enum(["ACTIVE", "SUSPENDED", "CLOSED"]).optional(),
      limit: z.number().int().min(1).max(200).default(50),
      page: z.number().int().min(1).default(1),
      offset: z.number().int().min(0).optional(),
    }))
    .query(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
      const db = await getDb();
      if (!db) {
        let accounts = Array.from(_memAccounts.values());
        if (input.status) accounts = accounts.filter(a => a.status === input.status);
        const total = accounts.length;
        const offset = input.offset ?? (input.page - 1) * input.limit;
        return { accounts: accounts.slice(offset, offset + input.limit), total };
      }

      const offset = input.offset ?? (input.page - 1) * input.limit;
      const conditions = input.status ? [eq(clearingAccounts.status, input.status)] : [];
      const [countRow] = await db.select({ total: sql<number>`count(*)::int` }).from(clearingAccounts)
        .where(conditions.length > 0 ? and(...conditions) : undefined);
      const accounts = await db.select().from(clearingAccounts)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(clearingAccounts.createdAt))
        .limit(input.limit).offset(offset);
      return { accounts, total: countRow?.total ?? 0 };
    }),

  // Admin: get a single clearing account
  adminGetAccount: protectedProcedure
    .input(z.object({ accountId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
      const db = await getDb();
      if (!db) {
        const account = _memAccounts.get(input.accountId);
        if (!account) throw new TRPCError({ code: "NOT_FOUND" });
        const openCalls = Array.from(_memMarginCalls.values()).filter(c => c.clearingAccountId === input.accountId && c.status === "OPEN");
        return { ...account, openMarginCallCount: openCalls.length, openMarginCalls: openCalls };
      }

      const [account] = await db.select().from(clearingAccounts)
        .where(eq(clearingAccounts.id, input.accountId)).limit(1);
      if (!account) throw new TRPCError({ code: "NOT_FOUND" });

      const openCalls = await db.select().from(marginCalls)
        .where(and(eq(marginCalls.clearingAccountId, input.accountId), eq(marginCalls.status, "OPEN")))
        .orderBy(desc(marginCalls.issuedAt));

      return { ...account, openMarginCallCount: openCalls.length, openMarginCalls: openCalls };
    }),

  // Admin: update margin requirements for an account
  adminUpdateMarginRequirements: protectedProcedure
    .input(z.object({
      accountId: z.number().int().positive(),
      initialMarginPct: z.number().min(0.01).max(1).optional(),
      maintenanceMarginPct: z.number().min(0.01).max(1).optional(),
      status: z.enum(["ACTIVE", "SUSPENDED", "CLOSED"]).optional(),
      notes: z.string().max(500).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
      const db = await getDb();
      if (!db) {
        const account = _memAccounts.get(input.accountId);
        if (!account) throw new TRPCError({ code: "NOT_FOUND" });
        if (input.initialMarginPct !== undefined) account.initialMarginPct = String(input.initialMarginPct);
        if (input.maintenanceMarginPct !== undefined) account.maintenanceMarginPct = String(input.maintenanceMarginPct);
        if (input.status !== undefined) account.status = input.status;
        if (input.notes !== undefined) account.notes = input.notes;
        account.updatedAt = new Date();
        return account;
      }

      const updates: Record<string, unknown> = { updatedAt: new Date() };
      if (input.initialMarginPct !== undefined) updates.initialMarginPct = String(input.initialMarginPct);
      if (input.maintenanceMarginPct !== undefined) updates.maintenanceMarginPct = String(input.maintenanceMarginPct);
      if (input.status !== undefined) updates.status = input.status;
      if (input.notes !== undefined) updates.notes = input.notes;

      const [updated] = await db.update(clearingAccounts)
        .set(updates)
        .where(eq(clearingAccounts.id, input.accountId))
        .returning();
      if (!updated) throw new TRPCError({ code: "NOT_FOUND" });
      return updated;
    }),

  // Admin: revalue a clearing account (update portfolio value and recalculate margin health)
  adminRevalueAccount: protectedProcedure
    .input(z.object({
      accountId: z.number().int().positive(),
      portfolioValue: z.number().min(0),
      cashBalance: z.number().min(0),
    }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
      const db = await getDb();
      if (!db) {
        const account = _memAccounts.get(input.accountId);
        if (!account) throw new TRPCError({ code: "NOT_FOUND" });
        const initPct = parseFloat(account.initialMarginPct);
        const maintPct = parseFloat(account.maintenanceMarginPct);
        const { deficit, required, equityRatio } = computeMarginDeficit(
          input.portfolioValue, input.cashBalance, maintPct, initPct
        );
        account.portfolioValue = String(input.portfolioValue);
        account.cashBalance = String(input.cashBalance);
        account.totalMarginRequired = String(required);
        account.totalMarginPosted = String(input.cashBalance);
        account.equityRatio = String(equityRatio);
        account.lastValuationAt = new Date();
        account.updatedAt = new Date();
        return { account, equityRatio, marginDeficit: deficit, isBelowMaintenance: equityRatio < 1 };
      }

      const [account] = await db.select().from(clearingAccounts)
        .where(eq(clearingAccounts.id, input.accountId)).limit(1);
      if (!account) throw new TRPCError({ code: "NOT_FOUND" });

      const initPct = parseFloat(account.initialMarginPct);
      const maintPct = parseFloat(account.maintenanceMarginPct);
      const { deficit, required, equityRatio } = computeMarginDeficit(
        input.portfolioValue, input.cashBalance, maintPct, initPct
      );

      const [updated] = await db.update(clearingAccounts).set({
        portfolioValue: String(input.portfolioValue),
        cashBalance: String(input.cashBalance),
        totalMarginRequired: String(required),
        totalMarginPosted: String(input.cashBalance),
        equityRatio: String(equityRatio),
        lastValuationAt: new Date(),
        updatedAt: new Date(),
      }).where(eq(clearingAccounts.id, input.accountId)).returning();

      return { account: updated, equityRatio, marginDeficit: deficit, isBelowMaintenance: equityRatio < 1 };
    }),

  // Admin: check margin health for all accounts and return at-risk list
  adminCheckMarginHealth: protectedProcedure
    .input(z.object({ threshold: z.number().min(0).max(1).default(0.08) }))
    .query(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
      const db = await getDb();
            if (!db) return [] as any[];

      const atRisk = await db.select().from(clearingAccounts)
        .where(and(
          eq(clearingAccounts.status, "ACTIVE"),
          lt(clearingAccounts.equityRatio, String(input.threshold))
        ))
        .orderBy(clearingAccounts.equityRatio);

      return {
        atRiskCount: atRisk.length,
        threshold: input.threshold,
        accounts: atRisk,
      };
    }),

  // Admin: trigger a margin call for an account
  adminTriggerMarginCall: protectedProcedure
    .input(z.object({
      accountId: z.number().int().positive(),
      gracePeriodHours: z.number().int().min(1).max(72).default(24),
      notes: z.string().max(500).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
      const db = await getDb();
      if (!db) {
        const account = _memAccounts.get(input.accountId);
        if (!account) throw new TRPCError({ code: "NOT_FOUND" });
        if (account.status !== "ACTIVE") throw new TRPCError({ code: "BAD_REQUEST", message: "Account is not active" });
        const existing = Array.from(_memMarginCalls.values()).find(c => c.clearingAccountId === input.accountId && c.status === "OPEN");
        if (existing) throw new TRPCError({ code: "CONFLICT", message: "An open margin call already exists for this account" });
        const portfolioValue = parseFloat(account.portfolioValue);
        const cashBalance = parseFloat(account.cashBalance);
        const initPct = parseFloat(account.initialMarginPct);
        const maintPct = parseFloat(account.maintenanceMarginPct);
        const { deficit, required, equityRatio } = computeMarginDeficit(portfolioValue, cashBalance, maintPct, initPct);
        if (deficit <= 0) throw new TRPCError({ code: "BAD_REQUEST", message: "Account is not in margin deficit" });
        const id = _mcSeq++;
        const now = new Date();
        const call: MemMarginCall = {
          id, clearingAccountId: input.accountId, userId: account.userId,
          callRef: generateCallRef(), status: "OPEN",
          equityRatioAtCall: String(equityRatio), portfolioValueAtCall: String(portfolioValue),
          marginDeficit: String(deficit), amountRequired: String(deficit), amountReceived: "0",
          dueAt: new Date(Date.now() + (input.gracePeriodHours ?? 24) * 3600 * 1000),
          issuedBy: null, resolvedAt: null, autoLiquidationTriggeredAt: null,
          notes: input.notes ?? null, issuedAt: now,
        };
        _memMarginCalls.set(id, call);
        return call;
      }

      const [account] = await db.select().from(clearingAccounts)
        .where(eq(clearingAccounts.id, input.accountId)).limit(1);
      if (!account) throw new TRPCError({ code: "NOT_FOUND" });
      if (account.status !== "ACTIVE") throw new TRPCError({ code: "BAD_REQUEST", message: "Account is not active" });

      // Check for existing open margin call
      const existing = await db.select({ id: marginCalls.id }).from(marginCalls)
        .where(and(eq(marginCalls.clearingAccountId, input.accountId), eq(marginCalls.status, "OPEN")))
        .limit(1);
      if (existing.length > 0) throw new TRPCError({ code: "CONFLICT", message: "An open margin call already exists for this account" });

      const portfolioValue = parseFloat(account.portfolioValue);
      const cashBalance = parseFloat(account.cashBalance);
      const initPct = parseFloat(account.initialMarginPct);
      const maintPct = parseFloat(account.maintenanceMarginPct);
      const { deficit, required, equityRatio } = computeMarginDeficit(portfolioValue, cashBalance, maintPct, initPct);

      if (deficit <= 0) throw new TRPCError({ code: "BAD_REQUEST", message: "Account is not in margin deficit" });

      const dueAt = new Date(Date.now() + input.gracePeriodHours * 3600 * 1000);

      const [call] = await db.insert(marginCalls).values({
        clearingAccountId: input.accountId,
        userId: account.userId,
        callRef: generateCallRef(),
        equityRatioAtCall: String(equityRatio),
        portfolioValueAtCall: String(portfolioValue),
        marginDeficit: String(deficit),
        amountRequired: String(deficit),
        dueAt,
        issuedBy: ctx.user.id,
        notes: input.notes ?? null,
      }).returning();

      // Record ISSUED event
      await db.insert(marginCallEvents).values({
        marginCallId: call.id,
        eventType: "ISSUED",
        equityRatioAfter: String(equityRatio),
        performedBy: ctx.user.id,
        notes: `Margin call issued. Deficit: ${deficit.toFixed(2)}. Due: ${dueAt.toISOString()}`,
      });

      // Notify owner
      await notifyOwner({
        title: `Margin Call Issued: ${account.accountRef}`,
        content: `User ${account.userId} has been issued a margin call for ₦${deficit.toFixed(2)}. Equity ratio: ${(equityRatio * 100).toFixed(2)}%. Due: ${dueAt.toLocaleDateString()}.`,
      });

      return call;
    }),

  // Admin: list margin calls
  adminListMarginCalls: protectedProcedure
    .input(z.object({
      status: z.enum(["OPEN", "PARTIALLY_MET", "MET", "DEFAULTED", "CANCELLED"]).optional(),
      userId: z.number().int().positive().optional(),
      limit: z.number().int().min(1).max(200).default(50),
      offset: z.number().int().min(0).default(0),
    }))
    .query(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
      const db = await getDb();
            if (!db) return [] as any[];

      const conditions = [];
      if (input.status) conditions.push(eq(marginCalls.status, input.status));
      if (input.userId) conditions.push(eq(marginCalls.userId, input.userId));

      const calls = await db.select().from(marginCalls)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(marginCalls.issuedAt))
        .limit(input.limit).offset(input.offset);
      return calls;
    }),

  // Admin: record deposit received against a margin call
  adminRecordMarginDeposit: protectedProcedure
    .input(z.object({
      marginCallId: z.number().int().positive(),
      amount: z.number().positive(),
      depositRef: z.string().max(100).optional(),
      notes: z.string().max(500).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
      const db = await getDb();
      if (!db) {
        const call = _memMarginCalls.get(input.marginCallId);
        if (!call) throw new TRPCError({ code: "NOT_FOUND" });
        if (call.status === "MET" || call.status === "CANCELLED" || call.status === "DEFAULTED")
          throw new TRPCError({ code: "BAD_REQUEST", message: `Margin call is already ${call.status}` });
        const newReceived = parseFloat(call.amountReceived) + input.amount;
        const required = parseFloat(call.amountRequired);
        const isMet = newReceived >= required;
        call.amountReceived = String(newReceived);
        call.status = isMet ? "MET" : "PARTIALLY_MET";
        if (isMet) call.resolvedAt = new Date();
        return { call, isMet, totalReceived: newReceived, amountRequired: required };
      }

      const [call] = await db.select().from(marginCalls)
        .where(eq(marginCalls.id, input.marginCallId)).limit(1);
      if (!call) throw new TRPCError({ code: "NOT_FOUND" });
      if (call.status === "MET" || call.status === "CANCELLED" || call.status === "DEFAULTED") {
        throw new TRPCError({ code: "BAD_REQUEST", message: `Margin call is already ${call.status}` });
      }

      const newReceived = parseFloat(call.amountReceived) + input.amount;
      const required = parseFloat(call.amountRequired);
      const isMet = newReceived >= required;
      const newStatus = isMet ? "MET" : "PARTIALLY_MET";

      const [updated] = await db.update(marginCalls).set({
        amountReceived: String(newReceived),
        status: newStatus,
        resolvedAt: isMet ? new Date() : null,
      }).where(eq(marginCalls.id, input.marginCallId)).returning();

      // Update clearing account cash balance
      const [account] = await db.select().from(clearingAccounts)
        .where(eq(clearingAccounts.id, call.clearingAccountId)).limit(1);
      if (account) {
        const newCash = parseFloat(account.cashBalance) + input.amount;
        const portfolioValue = parseFloat(account.portfolioValue);
        const initPct = parseFloat(account.initialMarginPct);
        const maintPct = parseFloat(account.maintenanceMarginPct);
        const { required: newRequired, equityRatio } = computeMarginDeficit(portfolioValue, newCash, maintPct, initPct);
        await db.update(clearingAccounts).set({
          cashBalance: String(newCash),
          totalMarginPosted: String(newCash),
          totalMarginRequired: String(newRequired),
          equityRatio: String(equityRatio),
          updatedAt: new Date(),
        }).where(eq(clearingAccounts.id, call.clearingAccountId));
      }

      // Record event
      await db.insert(marginCallEvents).values({
        marginCallId: call.id,
        eventType: isMet ? "MET" : "DEPOSIT_RECEIVED",
        amount: String(input.amount),
        performedBy: ctx.user.id,
        notes: input.notes ?? `Deposit received: ₦${input.amount.toFixed(2)}. Total received: ₦${newReceived.toFixed(2)} / ₦${required.toFixed(2)}`,
      });

      return { call: updated, isMet, totalReceived: newReceived, amountRequired: required };
    }),

  // Admin: resolve/cancel a margin call
  adminResolveMarginCall: protectedProcedure
    .input(z.object({
      marginCallId: z.number().int().positive(),
      resolution: z.enum(["MET", "CANCELLED", "DEFAULTED"]).default("MET"),
      notes: z.string().max(500).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
      const db = await getDb();
      if (!db) {
        const call = _memMarginCalls.get(input.marginCallId);
        if (!call) throw new TRPCError({ code: "NOT_FOUND" });
        if (call.status === "MET" || call.status === "CANCELLED")
          throw new TRPCError({ code: "BAD_REQUEST", message: `Margin call is already ${call.status}` });
        call.status = input.resolution;
        call.resolvedAt = new Date();
        return call;
      }

      const [call] = await db.select().from(marginCalls)
        .where(eq(marginCalls.id, input.marginCallId)).limit(1);
      if (!call) throw new TRPCError({ code: "NOT_FOUND" });
      if (call.status === "MET" || call.status === "CANCELLED") {
        throw new TRPCError({ code: "BAD_REQUEST", message: `Margin call is already ${call.status}` });
      }

      const [updated] = await db.update(marginCalls).set({
        status: input.resolution,
        resolvedAt: new Date(),
      }).where(eq(marginCalls.id, input.marginCallId)).returning();

      await db.insert(marginCallEvents).values({
        marginCallId: call.id,
        eventType: input.resolution as "MET" | "CANCELLED" | "DEFAULTED",
        performedBy: ctx.user.id,
        notes: input.notes ?? `Margin call resolved as ${input.resolution}`,
      });

      if (input.resolution === "DEFAULTED") {
        await notifyOwner({
          title: `Margin Call Defaulted: ${call.callRef}`,
          content: `User ${call.userId} has defaulted on margin call ${call.callRef}. Amount required: ₦${call.amountRequired}. Amount received: ₦${call.amountReceived}.`,
        });
      }

      return updated;
    }),

  // Admin: run auto-liquidation for defaulted/overdue margin calls
  adminRunAutoLiquidation: protectedProcedure
    .input(z.object({
      marginCallId: z.number().int().positive(),
      positions: z.array(z.object({
        instrument: z.string().min(1),
        quantity: z.number().positive(),
        estimatedValue: z.number().positive(),
      })).min(1),
      notes: z.string().max(500).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
      const db = await getDb();
            if (!db) throw new TRPCError({ code: "NOT_FOUND", message: "Not found" });

      const [call] = await db.select().from(marginCalls)
        .where(eq(marginCalls.id, input.marginCallId)).limit(1);
      if (!call) throw new TRPCError({ code: "NOT_FOUND" });

      // Mark auto-liquidation triggered
      await db.update(marginCalls).set({
        autoLiquidationTriggeredAt: new Date(),
        status: "DEFAULTED",
      }).where(eq(marginCalls.id, input.marginCallId));

      // Create liquidation orders for each position
      const orders = await db.insert(autoLiquidationOrders).values(
        input.positions.map(pos => ({
          marginCallId: call.id,
          clearingAccountId: call.clearingAccountId,
          userId: call.userId,
          instrument: pos.instrument,
          quantity: String(pos.quantity),
          estimatedValue: String(pos.estimatedValue),
          initiatedBy: ctx.user.id,
          notes: input.notes ?? null,
        }))
      ).returning();

      // Record event
      await db.insert(marginCallEvents).values({
        marginCallId: call.id,
        eventType: "DEFAULTED",
        performedBy: ctx.user.id,
        notes: `Auto-liquidation triggered for ${orders.length} position(s). Total estimated value: ₦${input.positions.reduce((s, p) => s + p.estimatedValue, 0).toFixed(2)}`,
      });

      await notifyOwner({
        title: `Auto-Liquidation Triggered: ${call.callRef}`,
        content: `Auto-liquidation initiated for user ${call.userId}. ${orders.length} position(s) queued for liquidation. Total estimated proceeds: ₦${input.positions.reduce((s, p) => s + p.estimatedValue, 0).toFixed(2)}.`,
      });

      return { marginCall: call, liquidationOrders: orders };
    }),

  // Admin: complete a liquidation order
  adminCompleteLiquidation: protectedProcedure
    .input(z.object({
      liquidationOrderId: z.number().int().positive(),
      actualProceeds: z.number().min(0),
      notes: z.string().max(500).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
      const db = await getDb();
            if (!db) throw new TRPCError({ code: "NOT_FOUND", message: "Not found" });

      const [order] = await db.update(autoLiquidationOrders).set({
        status: "COMPLETED",
        actualProceeds: String(input.actualProceeds),
        completedAt: new Date(),
        notes: input.notes ?? null,
      }).where(eq(autoLiquidationOrders.id, input.liquidationOrderId)).returning();
      if (!order) throw new TRPCError({ code: "NOT_FOUND" });
      return order;
    }),

  // Admin: list auto-liquidation orders
  adminListAutoLiquidations: protectedProcedure
    .input(z.object({
      status: z.enum(["PENDING", "EXECUTING", "COMPLETED", "FAILED", "CANCELLED"]).optional(),
      limit: z.number().int().min(1).max(200).default(50),
      offset: z.number().int().min(0).default(0),
    }))
    .query(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
      const db = await getDb();
            if (!db) return [] as any[];

      const conditions = input.status ? [eq(autoLiquidationOrders.status, input.status)] : [];
      const orders = await db.select().from(autoLiquidationOrders)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(autoLiquidationOrders.initiatedAt))
        .limit(input.limit).offset(input.offset);
      return orders;
    }),

  // Admin: get margin call events history
  adminGetMarginCallEvents: protectedProcedure
    .input(z.object({ marginCallId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
      const db = await getDb();
            if (!db) return [] as any[];

      const events = await db.select().from(marginCallEvents)
        .where(eq(marginCallEvents.marginCallId, input.marginCallId))
        .orderBy(marginCallEvents.occurredAt);
      return events;
    }),

  // Admin: get clearing house stats
  adminGetStats: protectedProcedure
    .query(async ({ ctx }) => {
      if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
      const db = await getDb();
      if (!db) {
        const accounts = Array.from(_memAccounts.values());
        const calls = Array.from(_memMarginCalls.values());
        return {
          totalAccounts: accounts.length,
          activeAccounts: accounts.filter(a => a.status === "ACTIVE").length,
          suspendedAccounts: accounts.filter(a => a.status === "SUSPENDED").length,
          atRiskAccounts: accounts.filter(a => parseFloat(a.equityRatio) < 0.08).length,
          totalMarginCalls: calls.length,
          openMarginCalls: calls.filter(c => c.status === "OPEN").length,
          defaultedMarginCalls: calls.filter(c => c.status === "DEFAULTED").length,
          metMarginCalls: calls.filter(c => c.status === "MET").length,
          totalAutoLiquidations: 0, activeAutoLiquidations: 0, completedAutoLiquidations: 0,
          accounts: { total: accounts.length, active: accounts.filter(a => a.status === "ACTIVE").length, suspended: 0, atRisk: 0 },
          marginCalls: { total: calls.length, open: calls.filter(c => c.status === "OPEN").length, defaulted: 0, met: 0 },
          liquidations: { total: 0, pending: 0, completed: 0 },
        };
      }

      const [accountStats] = await db.select({
        total: sql<number>`count(*)::int`,
        active: sql<number>`count(*) filter (where status = 'ACTIVE')::int`,
        suspended: sql<number>`count(*) filter (where status = 'SUSPENDED')::int`,
        atRisk: sql<number>`count(*) filter (where equity_ratio < 0.08)::int`,
      }).from(clearingAccounts);

      const [callStats] = await db.select({
        total: sql<number>`count(*)::int`,
        open: sql<number>`count(*) filter (where status = 'OPEN')::int`,
        defaulted: sql<number>`count(*) filter (where status = 'DEFAULTED')::int`,
        met: sql<number>`count(*) filter (where status = 'MET')::int`,
      }).from(marginCalls);

      const [liqStats] = await db.select({
        total: sql<number>`count(*)::int`,
        pending: sql<number>`count(*) filter (where status = 'PENDING')::int`,
        completed: sql<number>`count(*) filter (where status = 'COMPLETED')::int`,
      }).from(autoLiquidationOrders);

      return {
        totalAccounts: accountStats?.total ?? 0,
        activeAccounts: accountStats?.active ?? 0,
        suspendedAccounts: accountStats?.suspended ?? 0,
        atRiskAccounts: accountStats?.atRisk ?? 0,
        totalMarginCalls: callStats?.total ?? 0,
        openMarginCalls: callStats?.open ?? 0,
        defaultedMarginCalls: callStats?.defaulted ?? 0,
        metMarginCalls: callStats?.met ?? 0,
        totalAutoLiquidations: liqStats?.total ?? 0,
        activeAutoLiquidations: liqStats?.pending ?? 0,
        completedAutoLiquidations: liqStats?.completed ?? 0,
        // Legacy nested format for dashboard UI
        accounts: accountStats,
        marginCalls: callStats,
        liquidations: liqStats,
      };
    }),

  // User: get own margin health
  myMarginHealth: protectedProcedure
    .query(async ({ ctx }) => {
      const db = await getDb();
      if (!db) {
        const account = Array.from(_memAccounts.values()).find(a => a.userId === ctx.user.id);
        if (!account) return null;
        const equityRatio = parseFloat(account.equityRatio);
        const maintPct = parseFloat(account.maintenanceMarginPct);
        const initPct = parseFloat(account.initialMarginPct);
        return {
          account,
          equityRatioPct: (equityRatio * 100).toFixed(2),
          isBelowMaintenance: equityRatio < 1,
          isBelowInitial: equityRatio < initPct,
          healthStatus: equityRatio >= initPct ? "HEALTHY" : equityRatio >= maintPct ? "WARNING" : "CRITICAL",
        };
      }

      const [account] = await db.select().from(clearingAccounts)
        .where(eq(clearingAccounts.userId, ctx.user.id)).limit(1);
      if (!account) return null;

      const equityRatio = parseFloat(account.equityRatio);
      const maintPct = parseFloat(account.maintenanceMarginPct);
      const initPct = parseFloat(account.initialMarginPct);

      return {
        account,
        equityRatioPct: (equityRatio * 100).toFixed(2),
        isBelowMaintenance: equityRatio < 1,
        isBelowInitial: equityRatio < initPct,
        healthStatus: equityRatio >= initPct ? "HEALTHY" : equityRatio >= maintPct ? "WARNING" : "CRITICAL",
      };
    }),

  // User: get own margin calls
  myMarginCalls: protectedProcedure
    .input(z.object({
      status: z.enum(["OPEN", "PARTIALLY_MET", "MET", "DEFAULTED", "CANCELLED"]).optional(),
    }).optional())
    .query(async ({ ctx, input }) => {
      const db = await getDb();
            if (!db) return [] as any[];

      const conditions = [eq(marginCalls.userId, ctx.user.id)];
      if (input?.status) conditions.push(eq(marginCalls.status, input.status));

      const calls = await db.select().from(marginCalls)
        .where(and(...conditions))
        .orderBy(desc(marginCalls.issuedAt))
        .limit(50);
      return calls;
    }),

  // User: get own margin call history with events
  myMarginCallHistory: protectedProcedure
    .input(z.object({ marginCallId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
            if (!db) return [] as any[];

      const [call] = await db.select().from(marginCalls)
        .where(and(eq(marginCalls.id, input.marginCallId), eq(marginCalls.userId, ctx.user.id))).limit(1);
      if (!call) throw new TRPCError({ code: "NOT_FOUND" });

      const events = await db.select().from(marginCallEvents)
        .where(eq(marginCallEvents.marginCallId, call.id))
        .orderBy(marginCallEvents.occurredAt);

      return { call, events };
    }),
});
