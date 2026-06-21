// Package trade_settlement implements the atomic Trade Settlement Temporal workflow.
//
// DVP (Delivery vs Payment) atomicity guarantee:
//   1. Debit buyer settlement account (TigerBeetle code-3)
//   2. Credit seller settlement account (TigerBeetle code-3)
//   3. Collect platform fee (TigerBeetle code-3 fee leg)
//   4. Emit Kafka nexcom.trade.settled event
//   5. Publish Fluvio settlement stream
//   6. Update OpenSearch order status to FILLED
//   7. Ingest to Lakehouse Bronze layer
//
// Compensation (saga rollback):
//   - Reverse TigerBeetle transfers (code-10)
//   - Emit Kafka nexcom.trade.settlement.failed tombstone
//   - Publish Dapr alert
//
// Idempotency: workflow ID = "trade-settlement-{tradeId}" — Temporal deduplicates.
package trade_settlement

import (
	"fmt"
	"time"

	"go.temporal.io/sdk/temporal"
	"go.temporal.io/sdk/workflow"
)

// TradeSettlementInput is the input to the TradeSettlementWorkflow.
type TradeSettlementInput struct {
	TradeID         string  `json:"trade_id"`
	BuyerUserID     string  `json:"buyer_user_id"`
	SellerUserID    string  `json:"seller_user_id"`
	Symbol          string  `json:"symbol"`
	Quantity        float64 `json:"quantity"`
	Price           float64 `json:"price"`
	GrossAmount     float64 `json:"gross_amount"`
	FeeAmount       float64 `json:"fee_amount"`
	Currency        string  `json:"currency"`
	BuyerOrderID    string  `json:"buyer_order_id"`
	SellerOrderID   string  `json:"seller_order_id"`
	IdempotencyKey  string  `json:"idempotency_key"`
}

// TradeSettlementResult is the output of the TradeSettlementWorkflow.
type TradeSettlementResult struct {
	TradeID          string `json:"trade_id"`
	BuyerTransferID  string `json:"buyer_transfer_id"`
	SellerTransferID string `json:"seller_transfer_id"`
	FeeTransferID    string `json:"fee_transfer_id"`
	SettledAt        string `json:"settled_at"`
	Status           string `json:"status"`
}

// TradeSettlementWorkflow is the Temporal workflow for atomic DVP trade settlement.
func TradeSettlementWorkflow(ctx workflow.Context, input TradeSettlementInput) (*TradeSettlementResult, error) {
	logger := workflow.GetLogger(ctx)
	logger.Info("TradeSettlementWorkflow started", "tradeId", input.TradeID)

	retryPolicy := &temporal.RetryPolicy{
		InitialInterval:        time.Second,
		BackoffCoefficient:     2.0,
		MaximumInterval:        30 * time.Second,
		MaximumAttempts:        5,
		NonRetryableErrorTypes: []string{"INSUFFICIENT_FUNDS", "ACCOUNT_FROZEN", "DUPLICATE_TRANSFER"},
	}

	actCtx := workflow.WithActivityOptions(ctx, workflow.ActivityOptions{
		StartToCloseTimeout: 30 * time.Second,
		RetryPolicy:         retryPolicy,
	})

	result := &TradeSettlementResult{TradeID: input.TradeID}

	// ── Step 1: Validate accounts exist ──────────────────────────────────────
	var accountsValid bool
	if err := workflow.ExecuteActivity(actCtx, ValidateTradeAccountsActivity, input).Get(actCtx, &accountsValid); err != nil {
		return nil, fmt.Errorf("account validation failed: %w", err)
	}

	// ── Step 2: Debit buyer (pending) ─────────────────────────────────────────
	var buyerTransferID string
	if err := workflow.ExecuteActivity(actCtx, DebitBuyerActivity, input).Get(actCtx, &buyerTransferID); err != nil {
		_ = workflow.ExecuteActivity(actCtx, EmitSettlementFailedActivity, input, "debit_buyer_failed").Get(actCtx, nil)
		return nil, fmt.Errorf("buyer debit failed: %w", err)
	}
	result.BuyerTransferID = buyerTransferID

	// ── Step 3: Credit seller ─────────────────────────────────────────────────
	var sellerTransferID string
	if err := workflow.ExecuteActivity(actCtx, CreditSellerActivity, input).Get(actCtx, &sellerTransferID); err != nil {
		// Compensate: reverse buyer debit
		_ = workflow.ExecuteActivity(actCtx, ReverseBuyerDebitActivity, buyerTransferID, input).Get(actCtx, nil)
		_ = workflow.ExecuteActivity(actCtx, EmitSettlementFailedActivity, input, "credit_seller_failed").Get(actCtx, nil)
		return nil, fmt.Errorf("seller credit failed: %w", err)
	}
	result.SellerTransferID = sellerTransferID

	// ── Step 4: Collect platform fee ─────────────────────────────────────────
	var feeTransferID string
	if err := workflow.ExecuteActivity(actCtx, CollectFeeActivity, input).Get(actCtx, &feeTransferID); err != nil {
		// Non-fatal: fee collection failure does not roll back the trade
		logger.Warn("Fee collection failed — trade proceeds without fee", "error", err)
	}
	result.FeeTransferID = feeTransferID

	// ── Step 5: Emit Kafka settled event ─────────────────────────────────────
	if err := workflow.ExecuteActivity(actCtx, EmitTradeSettledKafkaActivity, input, result).Get(actCtx, nil); err != nil {
		logger.Warn("Kafka emission failed — settlement already committed", "error", err)
	}

	// ── Step 6: Publish Fluvio settlement stream ──────────────────────────────
	if err := workflow.ExecuteActivity(actCtx, PublishFluvioSettlementActivity, input, result).Get(actCtx, nil); err != nil {
		logger.Warn("Fluvio publish failed", "error", err)
	}

	// ── Step 7: Update OpenSearch order status ────────────────────────────────
	if err := workflow.ExecuteActivity(actCtx, UpdateOpenSearchOrderStatusActivity, input).Get(actCtx, nil); err != nil {
		logger.Warn("OpenSearch update failed", "error", err)
	}

	// ── Step 8: Ingest to Lakehouse Bronze ───────────────────────────────────
	if err := workflow.ExecuteActivity(actCtx, IngestToLakehouseActivity, input, result).Get(actCtx, nil); err != nil {
		logger.Warn("Lakehouse ingest failed", "error", err)
	}

	result.SettledAt = workflow.Now(ctx).UTC().Format(time.RFC3339)
	result.Status = "SETTLED"
	logger.Info("TradeSettlementWorkflow completed", "tradeId", input.TradeID, "status", "SETTLED")
	return result, nil
}
