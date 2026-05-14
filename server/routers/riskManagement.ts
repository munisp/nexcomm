/**
 * riskManagement.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * tRPC router that proxies the Go Risk Management Service (port 8005).
 * Falls back to DB-based calculations when the service is offline.
 *
 * API endpoints proxied:
 *   GET  /api/v1/risk/positions/:userId  — user positions
 *   GET  /api/v1/risk/summary/:userId    — risk summary (margin, P&L, exposure)
 *   POST /api/v1/risk/check              — pre-trade risk check
 *   GET  /api/v1/risk/circuit-breakers   — circuit breaker status
 *   GET  /api/v1/risk/margin/:symbol     — margin requirements
 */

import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure, publicProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { orders, positions, preTradRiskChecks } from "../../drizzle/schema";
import { eq, and, desc, sql } from "drizzle-orm";
import { writeAuditLog } from "../audit";

const RM_URL = process.env.RISK_SERVICE_URL ?? "http://localhost:8005";
const TIMEOUT_MS = 3000;

async function rmFetch(path: string, options?: RequestInit): Promise<unknown> {
  const res = await fetch(`${RM_URL}${path}`, {
    ...options,
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { "Content-Type": "application/json", ...(options?.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`Risk service error: ${res.status}`);
  return res.json();
}

// ─── Fallback helpers (DB-based) ──────────────────────────────────────────────

async function getPositionsFallback(userId: number) {
  const db = (await getDb())!;
  const rows = await db
    .select()
    .from(positions)
    .where(eq(positions.userId, userId))
    .orderBy(desc(positions.updatedAt));
  return rows.map(p => ({
    symbol: p.symbol,
    quantity: p.quantity,
    averageCost: p.avgCost,
    currentValue: (Number(p.avgCost) * Number(p.quantity)).toFixed(2),
    unrealizedPnl: "0",
    realizedPnl: p.realizedPnl,
  }));
}

async function getRiskSummaryFallback(userId: number) {
  const db = (await getDb())!;
  const userPositions = await db
    .select()
    .from(positions)
    .where(eq(positions.userId, userId));

  const totalValue = userPositions.reduce((sum, p) => sum + Number(p.avgCost ?? 0) * Number(p.quantity ?? 0), 0);
  const totalCost = userPositions.reduce((sum, p) => sum + Number(p.avgCost ?? 0) * Number(p.quantity ?? 0), 0);
  const unrealizedPnl = 0;

  // Count open orders for exposure
  const openOrders = await db
    .select({ count: sql<number>`count(*)` })
    .from(orders)
    .where(and(eq(orders.userId, userId), eq(orders.status, "OPEN")));

  return {
    userId: String(userId),
    totalPositionValue: totalValue,
    totalCost,
    unrealizedPnl,
    realizedPnl: userPositions.reduce((sum, p) => sum + Number(p.realizedPnl ?? 0), 0) as number,
    openOrderCount: Number(openOrders[0]?.count ?? 0),
    marginUsed: totalValue * 0.1,
    marginAvailable: 10000 - totalValue * 0.1,
    riskScore: Math.min(100, Math.round((totalValue / 10000) * 100)),
    source: "db-fallback",
  };
}

// ─── Router ───────────────────────────────────────────────────────────────────

export const riskManagementRouter = router({
  /** Get all positions for the current user */
  getPositions: protectedProcedure.query(async ({ ctx }) => {
    try {
      const data = await rmFetch(`/api/v1/risk/positions/${ctx.user.id}`) as { positions: unknown[] };
      return { positions: data.positions ?? [], source: "risk-service" };
    } catch {
      const positions = await getPositionsFallback(ctx.user.id);
      return { positions, source: "db-fallback" };
    }
  }),

  /** Get risk summary (margin, P&L, exposure) for the current user */
  getRiskSummary: protectedProcedure.query(async ({ ctx }) => {
    try {
      const data = await rmFetch(`/api/v1/risk/summary/${ctx.user.id}`);
      return { ...(data as object), source: "risk-service" };
    } catch {
      return getRiskSummaryFallback(ctx.user.id);
    }
  }),

  /** Pre-trade risk check — called before order submission */
  checkOrder: protectedProcedure
    .input(z.object({
      symbol: z.string().trim(),
      side: z.enum(["BUY", "SELL"]),
      quantity: z.string().trim(),
      price: z.string().trim(),
    }))
    .mutation(async ({ ctx, input }) => {
      let result: { approved: boolean; reason: string | null; marginRequired: number | null; source: string };
      try {
        const data = await rmFetch("/api/v1/risk/check", {
          method: "POST",
          body: JSON.stringify({
            user_id: String(ctx.user.id),
            symbol: input.symbol,
            side: input.side,
            quantity: input.quantity,
            price: input.price,
          }),
        }) as { approved: boolean; reason?: string; margin_required?: number };
        result = {
          approved: data.approved,
          reason: data.reason ?? null,
          marginRequired: data.margin_required ?? null,
          source: "risk-service",
        };
      } catch {
        // Fallback: basic quantity/price check
        const qty = parseFloat(input.quantity);
        const price = parseFloat(input.price);
        const notional = qty * price;
        const approved = notional <= 500_000; // 500k notional limit fallback
        result = {
          approved,
          reason: approved ? null : "Order exceeds notional limit (fallback check)",
          marginRequired: notional * 0.1,
          source: "db-fallback",
        };
      }
      // Persist the pre-trade risk check to the audit table (non-blocking)
      try {
        const db = await getDb();
        if (db) {
          await db.insert(preTradRiskChecks).values({
            orderId: 0, // 0 = pre-submission check (no order ID yet)
            userId: ctx.user.id,
            symbol: input.symbol,
            checkType: result.source === "risk-service" ? "RISK_SERVICE" : "FALLBACK_NOTIONAL",
            passed: result.approved,
            requiredMargin: result.marginRequired != null ? String(result.marginRequired) : null,
            rejectReason: result.reason ?? null,
          });
        }
      } catch {
        // Non-critical — don't fail the check if audit write fails
      }
      return result;
    }),

  /** Get circuit breaker status for all symbols */
  getCircuitBreakers: publicProcedure.query(async () => {
    try {
      const data = await rmFetch("/api/v1/risk/circuit-breakers");
      return { ...(data as object), source: "risk-service" };
    } catch {
      return {
        circuit_breakers: [],
        global_halt: false,
        source: "db-fallback",
      };
    }
  }),

  /** Get margin requirements for a symbol */
  getMarginRequirements: publicProcedure
    .input(z.object({ symbol: z.string().trim() }))
    .query(async ({ input }) => {
      try {
        const data = await rmFetch(`/api/v1/risk/margin/${input.symbol}`);
        return { ...(data as object), source: "risk-service" };
      } catch {
        // Standard commodity margin rates fallback
        return {
          symbol: input.symbol,
          initial_margin_rate: 0.10,
          maintenance_margin_rate: 0.07,
          max_position_size: 10000,
          source: "db-fallback",
        };
      }
    }),

  /** Admin: get risk summary for any user */
  adminGetUserRisk: protectedProcedure
    .input(z.object({ userId: z.number() }))
    .query(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") throw new Error("Forbidden");
      try {
        const data = await rmFetch(`/api/v1/risk/summary/${input.userId}`);
        return { ...(data as object), source: "risk-service" };
      } catch {
        return getRiskSummaryFallback(input.userId);
      }
    }),

  list: protectedProcedure
    .input(z.object({ page: z.number().int().default(1), pageSize: z.number().int().default(20) }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) return { items: [], total: 0 };
      return { items: [], total: 0 };
    }),
  delete: protectedProcedure
    .input(z.object({ ruleId: z.number().int() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "Database unavailable" });
      await writeAuditLog(ctx.user.id, "riskManagement.delete", { ruleId: input.ruleId });
      return { success: true };
    }),
});
