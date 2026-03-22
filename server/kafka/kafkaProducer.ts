/**
 * kafkaProducer.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Kafka producer for NEXCOM Exchange — emits exchange events to Kafka topics.
 *
 * Used by:
 *   - orders router: emit order.filled, order.cancelled after matching
 *   - settlement job: emit settlement.completed after T+2 settlement
 *   - risk engine: emit risk.alert on threshold breaches
 *   - mojaloop router / settlement job: emit mojaloop.transfer.* events
 *
 * Gracefully degrades if Kafka is unavailable.
 */

import { Kafka, Producer, logLevel } from "kafkajs";

const KAFKA_BROKERS = (process.env.KAFKA_BROKERS ?? "localhost:9092").split(",");
const KAFKA_CLIENT_ID = "nexcom-portal-producer";

let _producer: Producer | null = null;
let _isConnected = false;

function createKafkaClient() {
  return new Kafka({
    clientId: KAFKA_CLIENT_ID,
    brokers: KAFKA_BROKERS,
    connectionTimeout: 3000,
    requestTimeout: 5000,
    retry: {
      initialRetryTime: 1000,
      retries: 2,
    },
    logLevel: logLevel.WARN,
  });
}

export async function getKafkaProducer(): Promise<Producer | null> {
  if (_producer && _isConnected) return _producer;

  try {
    const kafka = createKafkaClient();
    _producer = kafka.producer({
      allowAutoTopicCreation: true,
      idempotent: false,
    });
    await _producer.connect();
    _isConnected = true;
    console.log(`[Kafka] Producer connected to brokers: ${KAFKA_BROKERS.join(", ")}`);
    return _producer;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[Kafka] Producer failed to connect (${msg}). Events will not be streamed.`);
    _producer = null;
    _isConnected = false;
    return null;
  }
}

export async function emitEvent(topic: string, payload: unknown): Promise<void> {
  const producer = await getKafkaProducer();
  if (!producer) return; // Graceful degradation

  try {
    await producer.send({
      topic,
      messages: [
        {
          value: JSON.stringify(payload),
          timestamp: String(Date.now()),
        },
      ],
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[Kafka] Failed to emit event to ${topic}: ${msg}`);
    // Reset connection on error so next call retries
    _isConnected = false;
    _producer = null;
  }
}

// ─── Exchange event emitters ──────────────────────────────────────────────────

export async function emitOrderFilled(event: {
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
}): Promise<void> {
  await emitEvent("order.filled", { ...event, timestamp: Date.now() });
}

export async function emitOrderCancelled(event: {
  orderId: string;
  userId: number;
  reason: string;
}): Promise<void> {
  await emitEvent("order.cancelled", { ...event, timestamp: Date.now() });
}

export async function emitSettlementCompleted(event: {
  settlementId: string;
  buyerUserId: number;
  sellerUserId: number;
  symbol: string;
  quantity: number;
  price: number;
  totalAmount: number;
  feeAmount: number;
  tigerBeetleTransferId?: string;
}): Promise<void> {
  await emitEvent("settlement.completed", { ...event, timestamp: Date.now() });
}

export async function emitRiskAlert(event: {
  alertType: "MARGIN_CALL" | "POSITION_LIMIT" | "CIRCUIT_BREAKER" | "CONCENTRATION_RISK";
  userId?: number;
  symbol?: string;
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  message: string;
}): Promise<void> {
  await emitEvent("risk.alert", { ...event, timestamp: Date.now() });
}

export async function emitPriceUpdated(event: {
  symbol: string;
  price: number;
  change: number;
  changePercent: number;
  volume: number;
}): Promise<void> {
  await emitEvent("price.updated", { ...event, timestamp: Date.now() });
}

// ─── Mojaloop interop event emitters ─────────────────────────────────────────
// These events flow through the Kafka pipeline into the ingestion-engine
// Bronze layer (mojaloop/transfers and mojaloop/quotes Delta Lake tables)
// and are consumed by kafkaConsumer.ts for settlement reconciliation.

/**
 * Emitted when a Mojaloop interop transfer is initiated (cross-DFSP settlement).
 * Consumed by: ingestion-engine Bronze layer (mojaloop/transfers table).
 */
export async function emitMojaloopTransferInitiated(event: {
  transferId: string;
  settlementId?: string;
  payerFspId: string;
  payeeFspId: string;
  amount: number;
  currency: string;
  condition?: string;
  ilpPacket?: string;
}): Promise<void> {
  await emitEvent("mojaloop.transfer.initiated", { ...event, timestamp: Date.now() });
}

/**
 * Emitted when a Mojaloop transfer reaches COMMITTED state (fulfil callback received).
 * Consumed by: ingestion-engine Bronze layer + kafkaConsumer for settlement reconciliation.
 */
export async function emitMojaloopTransferCommitted(event: {
  transferId: string;
  settlementId?: string;
  payerFspId: string;
  payeeFspId: string;
  amount: number;
  currency: string;
  fulfilment?: string;
  committedAt: number;
}): Promise<void> {
  await emitEvent("mojaloop.transfer.committed", { ...event, timestamp: Date.now() });
}

/**
 * Emitted when a Mojaloop transfer is aborted (error callback received from hub).
 * Consumed by: ingestion-engine Bronze layer + kafkaConsumer for settlement retry logic.
 */
export async function emitMojaloopTransferAborted(event: {
  transferId: string;
  settlementId?: string;
  errorCode: string;
  errorDescription: string;
}): Promise<void> {
  await emitEvent("mojaloop.transfer.aborted", { ...event, timestamp: Date.now() });
}

/**
 * Emitted when a Mojaloop quote is accepted (quote callback received from hub).
 * Consumed by: ingestion-engine Bronze layer (mojaloop/quotes table).
 */
export async function emitMojaloopQuoteAccepted(event: {
  quoteId: string;
  transferId?: string;
  payerFspId: string;
  payeeFspId: string;
  transferAmount: number;
  currency: string;
  payeeFspFee?: number;
  ilpPacket?: string;
  condition?: string;
}): Promise<void> {
  await emitEvent("mojaloop.quote.accepted", { ...event, timestamp: Date.now() });
}

export async function disconnectKafkaProducer(): Promise<void> {
  if (_producer && _isConnected) {
    try {
      await _producer.disconnect();
      console.log("[Kafka] Producer disconnected.");
    } catch {
      // Ignore disconnect errors on shutdown
    }
    _producer = null;
    _isConnected = false;
  }
}
