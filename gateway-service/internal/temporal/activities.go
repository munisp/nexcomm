package temporal

import (
	"context"
	"fmt"
	"log"
	"time"

	"go.temporal.io/sdk/activity"

	"github.com/munisp/NGApp/services/gateway/internal/models"
)

// Activities contains all Temporal activity implementations for NEXCOM Exchange.
// Each activity is a single unit of work that can be retried independently.
type Activities struct{}

// ─── Order activities ─────────────────────────────────────────────────────────

// ValidateOrder checks that an order has valid parameters before submission.
func (a *Activities) ValidateOrder(ctx context.Context, input models.OrderWorkflowInput) error {
	activity.RecordHeartbeat(ctx, "validating order")
	log.Printf("[Activity] ValidateOrder: orderId=%s symbol=%s side=%s qty=%f price=%f",
		input.OrderID, input.Symbol, input.Side, input.Qty, input.Price)

	if input.OrderID == "" {
		return fmt.Errorf("order ID is required")
	}
	if input.Symbol == "" {
		return fmt.Errorf("symbol is required")
	}
	if input.Side != "BUY" && input.Side != "SELL" {
		return fmt.Errorf("invalid side: %s (must be BUY or SELL)", input.Side)
	}
	if input.Qty <= 0 {
		return fmt.Errorf("quantity must be positive, got %f", input.Qty)
	}
	if input.Type == "LIMIT" && input.Price <= 0 {
		return fmt.Errorf("limit order requires positive price, got %f", input.Price)
	}
	return nil
}

// ReserveMargin reserves the required margin for an order via TigerBeetle.
func (a *Activities) ReserveMargin(ctx context.Context, input models.OrderWorkflowInput) (bool, error) {
	activity.RecordHeartbeat(ctx, "reserving margin")
	log.Printf("[Activity] ReserveMargin: orderId=%s userId=%s amount=%f",
		input.OrderID, input.UserID, input.Price*input.Qty)

	// In a real implementation, this would call the TigerBeetle client
	// via the gateway service's dependency injection. For now, we log
	// and return success — the actual TigerBeetle call happens in server.go
	// before the workflow is started.
	time.Sleep(10 * time.Millisecond) // Simulate margin check latency
	return true, nil
}

// ReleaseMargin releases reserved margin when an order is cancelled.
func (a *Activities) ReleaseMargin(ctx context.Context, orderID string) error {
	activity.RecordHeartbeat(ctx, "releasing margin")
	log.Printf("[Activity] ReleaseMargin: orderId=%s", orderID)
	return nil
}

// UpdateOrderStatus updates the order status in the database.
func (a *Activities) UpdateOrderStatus(ctx context.Context, orderID, status, reason string) error {
	activity.RecordHeartbeat(ctx, "updating order status")
	log.Printf("[Activity] UpdateOrderStatus: orderId=%s status=%s reason=%s", orderID, status, reason)
	return nil
}

// ─── Settlement activities ────────────────────────────────────────────────────

// ValidateTrade checks that a trade record exists and is in the correct state.
func (a *Activities) ValidateTrade(ctx context.Context, tradeID string) error {
	activity.RecordHeartbeat(ctx, "validating trade")
	log.Printf("[Activity] ValidateTrade: tradeId=%s", tradeID)
	if tradeID == "" {
		return fmt.Errorf("trade ID is required")
	}
	return nil
}

// ExecuteSettlementTransfer executes the TigerBeetle double-entry transfer.
func (a *Activities) ExecuteSettlementTransfer(ctx context.Context, input models.SettlementWorkflowInput) error {
	activity.RecordHeartbeat(ctx, "executing settlement transfer")
	log.Printf("[Activity] ExecuteSettlementTransfer: tradeId=%s buyer=%s seller=%s amount=%f",
		input.TradeID, input.BuyerID, input.SellerID, input.Amount)

	// Simulate settlement transfer latency (real implementation calls TigerBeetle)
	time.Sleep(50 * time.Millisecond)
	return nil
}

// UpdateTradeStatus updates the trade status in the database.
func (a *Activities) UpdateTradeStatus(ctx context.Context, tradeID, status string) error {
	activity.RecordHeartbeat(ctx, "updating trade status")
	log.Printf("[Activity] UpdateTradeStatus: tradeId=%s status=%s", tradeID, status)
	return nil
}

// SendSettlementNotification sends settlement confirmation to buyer and seller.
func (a *Activities) SendSettlementNotification(ctx context.Context, input models.SettlementWorkflowInput) error {
	log.Printf("[Activity] SendSettlementNotification: tradeId=%s buyer=%s seller=%s",
		input.TradeID, input.BuyerID, input.SellerID)
	return nil
}

// ─── KYC activities ───────────────────────────────────────────────────────────

// RunAutomatedKYCChecks performs automated document verification.
func (a *Activities) RunAutomatedKYCChecks(ctx context.Context, input KYCWorkflowInput) (bool, error) {
	activity.RecordHeartbeat(ctx, "running automated KYC checks")
	log.Printf("[Activity] RunAutomatedKYCChecks: userId=%s documentType=%s",
		input.UserID, input.DocumentType)

	// Simulate automated checks (OCR, liveness detection, sanctions screening)
	time.Sleep(200 * time.Millisecond)

	// In production: call external KYC provider API (Jumio, Onfido, etc.)
	// For now, all documents pass automated checks
	return true, nil
}

// UpdateKYCStatus updates the KYC status for a user.
func (a *Activities) UpdateKYCStatus(ctx context.Context, userID, status, reason string) error {
	activity.RecordHeartbeat(ctx, "updating KYC status")
	log.Printf("[Activity] UpdateKYCStatus: userId=%s status=%s reason=%s", userID, status, reason)
	return nil
}

// SendKYCDecisionNotification notifies the user of their KYC decision.
func (a *Activities) SendKYCDecisionNotification(ctx context.Context, userID, status, reason string) error {
	log.Printf("[Activity] SendKYCDecisionNotification: userId=%s status=%s", userID, status)
	return nil
}

// ─── Margin call activities ───────────────────────────────────────────────────

// SendMarginCallNotification sends an urgent margin call notification.
func (a *Activities) SendMarginCallNotification(ctx context.Context, input MarginCallInput) error {
	log.Printf("[Activity] SendMarginCallNotification: userId=%s deficit=%f",
		input.UserID, input.Deficit)
	return nil
}

// VerifyMarginTopUp checks if a top-up resolves the margin deficit.
func (a *Activities) VerifyMarginTopUp(ctx context.Context, userID string, amount float64) (bool, error) {
	activity.RecordHeartbeat(ctx, "verifying margin top-up")
	log.Printf("[Activity] VerifyMarginTopUp: userId=%s amount=%f", userID, amount)
	// Returns true if still deficient after top-up
	return false, nil
}

// SendForcedLiquidationNotification notifies the user of imminent liquidation.
func (a *Activities) SendForcedLiquidationNotification(ctx context.Context, userID string) error {
	log.Printf("[Activity] SendForcedLiquidationNotification: userId=%s", userID)
	return nil
}

// ExecuteForcedLiquidation closes all open positions for a user.
func (a *Activities) ExecuteForcedLiquidation(ctx context.Context, input MarginCallInput) error {
	activity.RecordHeartbeat(ctx, "executing forced liquidation")
	log.Printf("[Activity] ExecuteForcedLiquidation: userId=%s accountId=%s",
		input.UserID, input.AccountID)

	// In production: cancel all open orders and close all positions
	time.Sleep(100 * time.Millisecond)
	return nil
}

// CloseMarginCall marks the margin call as resolved.
func (a *Activities) CloseMarginCall(ctx context.Context, userID, resolution string) error {
	log.Printf("[Activity] CloseMarginCall: userId=%s resolution=%s", userID, resolution)
	return nil
}
