// Package trading implements Temporal workflows for the complete trading lifecycle.
// Orchestrates: order validation → risk check → matching → settlement → notification.
package trading

import (
	"fmt"
	"time"

	"go.temporal.io/sdk/temporal"
	"go.temporal.io/sdk/workflow"
)

// TradeOrderInput represents the input to start a trading workflow
type TradeOrderInput struct {
	OrderID       string  `json:"order_id"`
	UserID        string  `json:"user_id"`
	Symbol        string  `json:"symbol"`
	Side          string  `json:"side"`
	OrderType     string  `json:"order_type"`
	Quantity      float64 `json:"quantity"`
	Price         float64 `json:"price"`
	ClientOrderID string  `json:"client_order_id"`
}

// TradeResult represents the final result of a trading workflow
type TradeResult struct {
	OrderID      string    `json:"order_id"`
	Status       string    `json:"status"`
	FilledQty    float64   `json:"filled_qty"`
	AvgPrice     float64   `json:"avg_price"`
	Trades       []string  `json:"trade_ids"`
	SettlementID string    `json:"settlement_id,omitempty"`
	CompletedAt  time.Time `json:"completed_at"`
}

// OrderPlacementWorkflow orchestrates the full order lifecycle
func OrderPlacementWorkflow(ctx workflow.Context, input TradeOrderInput) (*TradeResult, error) {
	logger := workflow.GetLogger(ctx)
	logger.Info("Starting order placement workflow", "order_id", input.OrderID)

	// Retry policy for activities
	activityOpts := workflow.ActivityOptions{
		StartToCloseTimeout: 30 * time.Second,
		RetryPolicy: &temporal.RetryPolicy{
			InitialInterval:    time.Second,
			BackoffCoefficient: 2.0,
			MaximumInterval:    30 * time.Second,
			MaximumAttempts:    3,
		},
	}
	ctx = workflow.WithActivityOptions(ctx, activityOpts)

	// Step 1: Validate order parameters
	var validationResult ValidationResult
	err := workflow.ExecuteActivity(ctx, ValidateOrderActivity, input).Get(ctx, &validationResult)
	if err != nil {
		return nil, fmt.Errorf("order validation failed: %w", err)
	}
	if !validationResult.Valid {
		return &TradeResult{
			OrderID:     input.OrderID,
			Status:      "REJECTED",
			CompletedAt: workflow.Now(ctx),
		}, nil
	}

	// Step 2: Pre-trade risk check
	var riskResult RiskCheckResult
	err = workflow.ExecuteActivity(ctx, CheckRiskActivity, input).Get(ctx, &riskResult)
	if err != nil {
		return nil, fmt.Errorf("risk check failed: %w", err)
	}
	if !riskResult.Approved {
		return &TradeResult{
			OrderID:     input.OrderID,
			Status:      "REJECTED_RISK",
			CompletedAt: workflow.Now(ctx),
		}, nil
	}

	// Step 3: Submit to matching engine
	var matchResult MatchResult
	err = workflow.ExecuteActivity(ctx, SubmitToMatchingEngineActivity, input).Get(ctx, &matchResult)
	if err != nil {
		return nil, fmt.Errorf("matching engine submission failed: %w", err)
	}

	// Step 4: If trades executed, initiate settlement
	var settlementID string
	if len(matchResult.TradeIDs) > 0 {
		settlementOpts := workflow.ActivityOptions{
			StartToCloseTimeout: 5 * time.Minute,
			RetryPolicy: &temporal.RetryPolicy{
				InitialInterval:    2 * time.Second,
				BackoffCoefficient: 2.0,
				MaximumInterval:    time.Minute,
				MaximumAttempts:    5,
			},
		}
		settlementCtx := workflow.WithActivityOptions(ctx, settlementOpts)

		var settlementResult SettlementResult
		err = workflow.ExecuteActivity(settlementCtx, InitiateSettlementActivity, matchResult).Get(ctx, &settlementResult)
		if err != nil {
			logger.Error("Settlement initiation failed", "error", err)
			// Settlement failure doesn't cancel the trade - it goes to manual resolution
		} else {
			settlementID = settlementResult.SettlementID
		}
	}

	// Step 5: Send notification
	notifyErr := workflow.ExecuteActivity(ctx, SendTradeNotificationActivity, NotificationInput{
		UserID:  input.UserID,
		OrderID: input.OrderID,
		Status:  matchResult.Status,
		Trades:  matchResult.TradeIDs,
	}).Get(ctx, nil)
	if notifyErr != nil {
		logger.Warn("Notification failed", "error", notifyErr)
		// Non-critical: don't fail the workflow
	}

	return &TradeResult{
		OrderID:      input.OrderID,
		Status:       matchResult.Status,
		FilledQty:    matchResult.FilledQuantity,
		AvgPrice:     matchResult.AvgPrice,
		Trades:       matchResult.TradeIDs,
		SettlementID: settlementID,
		CompletedAt:  workflow.Now(ctx),
	}, nil
}

// --- Activity Types ---

type ValidationResult struct {
	Valid  bool   `json:"valid"`
	Reason string `json:"reason,omitempty"`
}

type RiskCheckResult struct {
	Approved       bool    `json:"approved"`
	Reason         string  `json:"reason,omitempty"`
	MarginRequired float64 `json:"margin_required"`
}

type MatchResult struct {
	Status         string   `json:"status"`
	FilledQuantity float64  `json:"filled_quantity"`
	AvgPrice       float64  `json:"avg_price"`
	TradeIDs       []string `json:"trade_ids"`
}

type SettlementResult struct {
	SettlementID string `json:"settlement_id"`
	Status       string `json:"status"`
}

type NotificationInput struct {
	UserID  string   `json:"user_id"`
	OrderID string   `json:"order_id"`
	Status  string   `json:"status"`
	Trades  []string `json:"trade_ids"`
}
