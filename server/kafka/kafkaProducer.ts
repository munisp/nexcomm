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

// Silence KafkaJS internal logs when running against localhost (no broker).
// Set KAFKA_BROKERS to a real broker address to restore full logging.
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
    logLevel: IS_LOCAL_KAFKA ? logLevel.NOTHING : logLevel.WARN,
  });
}

export async function getKafkaProducer(): Promise<Producer | null> {
  if (_producer && _isConnected) return _producer;

  try {
    const kafka = createKafkaClient();
    _producer = kafka.producer({
      allowAutoTopicCreation: true,
      idempotent: true,
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

// ─── Deposit / Withdrawal event emitters ─────────────────────────────────────

export async function emitDepositInitiated(event: {
  depositId: string;
  userId: number;
  amount: number;
  currency: string;
  channel: string;
  reference: string;
}): Promise<void> {
  await emitEvent("nexcom.banking.deposit-initiated", { ...event, timestamp: Date.now() });
}

export async function emitDepositCompleted(event: {
  depositId: string;
  userId: number;
  amount: number;
  currency: string;
  channel: string;
  ledgerTxId: string;
}): Promise<void> {
  await emitEvent("nexcom.banking.deposit-completed", { ...event, timestamp: Date.now() });
}

export async function emitDepositFailed(event: {
  depositId: string;
  userId: number;
  amount: number;
  reason: string;
}): Promise<void> {
  await emitEvent("nexcom.banking.deposit-failed", { ...event, timestamp: Date.now() });
}

export async function emitWithdrawalInitiated(event: {
  withdrawalId: string;
  userId: number;
  amount: number;
  currency: string;
  channel: string;
  destination: string;
}): Promise<void> {
  await emitEvent("nexcom.banking.withdrawal-initiated", { ...event, timestamp: Date.now() });
}

export async function emitWithdrawalCompleted(event: {
  withdrawalId: string;
  userId: number;
  amount: number;
  currency: string;
  externalTxId: string;
  ledgerTxId: string;
}): Promise<void> {
  await emitEvent("nexcom.banking.withdrawal-completed", { ...event, timestamp: Date.now() });
}

export async function emitWithdrawalFailed(event: {
  withdrawalId: string;
  userId: number;
  amount: number;
  reason: string;
}): Promise<void> {
  await emitEvent("nexcom.banking.withdrawal-failed", { ...event, timestamp: Date.now() });
}

// ─── Margin event emitters ────────────────────────────────────────────────────

export async function emitMarginDeposited(event: {
  userId: number;
  amount: number;
  currency: string;
  collateralType: string;
  ledgerPendingId: string;
}): Promise<void> {
  await emitEvent("nexcom.margin.deposited", { ...event, timestamp: Date.now() });
}

export async function emitMarginReleased(event: {
  userId: number;
  amount: number;
  currency: string;
  ledgerTxId: string;
}): Promise<void> {
  await emitEvent("nexcom.margin.released", { ...event, timestamp: Date.now() });
}

export async function emitMarginCallTriggered(event: {
  userId: number;
  utilisationPct: number;
  reason: string;
  severity: string;
}): Promise<void> {
  await emitEvent("nexcom.margin.call-triggered", { ...event, timestamp: Date.now() });
}

export async function emitMarginLiquidated(event: {
  userId: number;
  positionsLiquidated: string[];
  recoveredAmount: number;
}): Promise<void> {
  await emitEvent("nexcom.margin.liquidated", { ...event, timestamp: Date.now() });
}

// ─── Loan event emitters ──────────────────────────────────────────────────────

export async function emitLoanDisbursed(event: {
  loanId: string;
  userId: number;
  amount: number;
  currency: string;
  tenorDays: number;
  ledgerTxId: string;
  externalTxId: string;
}): Promise<void> {
  await emitEvent("nexcom.banking.loan-disbursed", { ...event, timestamp: Date.now() });
}

export async function emitLoanRepaid(event: {
  loanId: string;
  userId: number;
  principalAmount: number;
  interestAmount: number;
  ledgerTxId: string;
}): Promise<void> {
  await emitEvent("nexcom.banking.loan-repaid", { ...event, timestamp: Date.now() });
}

export async function emitLoanDefaulted(event: {
  loanId: string;
  userId: number;
  outstandingAmount: number;
  daysOverdue: number;
}): Promise<void> {
  await emitEvent("nexcom.banking.loan-defaulted", { ...event, timestamp: Date.now() });
}

// ─── Trade / order event emitters ────────────────────────────────────────────

export async function emitOrderPlaced(event: {
  orderId: string;
  userId: number;
  symbol: string;
  side: string;
  orderType: string;
  quantity: number;
  price?: number;
}): Promise<void> {
  await emitEvent("nexcom.orders.placed", { ...event, timestamp: Date.now() });
}

export async function emitOrderAmended(event: {
  orderId: string;
  userId: number;
  symbol: string;
  newQuantity?: number;
  newPrice?: number;
}): Promise<void> {
  await emitEvent("nexcom.orders.amended", { ...event, timestamp: Date.now() });
}

export async function emitTradeFill(event: {
  tradeId: string;
  buyOrderId: string;
  sellOrderId: string;
  symbol: string;
  quantity: number;
  price: number;
  buyerUserId: number;
  sellerUserId: number;
  settlementDate: string;
}): Promise<void> {
  await emitEvent("nexcom.market.trade-fill", { ...event, timestamp: Date.now() });
}

// ─── Fee collection event emitters ───────────────────────────────────────────

export async function emitFeeCollected(event: {
  tradeId?: string;
  depositId?: string;
  userId: number;
  feeType: string; // "trading" | "deposit" | "withdrawal" | "loan_origination"
  feeAmount: number;
  currency: string;
  ledgerTxId: string;
}): Promise<void> {
  await emitEvent("nexcom.fees.collected", { ...event, timestamp: Date.now() });
}

// ─── KYC / AML event emitters ─────────────────────────────────────────────────

export async function emitKycStatusChanged(event: {
  userId: number;
  previousStatus: string;
  newStatus: string;
  reason?: string;
}): Promise<void> {
  await emitEvent("nexcom.kyc.status-changed", { ...event, timestamp: Date.now() });
}

export async function emitAmlAlertRaised(event: {
  userId: number;
  alertType: string;
  severity: string;
  amount?: number;
  currency?: string;
  description: string;
}): Promise<void> {
  await emitEvent("nexcom.aml.alert-raised", { ...event, timestamp: Date.now() });
}

// ─── Corporate actions event emitters ────────────────────────────────────────

export async function emitDividendPaid(event: {
  corporateActionId: string;
  symbol: string;
  dividendPerShare: number;
  currency: string;
  recordDate: string;
  paymentDate: string;
  totalPaid: number;
}): Promise<void> {
  await emitEvent("nexcom.corporate.dividend-paid", { ...event, timestamp: Date.now() });
}

export async function emitCouponPaid(event: {
  instrumentId: string;
  symbol: string;
  couponAmount: number;
  currency: string;
  paymentDate: string;
}): Promise<void> {
  await emitEvent("nexcom.corporate.coupon-paid", { ...event, timestamp: Date.now() });
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
