/**
 * NEXCOM Exchange — Orders Router
 * ─────────────────────────────────────────────────────────────────────────────
 * Handles order creation, listing, and cancellation across all asset classes.
 *
 * Order lifecycle (event-driven via gRPC):
 *   1. Client submits order via tRPC orders.create
 *   2. Router persists order to PostgreSQL (status = OPEN)
 *   3. Router calls gRPC MatchingEngine.SubmitOrder asynchronously
 *   4. Matching engine may return fills; router updates filledQty / status
 *   5. On cancel: tRPC orders.cancel → gRPC MatchingEngine.CancelOrder → DB update
 *
 * Idempotency: pass `clientOrderId` (UUID) on create; duplicate submissions
 * return the existing order with `idempotent: true` instead of creating a new one.
 */
import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import { getDb } from "../db";
import { orders, notifications, circuitBreakerEvents, savedOrders, orderAmendments } from "../../drizzle/schema";
import { eq, and, desc, isNull } from "drizzle-orm";
import type { Order } from "../../drizzle/schema";
import {
  submitOrder as rustSubmitOrder,
  cancelOrder as rustCancelOrder,
  checkMatchingEngineHealth,
} from "../matchingEngineClient";
import { notifyOwner } from "../_core/notification";
import { emitOrderFilled, emitOrderCancelled } from "../kafka/kafkaProducer";
import { pushToUser } from "./pushNotificationsRouter";
const assetClasses = ["COMMODITY", "FOREX", "EQUITY", "DIGITAL_ASSET", "INDEX"] as const;

/**
 * Check if a given instrument is currently halted by an active circuit breaker event.
 * Returns the active halt event if found, or null if trading is permitted.
 */
async function checkInstrumentHalt(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  symbol: string,
) {
  const [activeHalt] = await db
    .select()
    .from(circuitBreakerEvents)
    .where(
      and(
        eq(circuitBreakerEvents.instrument, symbol),
        eq(circuitBreakerEvents.status, "ACTIVE"),
        isNull(circuitBreakerEvents.liftedAt),
      )
    )
    .limit(1);
  return activeHalt ?? null;
};
const orderStatuses = ["OPEN", "PARTIALLY_FILLED", "FILLED", "CANCELLED", "REJECTED", "EXPIRED"] as const;

// Map string asset class to proto enum integer
// Map Rust engine order status strings to DB enum values
const rustStatusToDb: Record<string, string> = {
  NEW: "OPEN",
  OPEN: "OPEN",
  PARTIALLY_FILLED: "PARTIALLY_FILLED",
  FILLED: "FILLED",
  CANCELLED: "CANCELLED",
  REJECTED: "REJECTED",
  EXPIRED: "EXPIRED",
};

export const ordersRouter = router({
  list: protectedProcedure
    .input(z.object({
      assetClass: z.enum(assetClasses).optional(),
      status: z.enum(orderStatuses).optional(),
      limit: z.number().min(1).max(200).default(50),
    }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) return [] as Order[];
      const conditions = [eq(orders.userId, ctx.user.id)];
      if (input.assetClass) conditions.push(eq(orders.assetClass, input.assetClass));
      if (input.status) conditions.push(eq(orders.status, input.status));
      return db
        .select()
        .from(orders)
        .where(and(...conditions))
        .orderBy(desc(orders.createdAt))
        .limit(input.limit);
    }),

  create: protectedProcedure
    .input(z.object({
      symbol: z.string().min(1).max(32),
      assetClass: z.enum(assetClasses).default("COMMODITY"),
      side: z.enum(["BUY", "SELL"]),
      orderType: z.enum(["LIMIT", "MARKET", "STOP_LIMIT"]),
      quantity: z.number().positive(),
      price: z.number().positive().optional(),
      stopPrice: z.number().positive().optional(),
      timeInForce: z.enum(["GTC", "DAY", "IOC", "FOK"]).default("GTC"),
      notes: z.string().max(512).optional(),
      /**
       * Idempotency key — the client generates a UUID (e.g. crypto.randomUUID())
       * before submitting. If the same key is submitted again (network retry, double-click),
       * the server returns the original order instead of inserting a duplicate.
       * The unique constraint `orders_client_order_id_unique` on (user_id, client_order_id)
       * enforces this at the database level as a second line of defence.
       */
      clientOrderId: z.string().uuid().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database unavailable");

      // ── Circuit Breaker halt check ─────────────────────────────────────────
      const activeHalt = await checkInstrumentHalt(db, input.symbol);
      if (activeHalt) {
        const haltedUntil = activeHalt.haltUntil
          ? ` until ${new Date(activeHalt.haltUntil).toLocaleTimeString()}`
          : "";
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `Trading in ${input.symbol} is currently halted${haltedUntil}. Reason: ${activeHalt.notes ?? "Circuit breaker triggered"}.`,
        });
      }

      // ── Idempotency check ──────────────────────────────────────────────────
      if (input.clientOrderId) {
        const [existing] = await db
          .select()
          .from(orders)
          .where(
            and(
              eq(orders.userId, ctx.user.id),
              eq(orders.clientOrderId, input.clientOrderId)
            )
          )
          .limit(1);
        if (existing) return { ...existing, idempotent: true as const };
      }

      // ── Persist order to PostgreSQL ────────────────────────────────────────
      const [order] = await db
        .insert(orders)
        .values({
          userId: ctx.user.id,
          symbol: input.symbol,
          assetClass: input.assetClass,
          side: input.side,
          orderType: input.orderType,
          quantity: String(input.quantity),
          price: input.price != null ? String(input.price) : null,
          stopPrice: input.stopPrice != null ? String(input.stopPrice) : null,
          timeInForce: input.timeInForce,
          notes: input.notes,
          status: "OPEN",
          filledQty: "0",
          clientOrderId: input.clientOrderId ?? null,
        })
        .returning();

      // ── Submit to Rust Matching Engine (async, non-blocking for UX) ─────────
      // Fire-and-forget: the Rust engine processes the order and returns fills.
      // If it returns fills immediately (e.g. market orders), we update the DB.
      // Errors are logged but do not fail the tRPC response — the order is already
      // persisted and will be reconciled by the settlement job.
      setImmediate(async () => {
        try {
          // Map STOP_LIMIT to STOPLIMIT for the Rust engine enum
          const rustOrderType = input.orderType === "STOP_LIMIT" ? "STOPLIMIT" : input.orderType as "LIMIT" | "MARKET" | "STOP" | "STOPLIMIT" | "IOC" | "FOK" | "GTC" | "GTD";
          const rustResp = await rustSubmitOrder({
            client_order_id: input.clientOrderId ?? `CLT-${order.id}-${Date.now()}`,
            account_id: `USER-${ctx.user.id}`,
            symbol: input.symbol,
            side: input.side as "BUY" | "SELL",
            order_type: rustOrderType,
            time_in_force: input.timeInForce as "GTC" | "IOC" | "FOK" | "DAY" | "GTD",
            price: input.price,
            stop_price: input.stopPrice,
            quantity: input.quantity,
          });

          // Update DB with Rust engine response (fills, status changes)
          const newStatus = rustStatusToDb[rustResp.order.status] ?? "OPEN";
          const filledQty = rustResp.order.filled_quantity / 1_000_000;
          const avgFillPrice = rustResp.order.average_price;
          const rustOrderId = rustResp.order.id;
          if (newStatus !== "OPEN" || filledQty > 0) {
            const dbToUpdate = await getDb();
            if (dbToUpdate) {
              await dbToUpdate
                .update(orders)
                .set({
                  status: newStatus as Order["status"],
                  filledQty: String(filledQty),
                  avgFillPrice: avgFillPrice > 0 ? String(avgFillPrice) : null,
                  // Store Rust engine UUID in notes for cancel/amend operations
                  notes: order.notes ? `${order.notes} [rust:${rustOrderId}]` : `[rust:${rustOrderId}]`,
                  updatedAt: new Date(),
                })
                .where(eq(orders.id, order.id));

              // ── Order fill notifications ─────────────────────────────────────────
              if (newStatus === "FILLED" || newStatus === "PARTIALLY_FILLED") {
                const fillLabel = newStatus === "FILLED" ? "Filled" : "Partially Filled";
                const isFull = newStatus === "FILLED";
                const filledQtyStr = filledQty.toLocaleString();

                // Settlement date: T+2 business days from fill time
                const fillDate = new Date();
                let settleDays = 0;
                const settlDate = new Date(fillDate);
                while (settleDays < 2) {
                  settlDate.setDate(settlDate.getDate() + 1);
                  const dow = settlDate.getDay();
                  if (dow !== 0 && dow !== 6) settleDays++;
                }
                const settleDateStr = settlDate.toLocaleDateString("en-NG", {
                  weekday: "long", year: "numeric", month: "long", day: "numeric",
                });

                // ── Trade Confirmation Receipt (in-app) ──────────────────────────
                // Rich structured message that mirrors a trade confirmation email
                const confirmationTitle = `Trade Confirmation: ${input.side} ${input.symbol}`;
                const confirmationBody = [
                  `NEXCOM TRADE CONFIRMATION`,
                  `═══════════════════════════════`,
                  `Order ID:        #${order.id}`,
                  `Status:          ${fillLabel}`,
                  ``,
                  `Symbol:          ${input.symbol}`,
                  `Side:            ${input.side}`,
                  `Order Type:      ${input.orderType}`,
                  `Asset Class:     ${input.assetClass}`,
                  ``,
                    `Filled Qty:      ${filledQtyStr}`,
                  `Avg Fill Price:  ${avgFillPrice > 0 ? avgFillPrice.toLocaleString() : "Market"}`,
                  ``,
                  `Trade Date:      ${fillDate.toLocaleDateString("en-NG", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}`,
                  `Settlement Date: ${settleDateStr} (T+2)`,
                  ``,
                  `This confirmation is your official trade receipt. Please retain for your records.`,
                  `NEXCOM Exchange — Empowering Nigerian Farmers`,
                ].join("\n");

                // 1. In-app trade confirmation for the trader
                try {
                  await dbToUpdate.insert(notifications).values({
                    userId: ctx.user.id,
                    title: confirmationTitle,
                    message: confirmationBody,
                    type: "TRADE",
                    read: false,
                      metadata: {
                        orderId: order.id,
                        symbol: input.symbol,
                        side: input.side,
                        orderType: input.orderType,
                        assetClass: input.assetClass,
                        filledQty: filledQty,
                        avgFillPrice: avgFillPrice,
                        status: newStatus,
                      tradeDate: fillDate.toISOString(),
                      settlementDate: settlDate.toISOString(),
                      confirmationType: "TRADE_CONFIRMATION",
                    },
                  });
                } catch (notifErr) {
                  console.warn(`[Orders] Failed to insert trade confirmation for order ${order.id}:`, (notifErr as Error).message);
                }

                // 2. First-trade milestone notification (one-time)
                if (isFull) {
                  try {
                    const prevFilled = await dbToUpdate
                      .select({ id: orders.id })
                      .from(orders)
                      .where(
                        and(
                          eq(orders.userId, ctx.user.id),
                          eq(orders.status, "FILLED")
                        )
                      )
                      .limit(2);
                    // If this is the only FILLED order (just updated), it's the first trade
                    if (prevFilled.length === 1) {
                      await dbToUpdate.insert(notifications).values({
                        userId: ctx.user.id,
                        title: "🎉 First Trade Completed!",
                        message: `Congratulations! You've successfully completed your first trade on NEXCOM — ${input.side} ${filledQtyStr} ${input.symbol} @ ${avgFillPrice > 0 ? avgFillPrice.toLocaleString() : "Market"}. Your farmer journey progress has been updated.`,
                        type: "SYSTEM",
                        read: false,
                        metadata: { milestone: "first_trade", orderId: order.id, symbol: input.symbol },
                      });
                    }
                  } catch (_) { /* non-critical */ }
                }

                // 3. Owner notification — rich trade confirmation alert
                notifyOwner({
                  title: `[NEXCOM] Trade Confirmation — ${fillLabel}: ${input.side} ${input.symbol}`,
                  content: [
                    `Trade Confirmation Receipt`,
                    `═══════════════════════════════`,
                    `Trader:          #${ctx.user.id} (${ctx.user.email ?? "N/A"})`,
                    `Order ID:        #${order.id}`,
                    `Status:          ${fillLabel}`,
                    ``,
                    `Symbol:          ${input.symbol}`,
                    `Side:            ${input.side}`,
                    `Order Type:      ${input.orderType}`,
                    `Asset Class:     ${input.assetClass}`,
                    ``,
                    `Filled Qty:      ${filledQtyStr}`,
                    `Avg Fill Price:  ${avgFillPrice > 0 ? avgFillPrice.toLocaleString() : "Market"}`,
                    ``,
                    `Trade Date:      ${fillDate.toISOString()}`,
                    `Settlement Date: ${settlDate.toISOString()} (T+2)`,
                  ].join("\n"),
                }).catch(e => console.warn("[Orders] notifyOwner failed:", (e as Error).message));

                // ── Kafka: emit order.filled for real-time portfolio update ───────
                emitOrderFilled({
                  orderId: String(order.id),
                  userId: ctx.user.id,
                  symbol: input.symbol,
                  side: input.side as "BUY" | "SELL",
                  filledQty: filledQty,
                  avgFillPrice: avgFillPrice,
                  remainingQty: rustResp?.order?.remaining_quantity
                    ? rustResp.order.remaining_quantity / 1_000_000
                    : 0,
                  status: newStatus as "FILLED" | "PARTIALLY_FILLED",
                  tradeId: rustResp?.trades?.[0]?.id ?? "",
                  counterpartyOrderId: rustResp?.trades?.[0]?.buyer ?? "",
                }).catch(e => console.warn("[Kafka] emitOrderFilled failed:", (e as Error).message));

                // ── Browser Push: notify trader of fill status ─────────────────
                const fillStatusLabel = newStatus === "FILLED" ? "Order Filled" : "Order Partially Filled";
                const fillPriceStr = avgFillPrice > 0
                  ? ` @ ${avgFillPrice.toLocaleString(undefined, { maximumFractionDigits: 4 })}`
                  : "";
                const fillQtyStr = filledQty > 0
                  ? `${filledQty.toLocaleString(undefined, { maximumFractionDigits: 6 })} units`
                  : "";
                pushToUser(
                  ctx.user.id,
                  {
                    title: `${fillStatusLabel}: ${input.side} ${input.symbol}`,
                    body: `${fillQtyStr} filled${fillPriceStr}`,
                    url: "/orders",
                    tag: `order-fill-${order.id}`,
                  },
                  "tradeFills",
                ).catch(e => console.warn("[WebPush] tradeFill push failed:", (e as Error).message));
              }
            }
          }
        } catch (err) {
          // Log but do not throw — order is already persisted
          // If the Rust engine is not running, the order stays OPEN and will be
          // reconciled when the engine comes back online.
          const isHealthy = await checkMatchingEngineHealth();
          if (!isHealthy) {
            console.warn(`[MatchingEngine] Rust engine unavailable for order ${order.id}. Order queued for reconciliation.`);
          } else {
            console.error(
              `[MatchingEngine] SubmitOrder failed for order ${order.id}:`,
              (err as Error).message
            );
          }
        }
      });

      return { ...order, idempotent: false as const };
    }),
  cancel: protectedProcedure
    .input(z.object({ orderId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database unavailable");

      // ── Optimistic DB update ───────────────────────────────────────────────
      const [updated] = await db
        .update(orders)
        .set({ status: "CANCELLED", updatedAt: new Date() })
        .where(
          and(
            eq(orders.id, input.orderId),
            eq(orders.userId, ctx.user.id),
            eq(orders.status, "OPEN")
          )
        )
        .returning();
      if (!updated) throw new Error("Order not found or already closed");

      // ── Notify Rust Matching Engine of cancellation ───────────────────────
      // Extract the Rust engine UUID from the order notes if available
      setImmediate(async () => {
        try {
          const rustIdMatch = updated.notes?.match(/\[rust:([a-f0-9-]{36})\]/);
          if (rustIdMatch) {
            await rustCancelOrder(updated.symbol, rustIdMatch[1]);
          }
        } catch (err) {
          console.error(
            `[MatchingEngine] CancelOrder failed for order ${input.orderId}:`,
            (err as Error).message
          );
        }
        // ── Kafka: emit order.cancelled for real-time event streaming ────────
        emitOrderCancelled({
          orderId: String(input.orderId),
          userId: ctx.user.id,
          reason: "User cancelled",
        }).catch(e => console.warn("[Kafka] emitOrderCancelled failed:", (e as Error).message));

        // ── Browser Push: notify trader of cancellation ────────────────────
        pushToUser(
          ctx.user.id,
          {
            title: `Order Cancelled: ${updated.symbol}`,
            body: `Your ${updated.side} order #${updated.id} for ${updated.symbol} has been cancelled.`,
            url: "/orders",
            tag: `order-cancel-${updated.id}`,
          },
          "systemAlerts",
        ).catch(e => console.warn("[WebPush] cancel push failed:", (e as Error).message));
      });
      return updated;
    }),

  stats: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) return { total: 0, open: 0, filled: 0, cancelled: 0 };
    const all = await db
      .select()
      .from(orders)
      .where(eq(orders.userId, ctx.user.id));
    return {
      total: all.length,
      open: all.filter((o: Order) => o.status === "OPEN").length,
      filled: all.filter((o: Order) => o.status === "FILLED").length,
      cancelled: all.filter((o: Order) => o.status === "CANCELLED").length,
    };
  }),

  // Export all orders as a CSV string for download
  exportCsv: protectedProcedure
    .input(z.object({
      assetClass: z.enum(assetClasses).optional(),
      status: z.enum(orderStatuses).optional(),
      columns: z.array(z.string().trim()).optional(), // subset of column keys matching visibleCols
    }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) return { csv: "" };

      const conditions = [eq(orders.userId, ctx.user.id)];
      if (input.assetClass) conditions.push(eq(orders.assetClass, input.assetClass));
      if (input.status) conditions.push(eq(orders.status, input.status));

      const rows = await db
        .select()
        .from(orders)
        .where(and(...conditions))
        .orderBy(desc(orders.createdAt))
        .limit(10000);

      const escape = (v: unknown): string => {
        const s = v == null ? "" : String(v);
        return s.includes(",") || s.includes('"') || s.includes("\n")
          ? `"${s.replace(/"/g, '""')}"`
          : s;
      };

      // All available columns — key matches the ColumnKey type on the client
      type ColDef = { key: string; label: string; value: (o: Order) => unknown };
      const allCols: ColDef[] = [
        { key: "symbol",   label: "Symbol",          value: (o) => o.symbol },
        { key: "type",     label: "Type",            value: (o) => o.orderType },
        { key: "qty",      label: "Quantity",        value: (o) => o.quantity },
        { key: "price",    label: "Price",           value: (o) => o.price ?? "" },
        { key: "filled",   label: "Filled Qty",      value: (o) => o.filledQty ?? "0" },
        { key: "avgPrice", label: "Avg Fill Price",  value: (o) => o.avgFillPrice ?? "" },
        { key: "status",   label: "Status",          value: (o) => o.status },
        { key: "tif",      label: "Time In Force",   value: (o) => o.timeInForce ?? "GTC" },
        // Always-included metadata columns
        { key: "id",          label: "Order ID",        value: (o) => o.id },
        { key: "side",        label: "Side",            value: (o) => o.side },
        { key: "assetClass",  label: "Asset Class",     value: (o) => o.assetClass },
        { key: "stopPrice",   label: "Stop Price",      value: (o) => o.stopPrice ?? "" },
        { key: "notes",       label: "Notes",           value: (o) => o.notes ?? "" },
        { key: "createdAt",   label: "Created At",      value: (o) => o.createdAt ? new Date(o.createdAt).toISOString() : "" },
        { key: "updatedAt",   label: "Updated At",      value: (o) => o.updatedAt ? new Date(o.updatedAt).toISOString() : "" },
      ];

      // If columns specified, filter to those keys; always include id/side/createdAt as anchors
      const alwaysInclude = new Set(["id", "side", "createdAt"]);
      const activeCols = input.columns && input.columns.length > 0
        ? allCols.filter((c) => input.columns!.includes(c.key) || alwaysInclude.has(c.key))
        : allCols;

      const header = activeCols.map((c) => escape(c.label)).join(",");
      const lines = rows.map((o: Order) =>
        activeCols.map((c) => escape(c.value(o))).join(",")
      );

      return { csv: [header, ...lines].join("\n") };
    }),

  /**
   * cancelMany — bulk cancel open/partially-filled orders.
   * Attempts gRPC CancelOrder for each order; partial failures are tolerated.
   * Returns { cancelled, failed } counts.
   */
  cancelMany: protectedProcedure
    .input(z.object({
      ids: z.array(z.number().int().positive()).min(1).max(100),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) return { cancelled: 0, failed: input.ids.length };
      // Fetch only the user's own cancellable orders that match the requested IDs
      const allUserOrders = await db
        .select({ id: orders.id, symbol: orders.symbol, assetClass: orders.assetClass, status: orders.status })
        .from(orders)
        .where(eq(orders.userId, ctx.user.id));
      const rows = allUserOrders.filter(
        (o) => input.ids.includes(o.id) && ["OPEN", "PARTIALLY_FILLED"].includes(o.status ?? "")
      );

      let cancelled = 0;
      let failed = 0;

      await Promise.allSettled(
        rows.map(async (o: { id: number; symbol: string; notes?: string | null }) => {
          try {
            // Cancel in Rust engine if we have the engine UUID
            const rustIdMatch = o.notes?.match(/\[rust:([a-f0-9-]{36})\]/);
            if (rustIdMatch) {
              await rustCancelOrder(o.symbol, rustIdMatch[1]).catch(() => {/* non-critical */});
            }
            await db
              .update(orders)
              .set({ status: "CANCELLED", updatedAt: new Date() })
              .where(and(eq(orders.id, o.id), eq(orders.userId, ctx.user.id)));
            cancelled++;
          } catch {
            failed++;
          }
        })
      );

      return { cancelled, failed };
    }),

  /**
   * amend — modify quantity and/or limit price of an OPEN or PARTIALLY_FILLED order.
   *
   * Rules:
   *  - Only the order owner can amend their own orders.
   *  - Only OPEN or PARTIALLY_FILLED orders can be amended.
   *  - New quantity must be greater than filledQty (cannot reduce below already-filled amount).
   *  - Emits an AUDIT notification so the trader has a paper trail.
   *  - Attempts to notify the Rust matching engine of the change (non-blocking).
   */
  amend: protectedProcedure
    .input(z.object({
      orderId: z.number().int().positive(),
      /** New total quantity (must be > filledQty) */
      quantity: z.number().positive().optional(),
      /** New limit price (only valid for LIMIT / STOP_LIMIT orders) */
      price: z.number().positive().optional(),
      /** Optional reason for the amendment (stored in audit trail) */
      reason: z.string().max(512).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      // ── Fetch the order ──────────────────────────────────────────────────────
      const [existing] = await db
        .select()
        .from(orders)
        .where(and(eq(orders.id, input.orderId), eq(orders.userId, ctx.user.id)))
        .limit(1);

      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Order not found" });
      }

      if (existing.status !== "OPEN" && existing.status !== "PARTIALLY_FILLED") {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `Cannot amend an order with status ${existing.status}. Only OPEN or PARTIALLY_FILLED orders can be amended.`,
        });
      }

      // ── Validate new quantity ────────────────────────────────────────────────
      const filledQty = parseFloat(String(existing.filledQty ?? "0"));
      if (input.quantity !== undefined && input.quantity <= filledQty) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `New quantity (${input.quantity}) must be greater than already-filled quantity (${filledQty}).`,
        });
      }

      // ── Build update payload ─────────────────────────────────────────────────
      const updates: Partial<typeof existing> & { updatedAt: Date } = { updatedAt: new Date() };
      if (input.quantity !== undefined) updates.quantity = String(input.quantity);
      if (input.price !== undefined) updates.price = String(input.price);

      const [updated] = await db
        .update(orders)
        .set(updates)
        .where(and(eq(orders.id, input.orderId), eq(orders.userId, ctx.user.id)))
        .returning();

      // ── Persist amendment to audit trail ────────────────────────────────────
      try {
        await db.insert(orderAmendments).values({
          orderId: input.orderId,
          userId: ctx.user.id,
          oldQty: String(existing.quantity),
          newQty: input.quantity !== undefined ? String(input.quantity) : String(existing.quantity),
          oldPrice: existing.price ?? null,
          newPrice: input.price !== undefined ? String(input.price) : (existing.price ?? null),
          reason: input.reason ?? null,
          isBulk: false,
        });
      } catch (amendErr) {
        console.warn(`[Orders] Failed to insert amendment record for order ${input.orderId}:`, (amendErr as Error).message);
      }

      // ── In-app audit notification ────────────────────────────────────────────
      const changes: string[] = [];
      if (input.quantity !== undefined) changes.push(`Qty: ${parseFloat(String(existing.quantity)).toLocaleString()} → ${input.quantity.toLocaleString()}`);
      if (input.price !== undefined) changes.push(`Price: ${parseFloat(String(existing.price ?? 0)).toLocaleString()} → ${input.price.toLocaleString()}`);

      try {
        await db.insert(notifications).values({
          userId: ctx.user.id,
          title: `Order #${input.orderId} Amended — ${existing.symbol}`,
          message: [
            `Your ${existing.side} order for ${existing.symbol} has been amended.`,
            `Changes: ${changes.join(" | ")}`,
            `Status remains: ${existing.status}`,
          ].join("\n"),
          type: "SYSTEM",
          read: false,
          metadata: {
            orderId: input.orderId,
            symbol: existing.symbol,
            side: existing.side,
            amendType: "ORDER_AMENDMENT",
            changes,
            previousQty: parseFloat(String(existing.quantity)),
            previousPrice: existing.price ? parseFloat(String(existing.price)) : null,
            newQty: input.quantity ?? parseFloat(String(existing.quantity)),
            newPrice: input.price ?? (existing.price ? parseFloat(String(existing.price)) : null),
          },
        });
      } catch (notifErr) {
        console.warn(`[Orders] Failed to insert amendment notification for order ${input.orderId}:`, (notifErr as Error).message);
      }
      // ── Browser push notification with before/after diff ─────────────────────
      // Build a human-readable diff string so traders see exactly what changed
      // without opening the app.
      if (changes.length > 0) {
        const diffLines: string[] = [];
        if (input.quantity !== undefined) {
          const oldQty = parseFloat(String(existing.quantity));
          diffLines.push(`Qty ${oldQty.toLocaleString()} → ${input.quantity.toLocaleString()}`);
        }
        if (input.price !== undefined) {
          const oldPrice = existing.price ? parseFloat(String(existing.price)) : 0;
          diffLines.push(`Price ₦${oldPrice.toLocaleString()} → ₦${input.price.toLocaleString()}`);
        }
        const diffBody = diffLines.join("  |  ");
        pushToUser(
          ctx.user.id,
          {
            title: `Order #${input.orderId} Amended — ${existing.symbol}`,
            body:  `${existing.side} ${existing.symbol}: ${diffBody}`,
            tag:   `amend-${input.orderId}`,
          },
          "tradeFills",
        ).catch(() => {});
      }
      // ── Non-blocking Rust engine notification ────────────────────────────────
      // The Rust engine does not support in-place amendments; we cancel and resubmit..
      // This is fire-and-forget — the DB is already updated.
      setImmediate(async () => {
        try {
          const rustIdMatch = updated.notes?.match(/\[rust:([a-f0-9-]{36})\]/);
          if (rustIdMatch) {
            await rustCancelOrder(updated.symbol, rustIdMatch[1]).catch(() => {});
          }
          // Resubmit with updated parameters
          const rustOrderType = updated.orderType === "STOP_LIMIT" ? "STOPLIMIT" : updated.orderType as "LIMIT" | "MARKET" | "STOP" | "STOPLIMIT" | "IOC" | "FOK" | "GTC" | "GTD";
          await rustSubmitOrder({
            client_order_id: `AMEND-${updated.id}-${Date.now()}`,
            account_id: `USER-${ctx.user.id}`,
            symbol: updated.symbol,
            side: updated.side as "BUY" | "SELL",
            order_type: rustOrderType,
            time_in_force: (updated.timeInForce ?? "GTC") as "GTC" | "IOC" | "FOK" | "DAY" | "GTD",
            price: updated.price ? parseFloat(String(updated.price)) : undefined,
            stop_price: updated.stopPrice ? parseFloat(String(updated.stopPrice)) : undefined,
            quantity: parseFloat(String(updated.quantity)) - filledQty, // remaining quantity only
          }).catch(() => {});
        } catch {
          // Non-critical — order is already updated in DB
        }
      });

      return updated;
    }),

  /**
   * listAmendments — return the amendment audit trail for a specific order.
   * Only the order owner can view their own amendment history.
   */
  listAmendments: protectedProcedure
    .input(z.object({ orderId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) return [];
      // Verify ownership first
      const [order] = await db
        .select({ id: orders.id })
        .from(orders)
        .where(and(eq(orders.id, input.orderId), eq(orders.userId, ctx.user.id)))
        .limit(1);
      if (!order) throw new TRPCError({ code: "NOT_FOUND", message: "Order not found" });
      return db
        .select()
        .from(orderAmendments)
        .where(eq(orderAmendments.orderId, input.orderId))
        .orderBy(desc(orderAmendments.amendedAt));
    }),

  /**
   * amendMany — bulk amend quantity and/or price across multiple OPEN/PARTIALLY_FILLED orders.
   *
   * Rules:
   *  - Max 50 orders per call.
   *  - Each order must belong to the caller and be OPEN or PARTIALLY_FILLED.
   *  - The same new quantity / new price is applied to all selected orders.
   *  - New quantity must be > filledQty for each individual order; orders that fail
   *    this check are counted as `failed` (not a hard abort — others still proceed).
   *  - Writes an amendment record for each successfully amended order.
   *  - Returns { amended, failed, errors } for partial-failure transparency.
   */
  amendMany: protectedProcedure
    .input(z.object({
      ids:      z.array(z.number().int().positive()).min(1).max(50),
      /** New total quantity to apply to every selected order */
      quantity: z.number().positive().optional(),
      /** New limit price to apply to every selected order */
      price:    z.number().positive().optional(),
      /** Optional reason stored in every amendment audit record */
      reason:   z.string().max(512).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      if (!input.quantity && !input.price) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Provide at least one of quantity or price" });
      }
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      // Fetch only the user's own amendable orders that match the requested IDs
      const rows = await db
        .select()
        .from(orders)
        .where(and(
          eq(orders.userId, ctx.user.id),
        ))
        .then((all) => all.filter(
          (o) => input.ids.includes(o.id) && ["OPEN", "PARTIALLY_FILLED"].includes(o.status ?? "")
        ));

      let amended = 0;
      let failed  = 0;
      const errors: Array<{ orderId: number; reason: string }> = [];

      await Promise.allSettled(
        rows.map(async (existing) => {
          try {
            const filledQty = parseFloat(String(existing.filledQty ?? "0"));

            // Validate new quantity against already-filled amount
            if (input.quantity !== undefined && input.quantity <= filledQty) {
              failed++;
              errors.push({
                orderId: existing.id,
                reason: `New quantity (${input.quantity}) ≤ filled quantity (${filledQty})`,
              });
              return;
            }

            // Build update payload
            const updates: { updatedAt: Date; quantity?: string; price?: string } = { updatedAt: new Date() };
            if (input.quantity !== undefined) updates.quantity = String(input.quantity);
            if (input.price    !== undefined) updates.price    = String(input.price);

            await db
              .update(orders)
              .set(updates)
              .where(and(eq(orders.id, existing.id), eq(orders.userId, ctx.user.id)));

            // Persist amendment audit record
            await db.insert(orderAmendments).values({
              orderId: existing.id,
              userId:  ctx.user.id,
              oldQty:  String(existing.quantity),
              newQty:  input.quantity !== undefined ? String(input.quantity) : String(existing.quantity),
              oldPrice: existing.price ?? null,
              newPrice: input.price    !== undefined ? String(input.price)    : (existing.price ?? null),
              reason:  input.reason ?? null,
              isBulk:  true,
            });

            // Non-blocking push notification
            const changes: string[] = [];
            if (input.quantity !== undefined) changes.push(`Qty: ${parseFloat(String(existing.quantity)).toLocaleString()} → ${input.quantity.toLocaleString()}`);
            if (input.price    !== undefined) changes.push(`Price: ${parseFloat(String(existing.price ?? 0)).toLocaleString()} → ${input.price.toLocaleString()}`);
            pushToUser(ctx.user.id, {
              title: `Order #${existing.id} Amended — ${existing.symbol}`,
              body:  `Bulk amendment applied. ${changes.join(" | ")}`,
              tag:   `amend-${existing.id}`,
            }).catch(() => {});

            amended++;
          } catch (err) {
            failed++;
            errors.push({ orderId: existing.id, reason: (err as Error).message });
          }
        })
      );

      return { amended, failed, errors };
    }),

  // ── Saved Order Templates ────────────────────────────────────────────────────
  // Allows users to save frequently-used order configurations as named templates
  // for quick reuse in the Trade panel.
  listSavedOrders: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) return [];
    return db
      .select()
      .from(savedOrders)
      .where(eq(savedOrders.userId, ctx.user.id))
      .orderBy(desc(savedOrders.createdAt));
  }),

  createSavedOrder: protectedProcedure
    .input(z.object({
      name: z.string().min(1).max(128),
      symbol: z.string().min(1).max(32),
      side: z.enum(["BUY", "SELL"]),
      orderType: z.enum(["LIMIT", "MARKET", "STOP_LIMIT"]),
      quantity: z.number().positive(),
      price: z.number().positive().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      const [row] = await db
        .insert(savedOrders)
        .values({
          userId: ctx.user.id,
          name: input.name,
          symbol: input.symbol,
          side: input.side,
          orderType: input.orderType,
          quantity: String(input.quantity),
          price: input.price != null ? String(input.price) : null,
        })
        .returning();
      return row;
    }),

  deleteSavedOrder: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      await db
        .delete(savedOrders)
        .where(and(eq(savedOrders.id, input.id), eq(savedOrders.userId, ctx.user.id)));
      return { success: true };
    }),

  /**
   * listFills — paginated trade fill ledger for the authenticated user.
   * Returns fills where the user was either the buyer or seller.
   */
  listFills: protectedProcedure
    .input(z.object({
      symbol: z.string().optional(),
      limit: z.number().min(1).max(200).default(50),
      offset: z.number().min(0).default(0),
      fromDate: z.string().optional(), // ISO date string e.g. "2026-01-01"
      toDate: z.string().optional(),   // ISO date string e.g. "2026-12-31"
    }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) return { fills: [], total: 0 };
      const { or, eq: eqFn, and: andFn, desc: descFn, count, ilike, gte, lte } = await import("drizzle-orm");
      const { tradeFills } = await import("../../drizzle/schema");
      const userCondition = or(
        eqFn(tradeFills.buyerUserId, ctx.user.id),
        eqFn(tradeFills.sellerUserId, ctx.user.id),
      )!;
      const clauses: ReturnType<typeof eqFn>[] = [userCondition as ReturnType<typeof eqFn>];
      if (input.symbol) clauses.push(ilike(tradeFills.symbol, `%${input.symbol}%`) as ReturnType<typeof eqFn>);
      if (input.fromDate) clauses.push(gte(tradeFills.createdAt, new Date(input.fromDate)) as ReturnType<typeof eqFn>);
      if (input.toDate) {
        const to = new Date(input.toDate);
        to.setHours(23, 59, 59, 999);
        clauses.push(lte(tradeFills.createdAt, to) as ReturnType<typeof eqFn>);
      }
      const conditions = clauses.length === 1 ? clauses[0] : andFn(...clauses as [ReturnType<typeof eqFn>, ...ReturnType<typeof eqFn>[]])!;
      const [totalRow] = await db
        .select({ total: count() })
        .from(tradeFills)
        .where(conditions);
      const fills = await db
        .select()
        .from(tradeFills)
        .where(conditions)
        .orderBy(descFn(tradeFills.createdAt))
        .limit(input.limit)
        .offset(input.offset);
      return {
        fills: fills.map((f) => ({
          ...f,
          side: f.buyerUserId === ctx.user.id ? "BUY" as const : "SELL" as const,
        })),
        total: Number(totalRow?.total ?? 0),
      };
    }),

  /**
   * exportFillsCsv — streams the user's trade fill ledger to CSV.
   * Mirrors the columns[] pattern from exportCsv.
   */
  exportFillsCsv: protectedProcedure
    .input(z.object({
      symbol: z.string().optional(),
      fromDate: z.string().optional(),
      toDate: z.string().optional(),
    }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) return { csv: "" };
      const { or, eq: eqFn, and: andFn, desc: descFn, ilike, gte, lte } = await import("drizzle-orm");
      const { tradeFills } = await import("../../drizzle/schema");
      const userCondition = or(
        eqFn(tradeFills.buyerUserId, ctx.user.id),
        eqFn(tradeFills.sellerUserId, ctx.user.id),
      )!;
      const clauses: ReturnType<typeof eqFn>[] = [userCondition as ReturnType<typeof eqFn>];
      if (input.symbol) clauses.push(ilike(tradeFills.symbol, `%${input.symbol}%`) as ReturnType<typeof eqFn>);
      if (input.fromDate) clauses.push(gte(tradeFills.createdAt, new Date(input.fromDate)) as ReturnType<typeof eqFn>);
      if (input.toDate) {
        const to = new Date(input.toDate);
        to.setHours(23, 59, 59, 999);
        clauses.push(lte(tradeFills.createdAt, to) as ReturnType<typeof eqFn>);
      }
      const conditions = clauses.length === 1 ? clauses[0] : andFn(...clauses as [ReturnType<typeof eqFn>, ...ReturnType<typeof eqFn>[]])!;
      const rows = await db
        .select()
        .from(tradeFills)
        .where(conditions)
        .orderBy(descFn(tradeFills.createdAt))
        .limit(50000);
      const esc = (v: unknown): string => {
        const s = v == null ? "" : String(v);
        return s.includes(",") || s.includes('"') || s.includes("\n")
          ? `"${s.replace(/"/g, '""')}"`
          : s;
      };
      const header = [
        "Fill ID", "Symbol", "Asset Class", "Side",
        "Filled Qty", "Fill Price", "Gross Value",
        "Fee", "Settlement ID", "Sequence No", "Filled At",
      ].join(",");
      const lines = rows.map((f) => [
        esc(f.id),
        esc(f.symbol),
        esc(f.assetClass),
        esc(f.buyerUserId === ctx.user.id ? "BUY" : "SELL"),
        esc(f.filledQty),
        esc(f.fillPrice),
        esc(f.grossValue),
        esc(f.buyerUserId === ctx.user.id ? f.buyerFee : f.sellerFee),
        esc(f.settlementId ?? ""),
        esc(f.sequenceNo),
        esc(f.createdAt ? new Date(f.createdAt).toISOString() : ""),
      ].join(","));
      return { csv: [header, ...lines].join("\n") };
    }),
});
