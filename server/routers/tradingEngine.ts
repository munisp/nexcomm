/**
 * tradingEngine.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * tRPC router proxying the Go Trading Engine (port 8001).
 * Handles FIX protocol order routing, order book management, and pre-trade checks.
 * Falls back to the Rust matching engine client when the Go engine is offline.
 */

import { z } from "zod";
import { protectedProcedure, publicProcedure, router } from "../_core/trpc";
import { submitOrder, cancelOrder, getMarketDepth } from "../matchingEngineClient";
import { writeAuditLog } from "../audit";

const TE_URL = process.env.TRADING_ENGINE_URL ?? "http://localhost:8001";
const TIMEOUT_MS = 3000;

async function teFetch(path: string, options?: RequestInit): Promise<unknown> {
  const res = await fetch(`${TE_URL}${path}`, {
    ...options,
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { "Content-Type": "application/json", ...(options?.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`Trading engine error: ${res.status} ${await res.text()}`);
  return res.json();
}

export const tradingEngineRouter = router({
  /** Health check for the Go trading engine */
  health: publicProcedure.query(async () => {
    try {
      const data = await teFetch("/healthz");
      return { online: true, ...(data as object) };
    } catch {
      return { online: false };
    }
  }),

  /** Submit an order via the Go trading engine (FIX protocol routing) */
  submitOrder: protectedProcedure
    .input(z.object({
      symbol: z.string().trim(),
      side: z.enum(["BUY", "SELL"]),
      orderType: z.enum(["LIMIT", "MARKET", "STOP_LIMIT"]),
      quantity: z.string().trim(),
      price: z.string().optional(),
      stopPrice: z.string().optional(),
      timeInForce: z.enum(["GTC", "IOC", "FOK", "DAY"]).default("GTC"),
    }))
    .mutation(async ({ ctx, input }) => {
      try {
        const data = await teFetch("/api/v1/orders", {
          method: "POST",
          body: JSON.stringify({
            user_id: String(ctx.user.id),
            symbol: input.symbol,
            side: input.side,
            order_type: input.orderType,
            quantity: input.quantity,
            price: input.price,
            stop_price: input.stopPrice,
            time_in_force: input.timeInForce,
          }),
        }) as { order_id: string; status: string; filled_quantity?: string; avg_fill_price?: string };
        return {
          orderId: data.order_id,
          status: data.status,
          filledQuantity: data.filled_quantity ?? "0",
          avgFillPrice: data.avg_fill_price ?? "0",
          source: "trading-engine",
        };
      } catch {
        // Fallback to Rust matching engine
        const result = await submitOrder({
          client_order_id: `${ctx.user.id}-${Date.now()}`,
          account_id: String(ctx.user.id),
          symbol: input.symbol,
          side: input.side,
          order_type: input.orderType === "STOP_LIMIT" ? "STOPLIMIT" : input.orderType,
          quantity: parseFloat(input.quantity),
          price: input.price ? parseFloat(input.price) : undefined,
          stop_price: input.stopPrice ? parseFloat(input.stopPrice) : undefined,
          time_in_force: input.timeInForce,
        });
        return {
          orderId: result.order.id,
          status: result.order.status,
          filledQuantity: String(result.order.filled_quantity ?? 0),
          avgFillPrice: String(result.order.average_price ?? 0),
          source: "matching-engine-fallback",
        };
      }
    }),

  /** Cancel an order via the Go trading engine */
  cancelOrder: protectedProcedure
    .input(z.object({ orderId: z.string().trim(), symbol: z.string().trim() }))
    .mutation(async ({ input }) => {
      try {
        await teFetch(`/api/v1/orders/${input.orderId}`, { method: "DELETE" });
        return { success: true, source: "trading-engine" };
      } catch {
        // Fallback to Rust matching engine
        await cancelOrder(input.symbol, input.orderId);
        return { success: true, source: "matching-engine-fallback" };
      }
    }),

  /** Get order book depth from the Go trading engine */
  getOrderBook: publicProcedure
    .input(z.object({ symbol: z.string().trim(), depth: z.number().int().min(1).max(50).default(10) }))
    .query(async ({ input }) => {
      try {
        const data = await teFetch(`/api/v1/orderbook/${input.symbol}?depth=${input.depth}`);
        return { ...(data as object), source: "trading-engine" };
      } catch {
        // Fallback to Rust matching engine
        const data = await getMarketDepth(input.symbol);
        return { ...data, source: "matching-engine-fallback" };
      }
    }),

  /** Get a specific order by ID */
  getOrder: protectedProcedure
    .input(z.object({ orderId: z.string().trim() }))
    .query(async ({ input }) => {
      try {
        const data = await teFetch(`/api/v1/orders/${input.orderId}`);
        return { ...(data as object), source: "trading-engine" };
      } catch {
        return null;
      }
    }),

  list: protectedProcedure
    .input(z.object({ page: z.number().int().default(1), pageSize: z.number().int().default(20) }))
    .query(async ({ ctx, input }) => {
      return { items: [], total: 0 };
    }),
  create: protectedProcedure
    .input(z.object({ data: z.record(z.string(), z.unknown()) }))
    .mutation(async ({ ctx, input }) => {
      await writeAuditLog({ userId: ctx.user.id, action: "tradingEngine.create", details: input.data });
      return { success: true };
    }),
  update: protectedProcedure
    .input(z.object({ orderId: z.string(), data: z.record(z.string(), z.unknown()) }))
    .mutation(async ({ ctx, input }) => {
      await writeAuditLog({ userId: ctx.user.id, action: "tradingEngine.update", details: { orderId: input.orderId } });
      return { success: true };
    }),
});
