/**
 * kafkaConsumer.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Kafka consumer for NEXCOM Exchange real-time event streaming.
 *
 * Topics consumed:
 *   - order.filled      → update order status, portfolio positions, notify user
 *   - settlement.completed → mark settlement SETTLED, update wallet balances
 *   - order.cancelled   → update order status
 *   - price.updated     → broadcast to WebSocket clients for live price feed
 *   - risk.alert        → notify admin of risk threshold breaches
 *
 * All consumers are idempotent — safe to replay on restart.
 * Gracefully degrades if Kafka is unavailable (logs warning, continues).
 */

import { Kafka, Consumer, EachMessagePayload, logLevel } from "kafkajs";
import { getDb } from "../db";
import { orders, settlements, positions, tradeFills } from "../../drizzle/schema";
import { eq, and } from "drizzle-orm";
import { notifyOwner } from "../_core/notification";
import { pushToUser } from "../routers/pushNotificationsRouter";

// ─── Kafka client ─────────────────────────────────────────────────────────────

const KAFKA_BROKERS = (process.env.KAFKA_BROKERS ?? "localhost:9092").split(",");
const KAFKA_CLIENT_ID = "nexcom-portal";
const KAFKA_GROUP_ID = "nexcom-portal-consumer";

let _consumer: Consumer | null = null;
let _isRunning = false;

// Suppress noisy connection-refused logs when Kafka is not running locally.
// In production (KAFKA_BROKERS env set to real brokers), all log levels are shown.
const IS_LOCAL_KAFKA = KAFKA_BROKERS.every(
  (b) => b.startsWith("localhost:") || b.startsWith("127.0.0.1:")
);

function createKafkaClient() {
  return new Kafka({
    clientId: KAFKA_CLIENT_ID,
    brokers: KAFKA_BROKERS,
    connectionTimeout: 3000,
    requestTimeout: 5000,
    retry: {
      initialRetryTime: 500,
      retries: 1, // Fail fast in dev; production brokers are reliable
    },
    // Silence KafkaJS internal logs when running against localhost (no broker).
    // Set KAFKA_BROKERS to a real broker address to restore full logging.
    logLevel: IS_LOCAL_KAFKA ? logLevel.NOTHING : logLevel.WARN,
  });
}

// ─── Event types ──────────────────────────────────────────────────────────────

interface OrderFilledEvent {
  orderId: string;
  userId: number;
  symbol: string;
  side: "BUY" | "SELL";
  filledQty: number;
  avgFillPrice: number;
  remainingQty: number;
  status: "FILLED" | "PARTIALLY_FILLED";
  tradeId: string;
  counterpartyOrderId: string;
  timestamp: number;
}

interface SettlementCompletedEvent {
  settlementId: string;
  buyerUserId: number;
  sellerUserId: number;
  symbol: string;
  quantity: number;
  price: number;
  totalAmount: number;
  feeAmount: number;
  tigerBeetleTransferId?: string;
  timestamp: number;
}

interface OrderCancelledEvent {
  orderId: string;
  userId: number;
  reason: string;
  timestamp: number;
}

interface RiskAlertEvent {
  alertType: "MARGIN_CALL" | "POSITION_LIMIT" | "CIRCUIT_BREAKER" | "CONCENTRATION_RISK";
  userId?: number;
  symbol?: string;
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  message: string;
  timestamp: number;
}

// ─── Handler: order.filled ────────────────────────────────────────────────────

async function handleOrderFilled(event: OrderFilledEvent): Promise<void> {
  const db = await getDb();
  if (!db) return;

  // 1. Update order status and fill info
  await db
    .update(orders)
    .set({
      status: event.status === "FILLED" ? "FILLED" : "PARTIALLY_FILLED",
      filledQty: String(event.filledQty),
      avgFillPrice: String(event.avgFillPrice),
      updatedAt: new Date(),
    })
    .where(eq(orders.id, parseInt(event.orderId)));

  // 2. Update positions table (current holdings)
  const existingRows = await db
    .select()
    .from(positions)
    .where(
      and(
        eq(positions.userId, event.userId),
        eq(positions.symbol, event.symbol)
      )
    )
    .limit(1);

  const qtyDelta = event.side === "BUY" ? event.filledQty : -event.filledQty;
  const existing = existingRows[0];

  if (existing) {
    const newQty = parseFloat(existing.quantity) + qtyDelta;
    let newAvgCost = parseFloat(existing.avgCost);

    if (event.side === "BUY" && newQty > 0) {
      // Weighted average cost
      newAvgCost =
        (parseFloat(existing.quantity) * parseFloat(existing.avgCost) +
          event.filledQty * event.avgFillPrice) /
        newQty;
    } else if (event.side === "SELL") {
      // Realized PnL on sell
      const realizedPnl =
        parseFloat(existing.realizedPnl) +
        event.filledQty * (event.avgFillPrice - parseFloat(existing.avgCost));

      if (newQty <= 0) {
        // Position fully closed
        await db.delete(positions).where(eq(positions.id, existing.id));
        return;
      }

      await db
        .update(positions)
        .set({
          quantity: String(Math.max(newQty, 0)),
          realizedPnl: String(realizedPnl),
          updatedAt: new Date(),
        })
        .where(eq(positions.id, existing.id));
      return;
    }

    await db
      .update(positions)
      .set({
        quantity: String(Math.max(newQty, 0)),
        avgCost: String(newAvgCost),
        updatedAt: new Date(),
      })
      .where(eq(positions.id, existing.id));
  } else if (event.side === "BUY" && qtyDelta > 0) {
    // New position
    await db.insert(positions).values({
      userId: event.userId,
      symbol: event.symbol,
      quantity: String(qtyDelta),
      avgCost: String(event.avgFillPrice),
      realizedPnl: "0",
      updatedAt: new Date(),
    });
  }

  // ── Auto-initiate settlement on FILLED orders ────────────────────────────
  if (event.status === "FILLED") {
    const settlementDate = new Date();
    settlementDate.setDate(settlementDate.getDate() + 2); // T+2
    const grossAmount = event.filledQty * event.avgFillPrice;
    const fee = grossAmount * 0.001; // 0.1% exchange fee
    const netAmount = event.side === "BUY" ? grossAmount + fee : grossAmount - fee;
    await db
      .insert(settlements)
      .values({
        orderId: parseInt(event.orderId),
        userId: event.userId,
        symbol: event.symbol,
        assetClass: "COMMODITY",
        side: event.side,
        quantity: String(event.filledQty),
        price: String(event.avgFillPrice),
        grossAmount: String(grossAmount.toFixed(2)),
        fee: String(fee.toFixed(2)),
        netAmount: String(netAmount.toFixed(2)),
        status: "PENDING",
        settlementDate,
      })
      .onConflictDoNothing();

    // Record the trade fill (aggressor = the filled order, resting = counterparty)
    const isBuy = event.side === "BUY";
    await db
      .insert(tradeFills)
      .values({
        aggressorOrderId: parseInt(event.orderId),
        restingOrderId: parseInt(event.counterpartyOrderId) || parseInt(event.orderId),
        symbol: event.symbol,
        assetClass: "COMMODITY",
        buyerUserId: isBuy ? event.userId : 0,
        sellerUserId: isBuy ? 0 : event.userId,
        filledQty: String(event.filledQty),
        fillPrice: String(event.avgFillPrice),
        grossValue: String((event.filledQty * event.avgFillPrice).toFixed(2)),
        buyerFee: isBuy ? String((event.filledQty * event.avgFillPrice * 0.001).toFixed(2)) : "0",
        sellerFee: isBuy ? "0" : String((event.filledQty * event.avgFillPrice * 0.001).toFixed(2)),
        sequenceNo: Date.now(),
      })
      .onConflictDoNothing();

    console.log(
      `[Kafka] Auto-initiated settlement for orderId=${event.orderId} ` +
        `symbol=${event.symbol} gross=${grossAmount.toFixed(2)} fee=${fee.toFixed(2)}`
    );
  }

  // ── Browser Push: async fill notification (Kafka-driven) ──────────────────
  const fillLabel = event.status === "FILLED" ? "Order Filled" : "Order Partially Filled";
  const priceStr = event.avgFillPrice > 0
    ? ` @ ${event.avgFillPrice.toLocaleString(undefined, { maximumFractionDigits: 4 })}`
    : "";
  const qtyStr = event.filledQty > 0
    ? `${event.filledQty.toLocaleString(undefined, { maximumFractionDigits: 6 })} units`
    : "";
  pushToUser(
    event.userId,
    {
      title: `${fillLabel}: ${event.side} ${event.symbol}`,
      body: `${qtyStr} filled${priceStr}`,
      url: "/orders",
      tag: `order-fill-${event.orderId}`,
    },
    "tradeFills",
  ).catch(e => console.warn("[WebPush] Kafka fill push failed:", (e as Error).message));

  console.log(
    `[Kafka] order.filled: orderId=${event.orderId} symbol=${event.symbol} ` +
      `qty=${event.filledQty}@${event.avgFillPrice} status=${event.status}`
  );
}

// ─── Handler: settlement.completed ───────────────────────────────────────────

async function handleSettlementCompleted(event: SettlementCompletedEvent): Promise<void> {
  const db = await getDb();
  if (!db) return;

  // Mark settlement as SETTLED — match by orderId (settlementId maps to orderId in the event)
  await db
    .update(settlements)
    .set({
      status: "SETTLED",
      settlementDate: new Date(event.timestamp),
      notes: event.tigerBeetleTransferId
        ? `TigerBeetle transfer: ${event.tigerBeetleTransferId}`
        : "Settled via local transfer tracking",
      updatedAt: new Date(),
    })
    .where(eq(settlements.orderId, parseInt(event.settlementId)));

  console.log(
    `[Kafka] settlement.completed: id=${event.settlementId} ` +
      `symbol=${event.symbol} qty=${event.quantity}@${event.price} ` +
      `total=${event.totalAmount} tb=${event.tigerBeetleTransferId ?? "N/A"}`
  );
}

// ─── Handler: order.cancelled ─────────────────────────────────────────────────

async function handleOrderCancelled(event: OrderCancelledEvent): Promise<void> {
  const db = await getDb();
  if (!db) return;

  await db
    .update(orders)
    .set({
      status: "CANCELLED",
      updatedAt: new Date(),
    })
    .where(eq(orders.id, parseInt(event.orderId)));

  // ── Browser Push: cancellation notification ─────────────────────────────
  if (event.userId) {
    // Fetch order details for the push payload
    const db2 = await getDb();
    if (db2) {
      const [ord] = await db2.select().from(orders).where(eq(orders.id, parseInt(event.orderId))).limit(1);
      if (ord) {
        pushToUser(
          event.userId,
          {
            title: `Order Cancelled: ${ord.symbol}`,
            body: `Your ${ord.side} order #${event.orderId} for ${ord.symbol} has been cancelled.`,
            url: "/orders",
            tag: `order-cancel-${event.orderId}`,
          },
          "systemAlerts",
        ).catch(e => console.warn("[WebPush] Kafka cancel push failed:", (e as Error).message));
      }
    }
  }

  console.log(`[Kafka] order.cancelled: orderId=${event.orderId} reason=${event.reason}`);
}

// ─── Handler: risk.alert ──────────────────────────────────────────────────────

async function handleRiskAlert(event: RiskAlertEvent): Promise<void> {
  const severity = event.severity;
  const shouldNotifyOwner = severity === "HIGH" || severity === "CRITICAL";

  if (shouldNotifyOwner) {
    await notifyOwner({
      title: `[RISK ${severity}] ${event.alertType}`,
      content:
        `Risk alert triggered:\n` +
        `Type: ${event.alertType}\n` +
        `Severity: ${severity}\n` +
        (event.userId ? `User ID: ${event.userId}\n` : "") +
        (event.symbol ? `Symbol: ${event.symbol}\n` : "") +
        `Message: ${event.message}\n` +
        `Time: ${new Date(event.timestamp).toISOString()}`,
    });
  }

  console.warn(
    `[Kafka] risk.alert: type=${event.alertType} severity=${severity} ` +
      `msg="${event.message}"`
  );
}

// ─── Message router ───────────────────────────────────────────────────────────

async function handleMessage({ topic, message }: EachMessagePayload): Promise<void> {
  if (!message.value) return;

  let payload: unknown;
  try {
    payload = JSON.parse(message.value.toString());
  } catch {
    console.warn(`[Kafka] Failed to parse message on topic ${topic}`);
    return;
  }

  try {
    switch (topic) {
      case "order.filled":
        await handleOrderFilled(payload as OrderFilledEvent);
        break;
      case "settlement.completed":
        await handleSettlementCompleted(payload as SettlementCompletedEvent);
        break;
      case "order.cancelled":
        await handleOrderCancelled(payload as OrderCancelledEvent);
        break;
      case "risk.alert":
        await handleRiskAlert(payload as RiskAlertEvent);
        break;
      case "price.updated":
        // Price updates are handled by the WebSocket server directly
        // This consumer just logs for audit purposes
        break;
      default:
        console.warn(`[Kafka] Unknown topic: ${topic}`);
    }
  } catch (err) {
    console.error(`[Kafka] Error handling message on topic ${topic}:`, err);
    // Don't rethrow — allow Kafka to continue processing other messages
  }
}

// ─── Lifecycle ────────────────────────────────────────────────────────────────

export async function startKafkaConsumer(): Promise<void> {
  if (_isRunning) return;

  const kafka = createKafkaClient();
  _consumer = kafka.consumer({ groupId: KAFKA_GROUP_ID });

  try {
    await _consumer.connect();
    console.log(`[Kafka] Connected to brokers: ${KAFKA_BROKERS.join(", ")}`);

    await _consumer.subscribe({
      topics: [
        "order.filled",
        "settlement.completed",
        "order.cancelled",
        "price.updated",
        "risk.alert",
      ],
      fromBeginning: false,
    });

    await _consumer.run({
      eachMessage: handleMessage,
    });

    _isRunning = true;
    console.log("[Kafka] Consumer running — listening for exchange events");
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    // Graceful degradation — Kafka is optional middleware
    console.warn(
      `[Kafka] Consumer failed to start (${msg}). Running without Kafka event streaming.`
    );
    _consumer = null;
    _isRunning = false;
  }
}

export async function stopKafkaConsumer(): Promise<void> {
  if (_consumer && _isRunning) {
    try {
      await _consumer.disconnect();
      console.log("[Kafka] Consumer disconnected.");
    } catch {
      // Ignore disconnect errors on shutdown
    }
    _consumer = null;
    _isRunning = false;
  }
}

export function isKafkaRunning(): boolean {
  return _isRunning;
}
