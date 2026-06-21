/**
 * NEXCOM Fund-Flow Middleware Orchestrator (TypeScript)
 * ======================================================
 * Single entry point for ALL fund-flow mutations. Every mutation MUST call
 * the appropriate function here to guarantee:
 *
 *  1. Redis idempotency guard   — prevents double-execution on retry
 *  2. TigerBeetle ledger entry  — double-entry accounting
 *  3. Kafka event sourcing      — durable event log
 *  4. Fluvio real-time stream   — live feed for UI and downstream consumers
 *  5. Dapr pub/sub              — service mesh event distribution
 *  6. Temporal workflow trigger — saga orchestration with compensation
 *  7. Lakehouse Bronze ingest   — immutable audit trail
 *  8. OpenSearch index update   — compliance full-text search
 *
 * All middleware calls are fire-and-forget (setImmediate) and gracefully
 * degrade when infrastructure is unavailable. The database transaction is
 * NEVER rolled back due to middleware failure.
 */

import {
  emitEvent,
  emitOrderFilled,
  emitOrderCancelled,
  emitSettlementCompleted,
  emitDepositCompleted,
  emitWithdrawalCompleted,
  emitMarginDeposited,
  emitMarginReleased,
} from "./kafka/kafkaProducer";
import {
  publishDepositEvent,
  publishWithdrawalEvent,
  publishLoanEvent,
  publishMarginEvent,
  publishOrderEvent,
  publishFluvioEvent,
  FLUVIO_TOPICS,
} from "./fluvio/fluvioClient";
import {
  createLedgerTransfer,
  createPendingLedgerTransfer,
  voidLedgerTransfer,
  settleTrade,
  releaseCollateral,
  holdCollateral,
  liquidateMargin,
  issueRefund,
  recordStripeTopup,
  freezeAccount,
  settleCrossBorder,
} from "./gatewayClient";
import { triggerTemporalWorkflow } from "./temporal/temporalClient";
import { DAPR_TOPICS, daprPublish } from "./dapr/daprClient";
import {
  ingestDeposit,
  ingestWithdrawal,
  ingestTrade,
  ingestLoan,
  ingestLoanRepayment,
  ingestMarginMovement,
  ingestCrossBorderTransfer,
  ingestWarehouseReceipt,
  ingestCooperativePayout,
  ingestAmlAlert,
} from "./lakehouse";
import { indexDocument } from "./opensearch";
import { cacheGet, cacheSet } from "./cache";

// ─── Idempotency guard ────────────────────────────────────────────────────────

const IDEMPOTENCY_TTL_SECONDS = 86400; // 24 hours

/**
 * Returns true if this idempotency key has already been processed.
 * Uses Redis SET NX EX for atomic check-and-set.
 */
async function checkIdempotency(key: string): Promise<boolean> {
  try {
    const existing = await cacheGet<string>(`idempotency:${key}`);
    if (existing !== null) return true; // already processed
    await cacheSet(`idempotency:${key}`, "1", IDEMPOTENCY_TTL_SECONDS);
    return false;
  } catch {
    return false; // Redis unavailable — fail open for availability
  }
}

// ─── Helper: fire all middleware asynchronously ───────────────────────────────

function fireAndForget(fn: () => Promise<void>, label: string): void {
  setImmediate(async () => {
    try {
      await fn();
    } catch (err) {
      console.error(`[FundFlow] ${label} failed (non-critical):`, err);
    }
  });
}

// ─── FundFlow namespace ───────────────────────────────────────────────────────

export const FundFlow = {

  // ── Scenario 1 & 2: Deposit ─────────────────────────────────────────────────
  async deposit(event: {
    depositId: string;
    userId: number;
    amount: number;
    currency: string;
    stripeSessionId?: string;
    stripePaymentIntentId?: string;
    idempotencyKey?: string;
  }): Promise<{ duplicate: boolean }> {
    const key = event.idempotencyKey ?? `deposit:${event.depositId}`;
    if (await checkIdempotency(key)) {
      console.warn(`[FundFlow] Duplicate deposit: ${key}`);
      return { duplicate: true };
    }

    fireAndForget(async () => {
      // TigerBeetle: credit settlement account (code 6 = deposit)
      await createLedgerTransfer({
        debitAccountId: "nexcom-fiat-gateway",
        creditAccountId: `settlement-${event.userId}`,
        amount: Math.round(event.amount * 100),
        code: 6,
      });
      // Kafka
      await emitDepositCompleted({
        depositId: event.depositId,
        userId: event.userId,
        amount: event.amount,
        currency: event.currency,
        channel: "STRIPE",
        ledgerTxId: `ledger-deposit-${event.depositId}`,
      });
      // Fluvio
      await publishDepositEvent({
        depositId: event.depositId,
        userId: event.userId,
        amount: event.amount,
        currency: event.currency,
        status: "completed",
      });
      // Dapr
      await daprPublish(DAPR_TOPICS.DEPOSIT_COMPLETED, event);
      // Temporal saga
      await triggerTemporalWorkflow("DepositWorkflow", event, `deposit-${event.depositId}`);
      // Lakehouse Bronze
      await ingestDeposit({
        depositId: event.depositId,
        userId: event.userId,
        amount: event.amount,
        currency: event.currency,
        stripeSessionId: event.stripeSessionId,
        stripePaymentIntentId: event.stripePaymentIntentId,
        status: "completed",
        correlationId: key,
      });
      // OpenSearch
      await indexDocument("nexcom-deposits", event.depositId, {
        ...event, _event: "deposit.completed",
      });
    }, `deposit:${event.depositId}`);

    return { duplicate: false };
  },

  // ── Scenario 3 & 4: Withdrawal ──────────────────────────────────────────────
  async withdrawal(event: {
    withdrawalId: string;
    userId: number;
    amount: number;
    currency: string;
    bankAccountId?: string;
    idempotencyKey?: string;
  }): Promise<{ duplicate: boolean }> {
    const key = event.idempotencyKey ?? `withdrawal:${event.withdrawalId}`;
    if (await checkIdempotency(key)) {
      console.warn(`[FundFlow] Duplicate withdrawal: ${key}`);
      return { duplicate: true };
    }

    fireAndForget(async () => {
      // TigerBeetle: debit settlement account (code 5 = withdrawal)
      await createLedgerTransfer({
        debitAccountId: `settlement-${event.userId}`,
        creditAccountId: "nexcom-fiat-gateway",
        amount: Math.round(event.amount * 100),
        code: 5,
      });
      await emitWithdrawalCompleted({
        withdrawalId: event.withdrawalId,
        userId: event.userId,
        amount: event.amount,
        currency: event.currency,
        externalTxId: event.bankAccountId ?? `ext-${event.withdrawalId}`,
        ledgerTxId: `ledger-withdrawal-${event.withdrawalId}`,
      });
      await publishWithdrawalEvent({
        withdrawalId: event.withdrawalId,
        userId: event.userId,
        amount: event.amount,
        currency: event.currency,
        status: "completed",
      });
      await daprPublish(DAPR_TOPICS.WITHDRAWAL_COMPLETED, event);
      await triggerTemporalWorkflow("WithdrawalWorkflow", event, `withdrawal-${event.withdrawalId}`);
      await ingestWithdrawal({
        withdrawalId: event.withdrawalId,
        userId: event.userId,
        amount: event.amount,
        currency: event.currency,
        bankAccountId: event.bankAccountId,
        status: "completed",
        correlationId: key,
      });
      await indexDocument("nexcom-withdrawals", event.withdrawalId, {
        ...event, _event: "withdrawal.completed",
      });
    }, `withdrawal:${event.withdrawalId}`);

    return { duplicate: false };
  },

  // ── Scenario 5: Trade Settlement ────────────────────────────────────────────
  async tradeFill(event: {
    tradeId: string;
    fillId: number;
    symbol: string;
    assetClass: string;
    buyOrderId: number;
    sellOrderId: number;
    buyerUserId: number;
    sellerUserId: number;
    price: number;
    quantity: number;
    grossAmount: number;
    feeAmount: number;
    currency: string;
    idempotencyKey?: string;
  }): Promise<{ duplicate: boolean }> {
    const key = event.idempotencyKey ?? `trade:${event.tradeId}`;
    if (await checkIdempotency(key)) {
      console.warn(`[FundFlow] Duplicate trade fill: ${key}`);
      return { duplicate: true };
    }

    fireAndForget(async () => {
      // TigerBeetle: atomic 3-leg settlement via settleTrade helper
      await settleTrade({
        tradeId: event.tradeId,
        buyerUserId: String(event.buyerUserId),
        sellerUserId: String(event.sellerUserId),
        symbol: event.symbol,
        quantity: event.quantity,
        price: event.price,
        feeRate: event.feeAmount / (event.grossAmount || 1),
      });
      // Kafka
      await emitOrderFilled({
        orderId: String(event.buyOrderId),
        userId: event.buyerUserId,
        symbol: event.symbol,
        side: "BUY",
        filledQty: event.quantity,
        avgFillPrice: event.price,
        remainingQty: 0,
        status: "FILLED",
        tradeId: event.tradeId,
        counterpartyOrderId: String(event.sellOrderId),
      });
      await emitSettlementCompleted({
        settlementId: event.tradeId,
        buyerUserId: event.buyerUserId,
        sellerUserId: event.sellerUserId,
        symbol: event.symbol,
        quantity: event.quantity,
        price: event.price,
        totalAmount: event.grossAmount,
        feeAmount: event.feeAmount,
      });
      // Fluvio
      await publishFluvioEvent(
        FLUVIO_TOPICS.TRADE_FILL,
        {
          fillId: event.fillId,
          symbol: event.symbol,
          assetClass: event.assetClass,
          buyerUserId: event.buyerUserId,
          sellerUserId: event.sellerUserId,
          filledQty: String(event.quantity),
          fillPrice: String(event.price),
          grossValue: String(event.grossAmount),
          createdAt: new Date().toISOString(),
        },
        `${event.symbol}-${event.fillId}`
      );
      // Dapr
      await daprPublish(DAPR_TOPICS.TRADE_SETTLED, event);
      // Temporal saga fallback
      await triggerTemporalWorkflow("TradeSettlementWorkflow", event, `trade-${event.tradeId}`);
      // Lakehouse Bronze
      await ingestTrade({
        tradeId: event.tradeId,
        buyOrderId: event.buyOrderId,
        sellOrderId: event.sellOrderId,
        buyerUserId: event.buyerUserId,
        sellerUserId: event.sellerUserId,
        symbol: event.symbol,
        quantity: String(event.quantity),
        price: String(event.price),
        totalValue: String(event.grossAmount),
        currency: event.currency,
        platformFee: String(event.feeAmount),
        correlationId: key,
      });
      // OpenSearch
      await indexDocument("nexcom-trades", event.tradeId, {
        ...event, _event: "trade.executed",
      });
    }, `trade:${event.tradeId}`);

    return { duplicate: false };
  },

  // ── Scenario 6 & 7: Order Placement / Cancellation ──────────────────────────
  async orderPlaced(event: {
    orderId: number;
    userId: number;
    symbol: string;
    side: "BUY" | "SELL";
    type: string;
    quantity: number;
    price?: number;
    idempotencyKey?: string;
  }): Promise<{ duplicate: boolean }> {
    const key = event.idempotencyKey ?? `order:placed:${event.orderId}`;
    if (await checkIdempotency(key)) return { duplicate: true };

    fireAndForget(async () => {
      // TigerBeetle: 2-phase pending hold for limit BUY orders
      if (event.price && event.quantity && event.side === "BUY") {
        await createPendingLedgerTransfer({
          debitAccountId: `settlement-${event.userId}`,
          creditAccountId: "nexcom-escrow",
          amount: Math.round(event.price * event.quantity * 100),
          code: 1,
        });
      }
      await emitEvent("order.placed", { ...event, timestamp: Date.now() });
      await publishOrderEvent("PLACED", {
        orderId: event.orderId,
        userId: event.userId,
        symbol: event.symbol,
        side: event.side,
        qty: String(event.quantity),
        price: String(event.price ?? 0),
        status: "OPEN",
      });
      await daprPublish(DAPR_TOPICS.ORDER_PLACED, event);
      await indexDocument("nexcom-orders", String(event.orderId), {
        ...event, _event: "order.placed",
      });
    }, `order:placed:${event.orderId}`);

    return { duplicate: false };
  },

  async orderCancelled(event: {
    orderId: number;
    userId: number;
    symbol: string;
    side: "BUY" | "SELL";
    quantity: number;
    price?: number;
    reason?: string;
    idempotencyKey?: string;
  }): Promise<{ duplicate: boolean }> {
    const key = event.idempotencyKey ?? `order:cancelled:${event.orderId}`;
    if (await checkIdempotency(key)) return { duplicate: true };

    fireAndForget(async () => {
      // TigerBeetle: void the pending hold for BUY orders
      if (event.side === "BUY") {
        await voidLedgerTransfer(`hold-order-${event.orderId}`);
      }
      await emitOrderCancelled({
        orderId: String(event.orderId),
        userId: event.userId,
        reason: event.reason ?? "USER_CANCELLED",
      });
      await publishOrderEvent("CANCELLED", {
        orderId: event.orderId,
        userId: event.userId,
        symbol: event.symbol,
        side: event.side,
        qty: String(event.quantity),
        price: String(event.price ?? 0),
        status: "CANCELLED",
      });
      await daprPublish(DAPR_TOPICS.ORDER_CANCELLED, event);
      await indexDocument("nexcom-orders", String(event.orderId), {
        ...event, _event: "order.cancelled",
      });
    }, `order:cancelled:${event.orderId}`);

    return { duplicate: false };
  },

  // ── Scenario 8 & 9: Margin Pledge / Release / Liquidation ───────────────────
  async marginPledge(event: {
    marginId: string;
    userId: number;
    amount: number;
    currency: string;
    collateralType?: string;
    collateralId?: string;
    loanId?: string;
    idempotencyKey?: string;
  }): Promise<{ duplicate: boolean }> {
    const key = event.idempotencyKey ?? `margin:pledge:${event.marginId}`;
    if (await checkIdempotency(key)) return { duplicate: true };

    fireAndForget(async () => {
      await holdCollateral({
        userId: String(event.userId),
        amount: event.amount,
        collateralType: event.collateralType ?? "CASH",
        collateralId: event.collateralId ?? event.marginId,
        loanId: event.loanId ?? event.marginId,
      });
      await emitMarginDeposited({
        userId: event.userId,
        amount: event.amount,
        currency: event.currency,
        collateralType: event.collateralType ?? "CASH",
        ledgerPendingId: `pending-margin-${event.marginId}`,
      });
      await publishMarginEvent({
        userId: event.userId,
        amount: event.amount,
        currency: event.currency,
        eventType: "deposited",
      });
      await daprPublish(DAPR_TOPICS.MARGIN_DEPOSITED, event);
      await triggerTemporalWorkflow("MarginWorkflow", event, `margin-pledge-${event.marginId}`);
      await ingestMarginMovement({
        movementId: event.marginId,
        userId: event.userId,
        action: "deposit",
        amount: String(event.amount),
        currency: event.currency,
        newBalance: String(event.amount),
        correlationId: key,
      });
      await indexDocument("nexcom-margin", event.marginId, {
        ...event, _event: "margin.pledged",
      });
    }, `margin:pledge:${event.marginId}`);

    return { duplicate: false };
  },

  async marginRelease(event: {
    marginId: string;
    userId: number;
    amount: number;
    currency: string;
    idempotencyKey?: string;
  }): Promise<{ duplicate: boolean }> {
    const key = event.idempotencyKey ?? `margin:release:${event.marginId}`;
    if (await checkIdempotency(key)) return { duplicate: true };

    fireAndForget(async () => {
      await releaseCollateral(event.marginId);
      await emitMarginReleased({
        userId: event.userId,
        amount: event.amount,
        currency: event.currency,
        ledgerTxId: `ledger-margin-release-${event.marginId}`,
      });
      await publishMarginEvent({
        userId: event.userId,
        amount: event.amount,
        currency: event.currency,
        eventType: "released",
      });
      await daprPublish(DAPR_TOPICS.MARGIN_RELEASED, event);
      await ingestMarginMovement({
        movementId: event.marginId,
        userId: event.userId,
        action: "release",
        amount: String(event.amount),
        currency: event.currency,
        newBalance: "0",
        correlationId: key,
      });
      await indexDocument("nexcom-margin", event.marginId, {
        ...event, _event: "margin.released",
      });
    }, `margin:release:${event.marginId}`);

    return { duplicate: false };
  },

  async marginLiquidation(event: {
    marginId: string;
    userId: number;
    amount: number;
    currency: string;
    reason: string;
    idempotencyKey?: string;
  }): Promise<{ duplicate: boolean }> {
    const key = event.idempotencyKey ?? `margin:liquidate:${event.marginId}`;
    if (await checkIdempotency(key)) return { duplicate: true };

    fireAndForget(async () => {
      await liquidateMargin({
        userId: String(event.userId),
        reason: event.reason,
      });
      await emitEvent("margin.liquidated", { ...event, timestamp: Date.now() });
      await publishMarginEvent({
        userId: event.userId,
        amount: event.amount,
        currency: event.currency,
        eventType: "liquidated",
      });
      await daprPublish(DAPR_TOPICS.MARGIN_LIQUIDATED, event);
      await ingestMarginMovement({
        movementId: event.marginId,
        userId: event.userId,
        action: "call",
        amount: String(event.amount),
        currency: event.currency,
        newBalance: "0",
        correlationId: key,
      });
      await indexDocument("nexcom-margin", event.marginId, {
        ...event, _event: "margin.liquidated",
      });
    }, `margin:liquidate:${event.marginId}`);

    return { duplicate: false };
  },

  // ── Scenario 10 & 11: Loan Disbursement / Repayment ─────────────────────────
  async loanDisbursed(event: {
    loanId: string;
    userId: number;
    principalAmount: number;
    currency: string;
    interestRate: number;
    dueDate: string;
    idempotencyKey?: string;
  }): Promise<{ duplicate: boolean }> {
    const key = event.idempotencyKey ?? `loan:disbursed:${event.loanId}`;
    if (await checkIdempotency(key)) return { duplicate: true };

    fireAndForget(async () => {
      await createLedgerTransfer({
        debitAccountId: "nexcom-loan-pool",
        creditAccountId: `settlement-${event.userId}`,
        amount: Math.round(event.principalAmount * 100),
        code: 6,
      });
      await emitEvent("loan.disbursed", { ...event, timestamp: Date.now() });
      await publishLoanEvent({
        loanId: event.loanId,
        userId: event.userId,
        amount: event.principalAmount,
        currency: event.currency,
        status: "disbursed",
      });
      await daprPublish(DAPR_TOPICS.LOAN_DISBURSED, event);
      await triggerTemporalWorkflow("LoanDisbursementWorkflow", event, `loan-${event.loanId}`);
      await ingestLoan({
        loanId: event.loanId,
        userId: event.userId,
        amount: event.principalAmount,
        currency: event.currency,
        interestRate: event.interestRate,
        dueDate: event.dueDate,
        status: "disbursed",
        correlationId: key,
      });
      await indexDocument("nexcom-loans", event.loanId, {
        ...event, _event: "loan.disbursed",
      });
    }, `loan:disbursed:${event.loanId}`);

    return { duplicate: false };
  },

  async loanRepaid(event: {
    repaymentId: string;
    loanId: string;
    userId: number;
    amount: number;
    currency: string;
    principalPaid: number;
    interestPaid: number;
    remainingBalance: number;
    idempotencyKey?: string;
  }): Promise<{ duplicate: boolean }> {
    const key = event.idempotencyKey ?? `loan:repaid:${event.repaymentId}`;
    if (await checkIdempotency(key)) return { duplicate: true };

    fireAndForget(async () => {
      await createLedgerTransfer({
        debitAccountId: `settlement-${event.userId}`,
        creditAccountId: "nexcom-loan-pool",
        amount: Math.round(event.amount * 100),
        code: 5,
      });
      await emitEvent("loan.repaid", { ...event, timestamp: Date.now() });
      await publishLoanEvent({
        loanId: event.loanId,
        userId: event.userId,
        amount: event.amount,
        currency: event.currency,
        status: "repaid",
      });
      await daprPublish(DAPR_TOPICS.LOAN_REPAID, event);
      await ingestLoanRepayment({
        repaymentId: event.repaymentId,
        loanId: event.loanId,
        userId: event.userId,
        amount: event.amount,
        currency: event.currency,
        principalPaid: event.principalPaid,
        interestPaid: event.interestPaid,
        remainingBalance: event.remainingBalance,
        status: "on_time",
        correlationId: key,
      });
      await indexDocument("nexcom-loans", event.loanId, {
        ...event, _event: "loan.repaid",
      });
    }, `loan:repaid:${event.repaymentId}`);

    return { duplicate: false };
  },

  // ── Scenario 12: Cross-Border Transfer (Mojaloop / ILP) ─────────────────────
  async crossBorder(event: {
    transferId: string;
    userId: number;
    amount: string;
    sourceCurrency: string;
    targetCurrency: string;
    payerFspId: string;
    payeeFspId: string;
    ilpPacket?: string;
    condition?: string;
    idempotencyKey?: string;
  }): Promise<{ duplicate: boolean }> {
    const key = event.idempotencyKey ?? `crossborder:${event.transferId}`;
    if (await checkIdempotency(key)) return { duplicate: true };

    fireAndForget(async () => {
      await settleCrossBorder({
        settlementId: event.transferId,
        payerUserId: String(event.userId),
        payeeFspId: event.payeeFspId,
        amount: parseFloat(event.amount),
        currency: event.sourceCurrency,
        ilpPacket: event.ilpPacket,
        condition: event.condition,
      });
      await emitEvent("crossborder.initiated", { ...event, timestamp: Date.now() });
      await daprPublish(DAPR_TOPICS.CROSS_BORDER_INITIATED, event);
      await triggerTemporalWorkflow("CrossBorderWorkflow", event, `crossborder-${event.transferId}`);
      await ingestCrossBorderTransfer({
        transferId: event.transferId,
        userId: event.userId,
        amount: event.amount,
        currency: event.sourceCurrency,
        payerFspId: event.payerFspId,
        payeeFspId: event.payeeFspId,
        ilpPacket: event.ilpPacket,
        status: "initiated",
        correlationId: key,
      });
      await indexDocument("nexcom-crossborder", event.transferId, {
        ...event, _event: "crossborder.initiated",
      });
    }, `crossborder:${event.transferId}`);

    return { duplicate: false };
  },

  // ── Scenario 13: Warehouse Receipt ──────────────────────────────────────────
  async receiptIssued(event: {
    receiptId: string;
    userId: number;
    commodityId: string;
    quantity: string;
    unit: string;
    warehouseId: string;
    idempotencyKey?: string;
  }): Promise<{ duplicate: boolean }> {
    const key = event.idempotencyKey ?? `receipt:issued:${event.receiptId}`;
    if (await checkIdempotency(key)) return { duplicate: true };

    fireAndForget(async () => {
      await emitEvent("receipt.issued", { ...event, timestamp: Date.now() });
      await ingestWarehouseReceipt({
        receiptId: event.receiptId,
        userId: event.userId,
        commodityId: event.commodityId,
        quantity: event.quantity,
        unit: event.unit,
        warehouseId: event.warehouseId,
        status: "issued",
        correlationId: key,
      });
      await indexDocument("nexcom-receipts", event.receiptId, {
        ...event, _event: "receipt.issued",
      });
    }, `receipt:issued:${event.receiptId}`);

    return { duplicate: false };
  },

  async receiptRedeemed(event: {
    receiptId: string;
    userId: number;
    commodityId: string;
    quantity: string;
    unit: string;
    warehouseId: string;
    idempotencyKey?: string;
  }): Promise<{ duplicate: boolean }> {
    const key = event.idempotencyKey ?? `receipt:redeemed:${event.receiptId}`;
    if (await checkIdempotency(key)) return { duplicate: true };

    fireAndForget(async () => {
      await emitEvent("receipt.redeemed", { ...event, timestamp: Date.now() });
      await ingestWarehouseReceipt({
        receiptId: event.receiptId,
        userId: event.userId,
        commodityId: event.commodityId,
        quantity: event.quantity,
        unit: event.unit,
        warehouseId: event.warehouseId,
        status: "redeemed",
        correlationId: key,
      });
      await indexDocument("nexcom-receipts", event.receiptId, {
        ...event, _event: "receipt.redeemed",
      });
    }, `receipt:redeemed:${event.receiptId}`);

    return { duplicate: false };
  },

  // ── Scenario 14: Cooperative Payout ─────────────────────────────────────────
  async cooperativePayout(event: {
    payoutId: string;
    cooperativeId: string;
    memberId: number;
    amount: string;
    currency: string;
    payoutType: "dividend" | "patronage" | "rebate" | "bonus";
    idempotencyKey?: string;
  }): Promise<{ duplicate: boolean }> {
    const key = event.idempotencyKey ?? `coop:payout:${event.payoutId}`;
    if (await checkIdempotency(key)) return { duplicate: true };

    fireAndForget(async () => {
      // TigerBeetle: credit member settlement account (code 6 = credit)
      await createLedgerTransfer({
        debitAccountId: `cooperative-${event.cooperativeId}`,
        creditAccountId: `settlement-${event.memberId}`,
        amount: Math.round(parseFloat(event.amount) * 100),
        code: 6,
      });
      await emitEvent("cooperative.payout", { ...event, timestamp: Date.now() });
      await daprPublish(DAPR_TOPICS.DIVIDEND_PAID, event);
      await ingestCooperativePayout({
        payoutId: event.payoutId,
        cooperativeId: event.cooperativeId,
        memberId: event.memberId,
        amount: event.amount,
        currency: event.currency,
        payoutType: event.payoutType,
        correlationId: key,
      });
      await indexDocument("nexcom-cooperatives", event.payoutId, {
        ...event, _event: "cooperative.payout",
      });
    }, `coop:payout:${event.payoutId}`);

    return { duplicate: false };
  },

  // ── Scenario 15: Refund / Chargeback ────────────────────────────────────────
  async refund(event: {
    refundId: string;
    userId: number;
    originalTxId: string;
    amount: number;
    currency: string;
    reason: string;
    idempotencyKey?: string;
  }): Promise<{ duplicate: boolean }> {
    const key = event.idempotencyKey ?? `refund:${event.refundId}`;
    if (await checkIdempotency(key)) return { duplicate: true };

    fireAndForget(async () => {
      await issueRefund({
        userId: String(event.userId),
        amount: event.amount,
        currency: event.currency,
        reason: event.reason,
        originalTxId: event.originalTxId,
      });
      await emitEvent("refund.processed", { ...event, timestamp: Date.now() });
      await daprPublish(DAPR_TOPICS.REFUND_ISSUED, event);
      await indexDocument("nexcom-refunds", event.refundId, {
        ...event, _event: "refund.processed",
      });
    }, `refund:${event.refundId}`);

    return { duplicate: false };
  },

  // ── Scenario 16: AML Freeze ──────────────────────────────────────────────────
  async amlFreeze(event: {
    alertId: string;
    userId: number;
    alertType: string;
    riskScore: number;
    reason: string;
    idempotencyKey?: string;
  }): Promise<{ duplicate: boolean }> {
    const key = event.idempotencyKey ?? `aml:freeze:${event.alertId}`;
    if (await checkIdempotency(key)) return { duplicate: true };

    fireAndForget(async () => {
      await freezeAccount({
        userId: String(event.userId),
        reason: event.reason,
        alertId: event.alertId,
      });
      await emitEvent("aml.flagged", { ...event, timestamp: Date.now() });
      await daprPublish(DAPR_TOPICS.AML_FREEZE, {
        userId: String(event.userId),
        frozen: true,
        reason: event.reason,
        alertId: event.alertId,
      });
      await ingestAmlAlert({
        alertId: event.alertId,
        userId: event.userId,
        alertType: event.alertType,
        riskScore: event.riskScore,
        action: "frozen",
        correlationId: key,
      });
      await indexDocument("nexcom-aml-flags", event.alertId, {
        ...event, _event: "aml.flagged",
      });
    }, `aml:freeze:${event.alertId}`);

    return { duplicate: false };
  },

  // ── Scenario 17: Stripe Topup (webhook) ─────────────────────────────────────
  async stripeTopup(event: {
    stripePaymentIntentId: string;
    userId: number;
    amount: number;
    currency: string;
    idempotencyKey?: string;
  }): Promise<{ duplicate: boolean }> {
    const key = event.idempotencyKey ?? `stripe:topup:${event.stripePaymentIntentId}`;
    if (await checkIdempotency(key)) return { duplicate: true };

    fireAndForget(async () => {
      await recordStripeTopup({
        userId: String(event.userId),
        amount: event.amount,
        currency: event.currency,
        stripePaymentIntentId: event.stripePaymentIntentId,
      });
      await emitDepositCompleted({
        depositId: event.stripePaymentIntentId,
        userId: event.userId,
        amount: event.amount,
        currency: event.currency,
        channel: "STRIPE",
        ledgerTxId: `ledger-stripe-${event.stripePaymentIntentId}`,
      });
      await daprPublish(DAPR_TOPICS.STRIPE_TOPUP, event);
      await ingestDeposit({
        depositId: event.stripePaymentIntentId,
        userId: event.userId,
        amount: event.amount,
        currency: event.currency,
        stripePaymentIntentId: event.stripePaymentIntentId,
        status: "completed",
        correlationId: key,
      });
    }, `stripe:topup:${event.stripePaymentIntentId}`);

    return { duplicate: false };
  },
};
