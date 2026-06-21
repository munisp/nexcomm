/**
 * NEXCOM gRPC Server
 * ─────────────────────────────────────────────────────────────────────────────
 * Implements three gRPC services defined in proto/nexcom.proto:
 *   1. MatchingEngine  — order submission, cancellation, order book
 *   2. SettlementService — T+2 settlement lifecycle management
 *   3. PriceAlertService — price alert CRUD and streaming triggers
 *
 * The gRPC server runs on port 50051 (configurable via GRPC_PORT env var).
 * The main Express/tRPC server acts as a gRPC client via grpcClient.ts.
 *
 * Architecture:
 *   Browser → tRPC (HTTP/JSON) → Express server → gRPC client → gRPC server
 *                                                                    ↓
 *                                                             PostgreSQL (local)
 */
import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";
import path from "path";
import { fileURLToPath } from "url";
import { getDb } from "../db";
import { orders, settlements, priceAlerts } from "../../drizzle/schema";
import { eq, and, desc, lte } from "drizzle-orm";
import { produce, FLUVIO_TOPICS } from "../fluvio/fluvioClient";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROTO_PATH = path.resolve(__dirname, "../../proto/nexcom.proto");

// ─── Load proto ───────────────────────────────────────────────────────────────
const packageDef = protoLoader.loadSync(PROTO_PATH, {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
});
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const proto = (grpc.loadPackageDefinition(packageDef) as any).nexcom;

// ─── In-memory order book (per symbol) ───────────────────────────────────────
// In production this would be replaced by a dedicated matching engine (e.g. Aeron, Disruptor).
// For this implementation we maintain a simple sorted order book in memory.
interface BookLevel { price: number; qty: number; count: number }
const orderBooks = new Map<string, { bids: BookLevel[]; asks: BookLevel[]; lastPrice: number }>();
const orderBookSubscribers = new Map<string, Set<grpc.ServerWritableStream<unknown, unknown>>>();

function getOrCreateBook(symbol: string) {
  if (!orderBooks.has(symbol)) {
    orderBooks.set(symbol, { bids: [], asks: [], lastPrice: 0 });
  }
  return orderBooks.get(symbol)!;
}

function broadcastOrderBookUpdate(symbol: string) {
  const subs = orderBookSubscribers.get(symbol);
  const book = getOrCreateBook(symbol);
  const now = Date.now();
  const update = {
    symbol,
    bids: book.bids.slice(0, 20),
    asks: book.asks.slice(0, 20),
    timestamp_ms: now.toString(),
    last_price: book.lastPrice,
    is_snapshot: false,
  };
  // Broadcast to gRPC subscribers
  if (subs && subs.size > 0) {
    for (const stream of subs) {
      try { stream.write(update); } catch { subs.delete(stream); }
    }
  }
  // Emit to Fluvio for real-time downstream consumers (analytics, risk engine, lakehouse)
  produce(FLUVIO_TOPICS.ORDER_BOOK_UPDATE, {
    key: symbol,
    value: {
      symbol,
      bids: update.bids,
      asks: update.asks,
      lastPrice: book.lastPrice,
      timestamp: new Date(now).toISOString(),
    },
  }).catch(() => { /* Fluvio unavailable — gRPC stream handles delivery */ });
}

// ─── Matching Engine Implementation ──────────────────────────────────────────
const matchingEngineImpl = {
  async SubmitOrder(
    call: grpc.ServerUnaryCall<Record<string, unknown>, unknown>,
    callback: grpc.sendUnaryData<unknown>
  ) {
    try {
      const req = call.request as {
        user_id: number; client_order_id: string; symbol: string;
        asset_class: string; side: string; order_type: string;
        quantity: number; price: number; stop_price: number;
        time_in_force: string; notes: string;
      };

      const db = await getDb();
      if (!db) {
        callback({ code: grpc.status.UNAVAILABLE, message: "Database unavailable" });
        return;
      }

      // ── Idempotency check ──────────────────────────────────────────────────
      if (req.client_order_id) {
        const [existing] = await db
          .select()
          .from(orders)
          .where(and(
            eq(orders.userId, req.user_id),
            eq(orders.clientOrderId, req.client_order_id)
          ))
          .limit(1);
        if (existing) {
          callback(null, {
            order_id: existing.id,
            client_order_id: existing.clientOrderId,
            status: existing.status,
            filled_qty: parseFloat(existing.filledQty ?? "0"),
            avg_fill_price: parseFloat(existing.price ?? "0"),
            idempotent: true,
            message: "Duplicate order — returning existing",
            fills: [],
          });
          return;
        }
      }

      // ── Insert order ───────────────────────────────────────────────────────
      const [order] = await db
        .insert(orders)
        .values({
          userId: req.user_id,
          symbol: req.symbol,
          assetClass: req.asset_class as "COMMODITY" | "FOREX" | "EQUITY" | "DIGITAL_ASSET" | "INDEX",
          side: req.side as "BUY" | "SELL",
          orderType: req.order_type as "LIMIT" | "MARKET" | "STOP_LIMIT",
          quantity: String(req.quantity),
          price: req.price ? String(req.price) : null,
          stopPrice: req.stop_price ? String(req.stop_price) : null,
          timeInForce: (req.time_in_force || "GTC") as "GTC" | "DAY" | "IOC" | "FOK",
          notes: req.notes || null,
          status: "OPEN",
          filledQty: "0",
          clientOrderId: req.client_order_id || null,
        })
        .returning();

      // ── Simulate market order immediate fill ───────────────────────────────
      let status = "OPEN";
      let filledQty = 0;
      let avgFillPrice = req.price || 0;

      if (req.order_type === "MARKET") {
        status = "FILLED";
        filledQty = req.quantity;
        avgFillPrice = req.price || 0;
        await db
          .update(orders)
          .set({ status: "FILLED", filledQty: String(req.quantity), updatedAt: new Date() })
          .where(eq(orders.id, order.id));
      }

      // ── Update in-memory order book ────────────────────────────────────────
      const book = getOrCreateBook(req.symbol);
      if (req.order_type === "LIMIT" && req.price) {
        const side = req.side === "BUY" ? book.bids : book.asks;
        const existing = side.find(l => l.price === req.price);
        if (existing) {
          existing.qty += req.quantity;
          existing.count++;
        } else {
          side.push({ price: req.price, qty: req.quantity, count: 1 });
          if (req.side === "BUY") side.sort((a, b) => b.price - a.price);
          else side.sort((a, b) => a.price - b.price);
        }
        book.lastPrice = req.price;
        broadcastOrderBookUpdate(req.symbol);
      }

      callback(null, {
        order_id: order.id,
        client_order_id: order.clientOrderId || "",
        status,
        filled_qty: filledQty,
        avg_fill_price: avgFillPrice,
        idempotent: false,
        message: status === "FILLED" ? "Market order filled immediately" : "Order accepted",
        fills: status === "FILLED" ? [{
          fill_id: Date.now(),
          quantity: req.quantity,
          price: avgFillPrice,
          timestamp_ms: Date.now().toString(),
          counterparty_order_id: 0,
        }] : [],
      });
    } catch (err) {
      callback({ code: grpc.status.INTERNAL, message: String(err) });
    }
  },

  async CancelOrder(
    call: grpc.ServerUnaryCall<Record<string, unknown>, unknown>,
    callback: grpc.sendUnaryData<unknown>
  ) {
    try {
      const req = call.request as { order_id: number; user_id: number };
      const db = await getDb();
      if (!db) {
        callback({ code: grpc.status.UNAVAILABLE, message: "Database unavailable" });
        return;
      }
      const [updated] = await db
        .update(orders)
        .set({ status: "CANCELLED", updatedAt: new Date() })
        .where(and(
          eq(orders.id, req.order_id),
          eq(orders.userId, req.user_id),
          eq(orders.status, "OPEN")
        ))
        .returning();
      if (!updated) {
        callback(null, { success: false, message: "Order not found or already closed", final_status: "CANCELLED" });
        return;
      }
      callback(null, { success: true, message: "Order cancelled", final_status: "CANCELLED" });
    } catch (err) {
      callback({ code: grpc.status.INTERNAL, message: String(err) });
    }
  },

  GetOrderBook(
    call: grpc.ServerUnaryCall<Record<string, unknown>, unknown>,
    callback: grpc.sendUnaryData<unknown>
  ) {
    const req = call.request as { symbol: string; depth: number };
    const book = getOrCreateBook(req.symbol);
    const depth = req.depth || 20;
    const bids = book.bids.slice(0, depth);
    const asks = book.asks.slice(0, depth);
    const spread = asks.length > 0 && bids.length > 0 ? asks[0].price - bids[0].price : 0;
    callback(null, {
      symbol: req.symbol,
      bids,
      asks,
      timestamp_ms: Date.now().toString(),
      last_price: book.lastPrice,
      spread,
    });
  },

  StreamOrderBook(call: grpc.ServerWritableStream<Record<string, unknown>, unknown>) {
    const req = call.request as { symbol: string };
    const symbol = req.symbol;

    if (!orderBookSubscribers.has(symbol)) {
      orderBookSubscribers.set(symbol, new Set());
    }
    orderBookSubscribers.get(symbol)!.add(call as grpc.ServerWritableStream<unknown, unknown>);

    // Send initial snapshot
    const book = getOrCreateBook(symbol);
    call.write({
      symbol,
      bids: book.bids.slice(0, 20),
      asks: book.asks.slice(0, 20),
      timestamp_ms: Date.now().toString(),
      last_price: book.lastPrice,
      is_snapshot: true,
    });

    call.on("cancelled", () => {
      orderBookSubscribers.get(symbol)?.delete(call as grpc.ServerWritableStream<unknown, unknown>);
    });
    call.on("close", () => {
      orderBookSubscribers.get(symbol)?.delete(call as grpc.ServerWritableStream<unknown, unknown>);
    });
  },

  async GetOrderStatus(
    call: grpc.ServerUnaryCall<Record<string, unknown>, unknown>,
    callback: grpc.sendUnaryData<unknown>
  ) {
    const req = call.request as { order_id: number; user_id: number };
    const db = await getDb();
    if (!db) {
      callback({ code: grpc.status.UNAVAILABLE, message: "Database unavailable" });
      return;
    }
    const [order] = await db
      .select()
      .from(orders)
      .where(and(eq(orders.id, req.order_id), eq(orders.userId, req.user_id)))
      .limit(1);
    if (!order) {
      callback({ code: grpc.status.NOT_FOUND, message: "Order not found" });
      return;
    }
    callback(null, order.status);
  },
};

// ─── Settlement Service Implementation ───────────────────────────────────────
const settlementServiceImpl = {
  async InitiateSettlement(
    call: grpc.ServerUnaryCall<Record<string, unknown>, unknown>,
    callback: grpc.sendUnaryData<unknown>
  ) {
    try {
      const req = call.request as {
        order_id: number; user_id: number; symbol: string; asset_class: string;
        side: string; quantity: number; price: number; settlement_date_ms: string;
        counterparty_id: string;
      };
      const db = await getDb();
      if (!db) {
        callback({ code: grpc.status.UNAVAILABLE, message: "Database unavailable" });
        return;
      }
      const grossAmount = req.quantity * req.price;
      const fee = grossAmount * 0.001; // 0.1% exchange fee
      const netAmount = req.side === "BUY" ? grossAmount + fee : grossAmount - fee;
      const [settlement] = await db
        .insert(settlements)
        .values({
          orderId: req.order_id,
          userId: req.user_id,
          symbol: req.symbol,
          assetClass: req.asset_class as "COMMODITY" | "FOREX" | "EQUITY" | "DIGITAL_ASSET" | "INDEX",
          side: req.side as "BUY" | "SELL",
          quantity: String(req.quantity),
          price: String(req.price),
          grossAmount: String(grossAmount.toFixed(2)),
          fee: String(fee.toFixed(2)),
          netAmount: String(netAmount.toFixed(2)),
          status: "PENDING",
          settlementDate: new Date(parseInt(req.settlement_date_ms)),
          counterpartyId: req.counterparty_id ? parseInt(req.counterparty_id) : null,
        })
        .returning();
      callback(null, {
        success: true,
        message: "Settlement initiated",
        settlement: toSettlementRecord(settlement),
      });
    } catch (err) {
      callback({ code: grpc.status.INTERNAL, message: String(err) });
    }
  },

  async UpdateSettlementStatus(
    call: grpc.ServerUnaryCall<Record<string, unknown>, unknown>,
    callback: grpc.sendUnaryData<unknown>
  ) {
    try {
      const req = call.request as { settlement_id: number; status: string; notes: string };
      const db = await getDb();
      if (!db) {
        callback({ code: grpc.status.UNAVAILABLE, message: "Database unavailable" });
        return;
      }
      const [updated] = await db
        .update(settlements)
        .set({ status: req.status as "PENDING" | "MATCHED" | "SETTLED" | "FAILED", notes: req.notes, updatedAt: new Date() })
        .where(eq(settlements.id, req.settlement_id))
        .returning();
      if (!updated) {
        callback({ code: grpc.status.NOT_FOUND, message: "Settlement not found" });
        return;
      }
      callback(null, { success: true, message: "Settlement updated", settlement: toSettlementRecord(updated) });
    } catch (err) {
      callback({ code: grpc.status.INTERNAL, message: String(err) });
    }
  },

  async GetSettlement(
    call: grpc.ServerUnaryCall<Record<string, unknown>, unknown>,
    callback: grpc.sendUnaryData<unknown>
  ) {
    const req = call.request as { settlement_id: number };
    const db = await getDb();
    if (!db) {
      callback({ code: grpc.status.UNAVAILABLE, message: "Database unavailable" });
      return;
    }
    const [s] = await db.select().from(settlements).where(eq(settlements.id, req.settlement_id)).limit(1);
    if (!s) {
      callback({ code: grpc.status.NOT_FOUND, message: "Settlement not found" });
      return;
    }
    callback(null, { success: true, message: "OK", settlement: toSettlementRecord(s) });
  },

  async ListSettlements(
    call: grpc.ServerUnaryCall<Record<string, unknown>, unknown>,
    callback: grpc.sendUnaryData<unknown>
  ) {
    const req = call.request as { user_id: number; status: string; limit: number; offset: number };
    const db = await getDb();
    if (!db) {
      callback({ code: grpc.status.UNAVAILABLE, message: "Database unavailable" });
      return;
    }
    const conditions = [eq(settlements.userId, req.user_id)];
    if (req.status && req.status !== "PENDING") {
      conditions.push(eq(settlements.status, req.status as "PENDING" | "MATCHED" | "SETTLED" | "FAILED"));
    }
    const rows = await db
      .select()
      .from(settlements)
      .where(and(...conditions))
      .orderBy(desc(settlements.createdAt))
      .limit(req.limit || 50);
    callback(null, { settlements: rows.map(toSettlementRecord), total: rows.length });
  },

  async BatchSettle(
    call: grpc.ServerUnaryCall<Record<string, unknown>, unknown>,
    callback: grpc.sendUnaryData<unknown>
  ) {
    const req = call.request as { settlement_date_ms: string };
    const db = await getDb();
    if (!db) {
      callback({ code: grpc.status.UNAVAILABLE, message: "Database unavailable" });
      return;
    }
    const targetDate = new Date(parseInt(req.settlement_date_ms));
    const pending = await db
      .select()
      .from(settlements)
      .where(and(eq(settlements.status, "PENDING"), lte(settlements.settlementDate, targetDate)));

    let settledCount = 0;
    let failedCount = 0;
    const errors: string[] = [];

    for (const s of pending) {
      try {
        await db
          .update(settlements)
          .set({ status: "SETTLED", updatedAt: new Date() })
          .where(eq(settlements.id, s.id));
        settledCount++;
      } catch (err) {
        failedCount++;
        errors.push(`Settlement ${s.id}: ${String(err)}`);
      }
    }

    callback(null, { settled_count: settledCount, failed_count: failedCount, errors });
  },
};

// ─── Price Alert Service Implementation ──────────────────────────────────────
const alertSubscribers = new Map<number, Set<grpc.ServerWritableStream<unknown, unknown>>>();

const priceAlertServiceImpl = {
  async CreateAlert(
    call: grpc.ServerUnaryCall<Record<string, unknown>, unknown>,
    callback: grpc.sendUnaryData<unknown>
  ) {
    try {
      const req = call.request as {
        user_id: number; symbol: string; asset_class: string;
        direction: string; target_price: number; note: string;
      };
      const db = await getDb();
      if (!db) {
        callback({ code: grpc.status.UNAVAILABLE, message: "Database unavailable" });
        return;
      }
      const [alert] = await db
        .insert(priceAlerts)
        .values({
          userId: req.user_id,
          symbol: req.symbol,
          condition: (req.direction || "ABOVE") as "ABOVE" | "BELOW" | "CROSS_ABOVE" | "CROSS_BELOW",
          targetPrice: String(req.target_price),
          triggered: false,
          notified: false,
        })
        .returning();
      callback(null, { success: true, alert: toAlertRecord(alert) });
    } catch (err) {
      callback({ code: grpc.status.INTERNAL, message: String(err) });
    }
  },

  async DeleteAlert(
    call: grpc.ServerUnaryCall<Record<string, unknown>, unknown>,
    callback: grpc.sendUnaryData<unknown>
  ) {
    const req = call.request as { alert_id: number; user_id: number };
    const db = await getDb();
    if (!db) {
      callback({ code: grpc.status.UNAVAILABLE, message: "Database unavailable" });
      return;
    }
    await db.delete(priceAlerts).where(and(
      eq(priceAlerts.id, req.alert_id),
      eq(priceAlerts.userId, req.user_id)
    ));
    callback(null, { success: true });
  },

  async ListAlerts(
    call: grpc.ServerUnaryCall<Record<string, unknown>, unknown>,
    callback: grpc.sendUnaryData<unknown>
  ) {
    const req = call.request as { user_id: number };
    const db = await getDb();
    if (!db) {
      callback({ code: grpc.status.UNAVAILABLE, message: "Database unavailable" });
      return;
    }
    const rows = await db
      .select()
      .from(priceAlerts)
      .where(eq(priceAlerts.userId, req.user_id))
      .orderBy(desc(priceAlerts.createdAt));
    callback(null, { alerts: rows.map(toAlertRecord) });
  },

  StreamTriggeredAlerts(call: grpc.ServerWritableStream<Record<string, unknown>, unknown>) {
    const req = call.request as { user_id: number };
    const userId = req.user_id;
    if (!alertSubscribers.has(userId)) {
      alertSubscribers.set(userId, new Set());
    }
    alertSubscribers.get(userId)!.add(call as grpc.ServerWritableStream<unknown, unknown>);
    call.on("cancelled", () => alertSubscribers.get(userId)?.delete(call as grpc.ServerWritableStream<unknown, unknown>));
    call.on("close", () => alertSubscribers.get(userId)?.delete(call as grpc.ServerWritableStream<unknown, unknown>));
  },
};

// ─── Helper: push triggered alert to streaming subscribers ───────────────────
export function notifyAlertSubscribers(userId: number, alert: {
  id: number; symbol: string; targetPrice: string | null;
  direction: string; currentPrice: number;
}) {
  const subs = alertSubscribers.get(userId);
  if (!subs || subs.size === 0) return;
  const msg = {
    alert_id: alert.id,
    symbol: alert.symbol,
    target_price: parseFloat(alert.targetPrice ?? "0"),
    current_price: alert.currentPrice,
    direction: alert.direction,
    triggered_at_ms: Date.now().toString(),
  };
  for (const stream of subs) {
    try { stream.write(msg); } catch { subs.delete(stream); }
  }
}

// ─── Serialisation helpers ────────────────────────────────────────────────────
function toSettlementRecord(s: Record<string, unknown>) {
  return {
    id: s.id,
    order_id: s.orderId,
    user_id: s.userId,
    symbol: s.symbol,
    asset_class: s.assetClass,
    side: s.side,
    quantity: parseFloat(String(s.quantity ?? 0)),
    price: parseFloat(String(s.price ?? 0)),
    status: s.status,
    settlement_date_ms: s.settlementDate instanceof Date
      ? s.settlementDate.getTime().toString()
      : String(s.settlementDate ?? 0),
    counterparty_id: s.counterpartyId ?? "",
    notes: s.notes ?? "",
    created_at_ms: s.createdAt instanceof Date
      ? s.createdAt.getTime().toString()
      : String(s.createdAt ?? 0),
    updated_at_ms: s.updatedAt instanceof Date
      ? s.updatedAt.getTime().toString()
      : String(s.updatedAt ?? 0),
  };
}

function toAlertRecord(a: Record<string, unknown>) {
  return {
    id: a.id,
    user_id: a.userId,
    symbol: a.symbol,
    asset_class: a.assetClass,
    direction: a.direction,
    target_price: parseFloat(String(a.targetPrice ?? 0)),
    triggered: a.triggered ?? false,
    note: a.note ?? "",
    created_at_ms: a.createdAt instanceof Date
      ? a.createdAt.getTime().toString()
      : String(a.createdAt ?? 0),
    triggered_at_ms: a.triggeredAt instanceof Date
      ? a.triggeredAt.getTime().toString()
      : "0",
  };
}

// ─── Server bootstrap ─────────────────────────────────────────────────────────
export function startGrpcServer(port = 50051): grpc.Server {
  const server = new grpc.Server();

  server.addService(proto.MatchingEngine.service, matchingEngineImpl);
  server.addService(proto.SettlementService.service, settlementServiceImpl);
  server.addService(proto.PriceAlertService.service, priceAlertServiceImpl);

  server.bindAsync(
    `0.0.0.0:${port}`,
    grpc.ServerCredentials.createInsecure(),
    (err, boundPort) => {
      if (err) {
        console.error(`[gRPC] Failed to start server: ${err.message}`);
        return;
      }
      console.log(`[gRPC] Server listening on port ${boundPort}`);
    }
  );

  return server;
}
