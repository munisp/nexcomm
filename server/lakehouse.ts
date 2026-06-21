/**
 * NEXCOM Exchange — Lakehouse Ingest Helper
 * ─────────────────────────────────────────────────────────────────────────────
 * Provides typed, idempotent ingest functions for all 20 fund-flow scenarios.
 * Events are written to the Bronze layer via the Python Ingestion Engine
 * (port 8008), which streams them through Kafka → Delta Lake (Silver) →
 * Gold (aggregated analytics + ML feature store).
 *
 * Architecture:
 *   Node.js server  →  POST /api/v1/ingest/{table}  →  Python Ingestion Engine
 *                                                          ↓
 *                                                    Kafka topic (nexcom-*)
 *                                                          ↓
 *                                                    Bronze (raw Parquet)
 *                                                          ↓
 *                                                    Silver (Delta Lake, dedup)
 *                                                          ↓
 *                                                    Gold (aggregates, ML)
 *
 * All ingest calls are:
 *   - Non-blocking (fire-and-forget with error logging)
 *   - Idempotent (event_id deduplication in Silver layer)
 *   - Immutable (Delta Lake append-only, no updates/deletes)
 *   - Auditable (every fund-flow event has userId, timestamp, correlationId)
 *
 * Tables (Bronze layer):
 *   nexcom_deposits          — Stripe + manual deposit events
 *   nexcom_withdrawals       — Bank withdrawal events
 *   nexcom_orders            — Order create/amend/cancel/fill events
 *   nexcom_trades            — Trade execution records
 *   nexcom_settlements       — T+2 settlement records
 *   nexcom_margin_calls      — Margin call events
 *   nexcom_liquidations      — Forced liquidation records
 *   nexcom_loans             — Loan disbursement + repayment events
 *   nexcom_cross_border      — Mojaloop cross-border transfers
 *   nexcom_aml_alerts        — AML/KYC flag events
 *   nexcom_account_freezes   — Account freeze/unfreeze events
 *   nexcom_fee_collections   — Platform fee collection events
 *   nexcom_dividend_payouts  — Dividend distribution events
 *   nexcom_corporate_actions — Stock split, rights issue, etc.
 *   nexcom_warehouse_receipts — Commodity warehouse receipt events
 *   nexcom_escrow            — Escrow lock/release events
 *   nexcom_cooperative_payouts — Cooperative member payout events
 *   nexcom_audit_trail       — Generic audit trail (all other events)
 */

import { randomUUID } from "crypto";

const INGESTION_URL = process.env.INGESTION_ENGINE_URL ?? "http://localhost:8008";
const INGEST_TIMEOUT_MS = 5000; // Non-blocking: 5s timeout

// ─── Core ingest function ─────────────────────────────────────────────────────

async function ingestEvent(table: string, event: Record<string, unknown>): Promise<void> {
  const payload = {
    event_id: event.event_id ?? randomUUID(),
    ingested_at: new Date().toISOString(),
    source: "nexcom-exchange-node",
    ...event,
  };

  try {
    const res = await fetch(`${INGESTION_URL}/api/v1/ingest/${table}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(INGEST_TIMEOUT_MS),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.warn(`[Lakehouse] Ingest failed for ${table}: HTTP ${res.status} ${text}`);
    }
  } catch (err) {
    // Non-blocking: log but never throw — fund-flow must not fail due to Lakehouse unavailability
    console.warn(`[Lakehouse] Ingest error for ${table}:`, (err as Error).message);
  }
}

// ─── Scenario 1: Fiat Deposit via Stripe ─────────────────────────────────────

export async function ingestDeposit(event: {
  depositId: string;
  userId: number;
  amount: number;
  currency: string;
  stripePaymentIntentId?: string;
  stripeSessionId?: string;
  status: "pending" | "completed" | "failed" | "refunded";
  correlationId?: string;
}): Promise<void> {
  return ingestEvent("nexcom_deposits", {
    event_id: event.depositId,
    event_type: `deposit.${event.status}`,
    user_id: event.userId,
    amount: event.amount,
    currency: event.currency,
    stripe_payment_intent_id: event.stripePaymentIntentId,
    stripe_session_id: event.stripeSessionId,
    status: event.status,
    correlation_id: event.correlationId ?? event.depositId,
    timestamp: new Date().toISOString(),
  });
}

// ─── Scenario 2: Withdrawal ───────────────────────────────────────────────────

export async function ingestWithdrawal(event: {
  withdrawalId: string;
  userId: number;
  amount: number;
  currency: string;
  bankAccountId?: string;
  status: "pending" | "processing" | "completed" | "failed" | "reversed";
  correlationId?: string;
}): Promise<void> {
  return ingestEvent("nexcom_withdrawals", {
    event_id: event.withdrawalId,
    event_type: `withdrawal.${event.status}`,
    user_id: event.userId,
    amount: event.amount,
    currency: event.currency,
    bank_account_id: event.bankAccountId,
    status: event.status,
    correlation_id: event.correlationId ?? event.withdrawalId,
    timestamp: new Date().toISOString(),
  });
}

// ─── Scenario 3: Order Lifecycle ──────────────────────────────────────────────

export async function ingestOrder(event: {
  orderId: number;
  userId: number;
  symbol: string;
  side: "BUY" | "SELL";
  orderType: string;
  quantity: string;
  price?: string;
  status: "created" | "amended" | "cancelled" | "partially_filled" | "filled" | "expired";
  filledQty?: string;
  fillPrice?: string;
  correlationId?: string;
}): Promise<void> {
  return ingestEvent("nexcom_orders", {
    event_id: `order-${event.orderId}-${event.status}-${Date.now()}`,
    event_type: `order.${event.status}`,
    order_id: event.orderId,
    user_id: event.userId,
    symbol: event.symbol,
    side: event.side,
    order_type: event.orderType,
    quantity: event.quantity,
    price: event.price,
    status: event.status,
    filled_qty: event.filledQty,
    fill_price: event.fillPrice,
    correlation_id: event.correlationId ?? String(event.orderId),
    timestamp: new Date().toISOString(),
  });
}

// ─── Scenario 4: Trade Execution ──────────────────────────────────────────────

export async function ingestTrade(event: {
  tradeId: string;
  buyOrderId: number;
  sellOrderId: number;
  buyerUserId: number;
  sellerUserId: number;
  symbol: string;
  quantity: string;
  price: string;
  totalValue: string;
  currency: string;
  platformFee?: string;
  correlationId?: string;
}): Promise<void> {
  return ingestEvent("nexcom_trades", {
    event_id: event.tradeId,
    event_type: "trade.executed",
    trade_id: event.tradeId,
    buy_order_id: event.buyOrderId,
    sell_order_id: event.sellOrderId,
    buyer_user_id: event.buyerUserId,
    seller_user_id: event.sellerUserId,
    symbol: event.symbol,
    quantity: event.quantity,
    price: event.price,
    total_value: event.totalValue,
    currency: event.currency,
    platform_fee: event.platformFee,
    correlation_id: event.correlationId ?? event.tradeId,
    timestamp: new Date().toISOString(),
  });
}

// ─── Scenario 5: T+2 Settlement ───────────────────────────────────────────────

export async function ingestSettlement(event: {
  settlementId: string;
  tradeId: string;
  buyerUserId: number;
  sellerUserId: number;
  symbol: string;
  netAmount: string;
  currency: string;
  settlementDate: string;
  status: "pending" | "completed" | "failed";
  tigerBeetleTransferId?: string;
  correlationId?: string;
}): Promise<void> {
  return ingestEvent("nexcom_settlements", {
    event_id: event.settlementId,
    event_type: `settlement.${event.status}`,
    settlement_id: event.settlementId,
    trade_id: event.tradeId,
    buyer_user_id: event.buyerUserId,
    seller_user_id: event.sellerUserId,
    symbol: event.symbol,
    net_amount: event.netAmount,
    currency: event.currency,
    settlement_date: event.settlementDate,
    status: event.status,
    tigerbeetle_transfer_id: event.tigerBeetleTransferId,
    correlation_id: event.correlationId ?? event.settlementId,
    timestamp: new Date().toISOString(),
  });
}

// ─── Scenario 6: Margin Call ──────────────────────────────────────────────────

export async function ingestMarginCall(event: {
  alertId: string;
  userId: number;
  utilisationPct: number;
  marginBalance: number;
  requiredMargin: number;
  currency: string;
  status: "issued" | "resolved" | "escalated";
  correlationId?: string;
}): Promise<void> {
  return ingestEvent("nexcom_margin_calls", {
    event_id: event.alertId,
    event_type: `margin_call.${event.status}`,
    alert_id: event.alertId,
    user_id: event.userId,
    utilisation_pct: event.utilisationPct,
    margin_balance: event.marginBalance,
    required_margin: event.requiredMargin,
    currency: event.currency,
    status: event.status,
    correlation_id: event.correlationId ?? event.alertId,
    timestamp: new Date().toISOString(),
  });
}

// ─── Scenario 7: Forced Liquidation ──────────────────────────────────────────

export async function ingestLiquidation(event: {
  liquidationId: string;
  userId: number;
  symbol: string;
  quantity: string;
  liquidationPrice: string;
  proceeds: string;
  currency: string;
  tigerBeetleTransferId?: string;
  correlationId?: string;
}): Promise<void> {
  return ingestEvent("nexcom_liquidations", {
    event_id: event.liquidationId,
    event_type: "liquidation.executed",
    liquidation_id: event.liquidationId,
    user_id: event.userId,
    symbol: event.symbol,
    quantity: event.quantity,
    liquidation_price: event.liquidationPrice,
    proceeds: event.proceeds,
    currency: event.currency,
    tigerbeetle_transfer_id: event.tigerBeetleTransferId,
    correlation_id: event.correlationId ?? event.liquidationId,
    timestamp: new Date().toISOString(),
  });
}

// ─── Scenario 8: Loan Disbursement ───────────────────────────────────────────

export async function ingestLoan(event: {
  loanId: string;
  userId: number;
  amount: number;
  currency: string;
  interestRate: number;
  dueDate: string;
  status: "disbursed" | "repaid" | "overdue" | "defaulted" | "written_off";
  tigerBeetleTransferId?: string;
  correlationId?: string;
}): Promise<void> {
  return ingestEvent("nexcom_loans", {
    event_id: `${event.loanId}-${event.status}`,
    event_type: `loan.${event.status}`,
    loan_id: event.loanId,
    user_id: event.userId,
    amount: event.amount,
    currency: event.currency,
    interest_rate: event.interestRate,
    due_date: event.dueDate,
    status: event.status,
    tigerbeetle_transfer_id: event.tigerBeetleTransferId,
    correlation_id: event.correlationId ?? event.loanId,
    timestamp: new Date().toISOString(),
  });
}

// ─── Scenario 9: Cross-Border Transfer (Mojaloop) ────────────────────────────

export async function ingestCrossBorderTransfer(event: {
  transferId: string;
  userId: number;
  amount: string;
  currency: string;
  payerFspId: string;
  payeeFspId: string;
  ilpPacket?: string;
  status: "initiated" | "prepared" | "committed" | "aborted";
  tigerBeetleTransferId?: string;
  correlationId?: string;
}): Promise<void> {
  return ingestEvent("nexcom_cross_border", {
    event_id: `${event.transferId}-${event.status}`,
    event_type: `cross_border.${event.status}`,
    transfer_id: event.transferId,
    user_id: event.userId,
    amount: event.amount,
    currency: event.currency,
    payer_fsp_id: event.payerFspId,
    payee_fsp_id: event.payeeFspId,
    // Do NOT log ILP packet (contains sensitive routing info)
    has_ilp_packet: !!event.ilpPacket,
    status: event.status,
    tigerbeetle_transfer_id: event.tigerBeetleTransferId,
    correlation_id: event.correlationId ?? event.transferId,
    timestamp: new Date().toISOString(),
  });
}

// ─── Scenario 10: AML Alert ───────────────────────────────────────────────────

export async function ingestAmlAlert(event: {
  alertId: string;
  userId: number;
  alertType: string;
  riskScore: number;
  action: "flagged" | "frozen" | "cleared" | "reported";
  correlationId?: string;
}): Promise<void> {
  return ingestEvent("nexcom_aml_alerts", {
    event_id: `${event.alertId}-${event.action}`,
    event_type: `aml.${event.action}`,
    alert_id: event.alertId,
    user_id: event.userId,
    alert_type: event.alertType,
    risk_score: event.riskScore,
    action: event.action,
    correlation_id: event.correlationId ?? event.alertId,
    timestamp: new Date().toISOString(),
  });
}

// ─── Scenario 11: Account Freeze ─────────────────────────────────────────────

export async function ingestAccountFreeze(event: {
  userId: number;
  action: "frozen" | "unfrozen";
  reason: string;
  initiatedBy: "system" | "admin" | "aml" | "compliance";
  correlationId?: string;
}): Promise<void> {
  return ingestEvent("nexcom_account_freezes", {
    event_id: `freeze-${event.userId}-${Date.now()}`,
    event_type: `account.${event.action}`,
    user_id: event.userId,
    action: event.action,
    reason: event.reason,
    initiated_by: event.initiatedBy,
    correlation_id: event.correlationId ?? `freeze-${event.userId}`,
    timestamp: new Date().toISOString(),
  });
}

// ─── Scenario 12: Platform Fee Collection ────────────────────────────────────

export async function ingestFeeCollection(event: {
  feeId: string;
  userId: number;
  feeType: "trading" | "withdrawal" | "deposit" | "loan_origination" | "late_payment" | "warehouse";
  amount: string;
  currency: string;
  relatedEntityId: string;
  tigerBeetleTransferId?: string;
  correlationId?: string;
}): Promise<void> {
  return ingestEvent("nexcom_fee_collections", {
    event_id: event.feeId,
    event_type: `fee.collected.${event.feeType}`,
    fee_id: event.feeId,
    user_id: event.userId,
    fee_type: event.feeType,
    amount: event.amount,
    currency: event.currency,
    related_entity_id: event.relatedEntityId,
    tigerbeetle_transfer_id: event.tigerBeetleTransferId,
    correlation_id: event.correlationId ?? event.feeId,
    timestamp: new Date().toISOString(),
  });
}

// ─── Scenario 13: Dividend Payout ────────────────────────────────────────────

export async function ingestDividendPayout(event: {
  payoutId: string;
  userId: number;
  symbol: string;
  sharesHeld: string;
  dividendPerShare: string;
  totalPayout: string;
  currency: string;
  exDate: string;
  paymentDate: string;
  tigerBeetleTransferId?: string;
  correlationId?: string;
}): Promise<void> {
  return ingestEvent("nexcom_dividend_payouts", {
    event_id: event.payoutId,
    event_type: "dividend.paid",
    payout_id: event.payoutId,
    user_id: event.userId,
    symbol: event.symbol,
    shares_held: event.sharesHeld,
    dividend_per_share: event.dividendPerShare,
    total_payout: event.totalPayout,
    currency: event.currency,
    ex_date: event.exDate,
    payment_date: event.paymentDate,
    tigerbeetle_transfer_id: event.tigerBeetleTransferId,
    correlation_id: event.correlationId ?? event.payoutId,
    timestamp: new Date().toISOString(),
  });
}

// ─── Scenario 14: Corporate Action ───────────────────────────────────────────

export async function ingestCorporateAction(event: {
  actionId: string;
  symbol: string;
  actionType: "stock_split" | "rights_issue" | "bonus_issue" | "buyback" | "delisting" | "merger";
  ratio?: string;
  effectiveDate: string;
  affectedUserCount?: number;
  correlationId?: string;
}): Promise<void> {
  return ingestEvent("nexcom_corporate_actions", {
    event_id: event.actionId,
    event_type: `corporate_action.${event.actionType}`,
    action_id: event.actionId,
    symbol: event.symbol,
    action_type: event.actionType,
    ratio: event.ratio,
    effective_date: event.effectiveDate,
    affected_user_count: event.affectedUserCount,
    correlation_id: event.correlationId ?? event.actionId,
    timestamp: new Date().toISOString(),
  });
}

// ─── Scenario 15: Warehouse Receipt ──────────────────────────────────────────

export async function ingestWarehouseReceipt(event: {
  receiptId: string;
  userId: number;
  commodityId: string;
  quantity: string;
  unit: string;
  warehouseId: string;
  status: "issued" | "transferred" | "redeemed" | "cancelled";
  correlationId?: string;
}): Promise<void> {
  return ingestEvent("nexcom_warehouse_receipts", {
    event_id: `${event.receiptId}-${event.status}`,
    event_type: `warehouse_receipt.${event.status}`,
    receipt_id: event.receiptId,
    user_id: event.userId,
    commodity_id: event.commodityId,
    quantity: event.quantity,
    unit: event.unit,
    warehouse_id: event.warehouseId,
    status: event.status,
    correlation_id: event.correlationId ?? event.receiptId,
    timestamp: new Date().toISOString(),
  });
}

// ─── Scenario 16: Escrow ─────────────────────────────────────────────────────

export async function ingestEscrow(event: {
  escrowId: string;
  buyerUserId: number;
  sellerUserId: number;
  amount: string;
  currency: string;
  status: "locked" | "released" | "refunded" | "disputed";
  tigerBeetleTransferId?: string;
  correlationId?: string;
}): Promise<void> {
  return ingestEvent("nexcom_escrow", {
    event_id: `${event.escrowId}-${event.status}`,
    event_type: `escrow.${event.status}`,
    escrow_id: event.escrowId,
    buyer_user_id: event.buyerUserId,
    seller_user_id: event.sellerUserId,
    amount: event.amount,
    currency: event.currency,
    status: event.status,
    tigerbeetle_transfer_id: event.tigerBeetleTransferId,
    correlation_id: event.correlationId ?? event.escrowId,
    timestamp: new Date().toISOString(),
  });
}

// ─── Scenario 17: Cooperative Payout ─────────────────────────────────────────

export async function ingestCooperativePayout(event: {
  payoutId: string;
  cooperativeId: string;
  memberId: number;
  amount: string;
  currency: string;
  payoutType: "dividend" | "patronage" | "rebate" | "bonus";
  tigerBeetleTransferId?: string;
  correlationId?: string;
}): Promise<void> {
  return ingestEvent("nexcom_cooperative_payouts", {
    event_id: event.payoutId,
    event_type: `cooperative_payout.${event.payoutType}`,
    payout_id: event.payoutId,
    cooperative_id: event.cooperativeId,
    member_id: event.memberId,
    amount: event.amount,
    currency: event.currency,
    payout_type: event.payoutType,
    tigerbeetle_transfer_id: event.tigerBeetleTransferId,
    correlation_id: event.correlationId ?? event.payoutId,
    timestamp: new Date().toISOString(),
  });
}

// ─── Scenario 18: Margin Deposit / Release ───────────────────────────────────

export async function ingestMarginMovement(event: {
  movementId: string;
  userId: number;
  action: "deposit" | "release" | "call" | "top_up";
  amount: string;
  currency: string;
  newBalance: string;
  tigerBeetleTransferId?: string;
  correlationId?: string;
}): Promise<void> {
  return ingestEvent("nexcom_margin_movements", {
    event_id: event.movementId,
    event_type: `margin.${event.action}`,
    movement_id: event.movementId,
    user_id: event.userId,
    action: event.action,
    amount: event.amount,
    currency: event.currency,
    new_balance: event.newBalance,
    tigerbeetle_transfer_id: event.tigerBeetleTransferId,
    correlation_id: event.correlationId ?? event.movementId,
    timestamp: new Date().toISOString(),
  });
}

// ─── Scenario 19: Loan Repayment ─────────────────────────────────────────────

export async function ingestLoanRepayment(event: {
  repaymentId: string;
  loanId: string;
  userId: number;
  amount: number;
  currency: string;
  principalPaid: number;
  interestPaid: number;
  remainingBalance: number;
  status: "on_time" | "late" | "partial";
  tigerBeetleTransferId?: string;
  correlationId?: string;
}): Promise<void> {
  return ingestEvent("nexcom_loan_repayments", {
    event_id: event.repaymentId,
    event_type: `loan_repayment.${event.status}`,
    repayment_id: event.repaymentId,
    loan_id: event.loanId,
    user_id: event.userId,
    amount: event.amount,
    currency: event.currency,
    principal_paid: event.principalPaid,
    interest_paid: event.interestPaid,
    remaining_balance: event.remainingBalance,
    status: event.status,
    tigerbeetle_transfer_id: event.tigerBeetleTransferId,
    correlation_id: event.correlationId ?? event.repaymentId,
    timestamp: new Date().toISOString(),
  });
}

// ─── Scenario 20: Generic Audit Trail ────────────────────────────────────────

export async function ingestAuditEvent(event: {
  userId: number;
  action: string;
  resource: string;
  resourceId: string;
  details?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
  correlationId?: string;
}): Promise<void> {
  return ingestEvent("nexcom_audit_trail", {
    event_id: randomUUID(),
    event_type: `audit.${event.action}`,
    user_id: event.userId,
    action: event.action,
    resource: event.resource,
    resource_id: event.resourceId,
    details: event.details,
    ip_address: event.ipAddress,
    user_agent: event.userAgent,
    correlation_id: event.correlationId ?? `audit-${event.userId}-${Date.now()}`,
    timestamp: new Date().toISOString(),
  });
}
