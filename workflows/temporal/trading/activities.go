package trading

import (
	"context"
	"fmt"

	"go.temporal.io/sdk/activity"
)

// ValidateOrderActivity validates order parameters
func ValidateOrderActivity(ctx context.Context, input TradeOrderInput) (*ValidationResult, error) {
	logger := activity.GetLogger(ctx)
	logger.Info("Validating order", "order_id", input.OrderID)

	// Validate required fields
	if input.Symbol == "" || input.UserID == "" {
		return &ValidationResult{Valid: false, Reason: "missing required fields"}, nil
	}
	if input.Quantity <= 0 {
		return &ValidationResult{Valid: false, Reason: "quantity must be positive"}, nil
	}
	if input.OrderType == "LIMIT" && input.Price <= 0 {
		return &ValidationResult{Valid: false, Reason: "limit orders require a positive price"}, nil
	}

	// In production: check symbol is active, market hours, min/max order size, etc.
	return &ValidationResult{Valid: true}, nil
}

// CheckRiskActivity performs pre-trade risk validation
func CheckRiskActivity(ctx context.Context, input TradeOrderInput) (*RiskCheckResult, error) {
	logger := activity.GetLogger(ctx)
	logger.Info("Checking risk", "order_id", input.OrderID, "user_id", input.UserID)

	// In production: Call risk-management service API
	// GET /api/v1/risk/check with order details
	// Check: position limits, margin availability, circuit breakers

	marginRequired := input.Quantity * input.Price * 0.10 // 10% margin
	return &RiskCheckResult{
		Approved:       true,
		MarginRequired: marginRequired,
	}, nil
}

// SubmitToMatchingEngineActivity submits the order to the matching engine
func SubmitToMatchingEngineActivity(ctx context.Context, input TradeOrderInput) (*MatchResult, error) {
	logger := activity.GetLogger(ctx)
	logger.Info("Submitting to matching engine", "order_id", input.OrderID)

	// In production: POST to trading-engine /api/v1/orders
	// The matching engine returns the order status and any resulting trades

	return &MatchResult{
		Status:         "OPEN",
		FilledQuantity: 0,
		AvgPrice:       0,
		TradeIDs:       []string{},
	}, nil
}

// InitiateSettlementActivity initiates settlement for executed trades
func InitiateSettlementActivity(ctx context.Context, matchResult MatchResult) (*SettlementResult, error) {
	logger := activity.GetLogger(ctx)
	logger.Info("Initiating settlement", "trades", len(matchResult.TradeIDs))

	if len(matchResult.TradeIDs) == 0 {
		return nil, fmt.Errorf("no trades to settle")
	}

	// In production: POST to settlement service /api/v1/settlement/initiate
	// Creates TigerBeetle ledger entries and Mojaloop transfer

	return &SettlementResult{
		SettlementID: "settlement-placeholder",
		Status:       "initiated",
	}, nil
}

// SendTradeNotificationActivity sends trade execution notifications
func SendTradeNotificationActivity(ctx context.Context, input NotificationInput) error {
	logger := activity.GetLogger(ctx)
	logger.Info("Sending notification", "user_id", input.UserID, "order_id", input.OrderID)

	// In production: POST to notification service /api/v1/notifications/send
	return nil
}
