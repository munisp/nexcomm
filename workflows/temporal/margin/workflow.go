// Package margin implements Temporal workflows for margin management:
//   - MarginPledgeWorkflow: lock collateral (TigerBeetle 2-phase pending)
//   - MarginReleaseWorkflow: release collateral (commit pending transfer)
//   - MarginLiquidationWorkflow: force-liquidate under-margined position
//
// All workflows are idempotent: workflow ID = "margin-{action}-{userId}-{idempotencyKey}"
package margin

import (
	"fmt"
	"time"

	"go.temporal.io/sdk/temporal"
	"go.temporal.io/sdk/workflow"
)

// ─── Pledge ──────────────────────────────────────────────────────────────────

type MarginPledgeInput struct {
	UserID         string  `json:"user_id"`
	Symbol         string  `json:"symbol"`
	Amount         float64 `json:"amount"`
	Currency       string  `json:"currency"`
	OrderID        string  `json:"order_id"`
	IdempotencyKey string  `json:"idempotency_key"`
}

type MarginPledgeResult struct {
	TransferID string `json:"transfer_id"`
	Status     string `json:"status"`
	PledgedAt  string `json:"pledged_at"`
}

func MarginPledgeWorkflow(ctx workflow.Context, input MarginPledgeInput) (*MarginPledgeResult, error) {
	logger := workflow.GetLogger(ctx)
	logger.Info("MarginPledgeWorkflow started", "userId", input.UserID, "amount", input.Amount)

	retryPolicy := &temporal.RetryPolicy{
		InitialInterval:        time.Second,
		BackoffCoefficient:     2.0,
		MaximumInterval:        20 * time.Second,
		MaximumAttempts:        3,
		NonRetryableErrorTypes: []string{"INSUFFICIENT_FUNDS", "ACCOUNT_FROZEN"},
	}
	actCtx := workflow.WithActivityOptions(ctx, workflow.ActivityOptions{
		StartToCloseTimeout: 20 * time.Second,
		RetryPolicy:         retryPolicy,
	})

	result := &MarginPledgeResult{}

	// Step 1: Check margin balance
	var sufficient bool
	if err := workflow.ExecuteActivity(actCtx, CheckMarginBalanceActivity, input).Get(actCtx, &sufficient); err != nil || !sufficient {
		_ = workflow.ExecuteActivity(actCtx, EmitMarginEventActivity, "margin.pledge.failed", input, "INSUFFICIENT_MARGIN").Get(actCtx, nil)
		return nil, temporal.NewNonRetryableApplicationError("INSUFFICIENT_FUNDS", "INSUFFICIENT_FUNDS", nil)
	}

	// Step 2: Create pending TigerBeetle transfer (code-2: margin hold)
	var transferID string
	if err := workflow.ExecuteActivity(actCtx, CreateMarginHoldActivity, input).Get(actCtx, &transferID); err != nil {
		_ = workflow.ExecuteActivity(actCtx, EmitMarginEventActivity, "margin.pledge.failed", input, err.Error()).Get(actCtx, nil)
		return nil, fmt.Errorf("margin hold failed: %w", err)
	}
	result.TransferID = transferID

	// Step 3: Emit Kafka + Fluvio + Lakehouse
	_ = workflow.ExecuteActivity(actCtx, EmitMarginEventActivity, "margin.pledged", input, transferID).Get(actCtx, nil)
	_ = workflow.ExecuteActivity(actCtx, IngestMarginToLakehouseActivity, "MARGIN_PLEDGED", input, transferID).Get(actCtx, nil)

	result.Status = "PLEDGED"
	result.PledgedAt = workflow.Now(ctx).UTC().Format(time.RFC3339)
	return result, nil
}

// ─── Release ─────────────────────────────────────────────────────────────────

type MarginReleaseInput struct {
	UserID         string  `json:"user_id"`
	TransferID     string  `json:"transfer_id"`
	Amount         float64 `json:"amount"`
	Currency       string  `json:"currency"`
	Reason         string  `json:"reason"` // "ORDER_CANCELLED" | "POSITION_CLOSED" | "MANUAL"
	IdempotencyKey string  `json:"idempotency_key"`
}

type MarginReleaseResult struct {
	Status     string `json:"status"`
	ReleasedAt string `json:"released_at"`
}

func MarginReleaseWorkflow(ctx workflow.Context, input MarginReleaseInput) (*MarginReleaseResult, error) {
	logger := workflow.GetLogger(ctx)
	logger.Info("MarginReleaseWorkflow started", "userId", input.UserID, "transferId", input.TransferID)

	actCtx := workflow.WithActivityOptions(ctx, workflow.ActivityOptions{
		StartToCloseTimeout: 20 * time.Second,
		RetryPolicy: &temporal.RetryPolicy{
			InitialInterval:    time.Second,
			BackoffCoefficient: 2.0,
			MaximumInterval:    20 * time.Second,
			MaximumAttempts:    5,
		},
	})

	// Commit the pending transfer (code-4: release hold)
	if err := workflow.ExecuteActivity(actCtx, CommitMarginReleaseActivity, input).Get(actCtx, nil); err != nil {
		_ = workflow.ExecuteActivity(actCtx, EmitMarginEventActivity, "margin.release.failed", input, err.Error()).Get(actCtx, nil)
		return nil, fmt.Errorf("margin release failed: %w", err)
	}

	_ = workflow.ExecuteActivity(actCtx, EmitMarginEventActivity, "margin.released", input, "").Get(actCtx, nil)
	_ = workflow.ExecuteActivity(actCtx, IngestMarginToLakehouseActivity, "MARGIN_RELEASED", input, input.TransferID).Get(actCtx, nil)

	return &MarginReleaseResult{Status: "RELEASED", ReleasedAt: workflow.Now(ctx).UTC().Format(time.RFC3339)}, nil
}

// ─── Liquidation ─────────────────────────────────────────────────────────────

type MarginLiquidationInput struct {
	UserID         string  `json:"user_id"`
	Symbol         string  `json:"symbol"`
	PositionSize   float64 `json:"position_size"`
	MarginBalance  float64 `json:"margin_balance"`
	MaintenanceReq float64 `json:"maintenance_requirement"`
	Currency       string  `json:"currency"`
	IdempotencyKey string  `json:"idempotency_key"`
}

type MarginLiquidationResult struct {
	LiquidatedOrders []string `json:"liquidated_orders"`
	RecoveredAmount  float64  `json:"recovered_amount"`
	Status           string   `json:"status"`
	LiquidatedAt     string   `json:"liquidated_at"`
}

func MarginLiquidationWorkflow(ctx workflow.Context, input MarginLiquidationInput) (*MarginLiquidationResult, error) {
	logger := workflow.GetLogger(ctx)
	logger.Warn("MarginLiquidationWorkflow started — FORCE LIQUIDATION", "userId", input.UserID)

	actCtx := workflow.WithActivityOptions(ctx, workflow.ActivityOptions{
		StartToCloseTimeout: 60 * time.Second,
		RetryPolicy: &temporal.RetryPolicy{
			InitialInterval:        time.Second,
			BackoffCoefficient:     2.0,
			MaximumInterval:        30 * time.Second,
			MaximumAttempts:        3,
			NonRetryableErrorTypes: []string{"NO_OPEN_POSITIONS"},
		},
	})

	result := &MarginLiquidationResult{}

	// Step 1: Cancel all open orders for user+symbol
	var cancelledOrders []string
	if err := workflow.ExecuteActivity(actCtx, CancelOpenOrdersActivity, input).Get(actCtx, &cancelledOrders); err != nil {
		return nil, fmt.Errorf("cancel open orders failed: %w", err)
	}
	result.LiquidatedOrders = cancelledOrders

	// Step 2: Freeze account (TigerBeetle code-11)
	if err := workflow.ExecuteActivity(actCtx, FreezeMarginAccountActivity, input).Get(actCtx, nil); err != nil {
		logger.Warn("Account freeze failed", "error", err)
	}

	// Step 3: Emit liquidation alert via Dapr + Kafka
	_ = workflow.ExecuteActivity(actCtx, EmitLiquidationAlertActivity, input, result).Get(actCtx, nil)

	// Step 4: Ingest to Lakehouse
	_ = workflow.ExecuteActivity(actCtx, IngestMarginToLakehouseActivity, "MARGIN_LIQUIDATION", input, "").Get(actCtx, nil)

	result.Status = "LIQUIDATED"
	result.LiquidatedAt = workflow.Now(ctx).UTC().Format(time.RFC3339)
	return result, nil
}
