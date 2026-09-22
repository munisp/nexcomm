package temporal

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"math"
	"mime/multipart"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"

	"go.temporal.io/sdk/activity"

	"github.com/munisp/NGApp/services/gateway/internal/models"
	"github.com/munisp/NGApp/services/gateway/internal/tigerbeetle"
)

// Activities contains all Temporal activity implementations for NEXCOM Exchange.
// Each activity is a single unit of work that can be retried independently.
//
// Fail-closed policy: activities that touch money (margin, settlement) or
// identity (KYC) return real errors when their backing service is unavailable.
// They NEVER fabricate success — Temporal retries, then the workflow compensates.
// Status-persistence activities that this worker cannot perform honestly return
// explicit unimplemented errors instead of log-only fake success.
type Activities struct {
	tb         *tigerbeetle.Client
	kycURL     string
	httpClient *http.Client

	mu                 sync.Mutex
	marginReservations map[string]string // orderID → TigerBeetle pending transfer ID
}

// NewActivities wires real dependencies into the activity set. A nil TigerBeetle
// client is allowed at construction time but every ledger-touching activity will
// fail closed until a connected client is provided.
func NewActivities(tb *tigerbeetle.Client, kycServiceURL string) *Activities {
	if kycServiceURL == "" {
		kycServiceURL = os.Getenv("KYC_SERVICE_URL")
	}
	return &Activities{
		tb:                 tb,
		kycURL:             strings.TrimRight(kycServiceURL, "/"),
		httpClient:         &http.Client{Timeout: 20 * time.Second},
		marginReservations: make(map[string]string),
	}
}

// deps lazily initialises fields for zero-value Activities (defensive; the
// client always constructs via NewActivities, but Temporal may instantiate
// the struct through reflection in some registration paths).
func (a *Activities) deps() {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.httpClient == nil {
		a.httpClient = &http.Client{Timeout: 20 * time.Second}
	}
	if a.marginReservations == nil {
		a.marginReservations = make(map[string]string)
	}
	if a.kycURL == "" {
		a.kycURL = strings.TrimRight(os.Getenv("KYC_SERVICE_URL"), "/")
	}
}

// findAccount locates a user's ledger account of one of the given types.
func (a *Activities) findAccount(userID string, types ...string) (*tigerbeetle.Account, error) {
	if a.tb == nil {
		return nil, errors.New("TigerBeetle ledger client not configured")
	}
	for _, acct := range a.tb.GetAllAccounts(userID) {
		for _, t := range types {
			if strings.EqualFold(acct.Type, t) {
				return acct, nil
			}
		}
	}
	return nil, fmt.Errorf("no ledger account of type %v found for user %q", types, userID)
}

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

// ReserveMargin reserves the required margin for an order as a TigerBeetle
// pending (two-phase) transfer from the user's margin/settlement account into
// the exchange margin account. Fail-closed: any ledger unavailability or
// missing account is an error (Temporal retries); genuine insufficient funds
// returns (false, nil) so the workflow rejects the order without retry loops.
func (a *Activities) ReserveMargin(ctx context.Context, input models.OrderWorkflowInput) (bool, error) {
	activity.RecordHeartbeat(ctx, "reserving margin")
	a.deps()

	if a.tb == nil {
		return false, fmt.Errorf("ReserveMargin: TigerBeetle ledger client not configured; refusing to auto-approve margin")
	}
	if input.Price <= 0 || input.Qty <= 0 {
		return false, fmt.Errorf("ReserveMargin: cannot price margin for order %s (price=%f qty=%f)", input.OrderID, input.Price, input.Qty)
	}
	required := int64(math.Round(input.Price * input.Qty * 100)) // minor units

	source, err := a.findAccount(input.UserID, "MARGIN", "SETTLEMENT", "TRADING")
	if err != nil {
		return false, fmt.Errorf("ReserveMargin: %w", err)
	}
	balance, err := a.tb.GetAccountBalance(source.ID)
	if err != nil {
		return false, fmt.Errorf("ReserveMargin: balance lookup for account %s: %w", source.ID, err)
	}
	if balance < required {
		log.Printf("[Activity] ReserveMargin: insufficient margin orderId=%s userId=%s balance=%d required=%d",
			input.OrderID, input.UserID, balance, required)
		return false, nil
	}

	dest, err := a.findAccount("exchange", "CLEARING", "MARGIN", "SETTLEMENT")
	if err != nil {
		return false, fmt.Errorf("ReserveMargin: exchange margin account not provisioned: %w", err)
	}

	transfer, err := a.tb.CreatePendingTransfer(source.ID, dest.ID, required, tigerbeetle.TransferMarginDeposit)
	if err != nil {
		return false, fmt.Errorf("ReserveMargin: pending transfer: %w", err)
	}

	a.mu.Lock()
	a.marginReservations[input.OrderID] = transfer.ID
	a.mu.Unlock()

	log.Printf("[Activity] ReserveMargin: reserved orderId=%s transferId=%s amount=%d",
		input.OrderID, transfer.ID, required)
	return true, nil
}

// ReleaseMargin voids the pending margin transfer when an order is cancelled.
// If this worker never recorded a reservation for the order there is nothing to
// release (nil); if a reservation exists but the ledger is unreachable we return
// an error so Temporal retries instead of leaking reserved funds.
func (a *Activities) ReleaseMargin(ctx context.Context, orderID string) error {
	activity.RecordHeartbeat(ctx, "releasing margin")
	a.deps()

	a.mu.Lock()
	transferID, ok := a.marginReservations[orderID]
	if ok {
		delete(a.marginReservations, orderID)
	}
	a.mu.Unlock()

	if !ok {
		log.Printf("[Activity] ReleaseMargin: no recorded reservation for orderId=%s (nothing to release)", orderID)
		return nil
	}
	if a.tb == nil {
		return fmt.Errorf("ReleaseMargin: TigerBeetle ledger client not configured; cannot void pending transfer %s", transferID)
	}
	if err := a.tb.VoidTransfer(transferID); err != nil {
		return fmt.Errorf("ReleaseMargin: void pending transfer %s: %w", transferID, err)
	}
	log.Printf("[Activity] ReleaseMargin: voided pending transfer %s for orderId=%s", transferID, orderID)
	return nil
}

// UpdateOrderStatus updates the order status in the database.
// This worker owns no order store; pretending to persist would be silent
// mockware, so it fails closed with an explicit error.
func (a *Activities) UpdateOrderStatus(ctx context.Context, orderID, status, reason string) error {
	activity.RecordHeartbeat(ctx, "updating order status")
	return fmt.Errorf("UpdateOrderStatus unimplemented in gateway worker: order status persistence is owned by the portal API (orderId=%s status=%s reason=%q)", orderID, status, reason)
}

// ─── Settlement activities ────────────────────────────────────────────────────

// ValidateTrade checks that a trade record exists and is in the correct state.
func (a *Activities) ValidateTrade(ctx context.Context, tradeID string) error {
	activity.RecordHeartbeat(ctx, "validating trade")
	if tradeID == "" {
		return fmt.Errorf("trade ID is required")
	}
	return nil
}

// ExecuteSettlementTransfer executes the real TigerBeetle double-entry transfer
// from the buyer's settlement account to the seller's settlement account.
// Fail-closed: any ledger error is returned so the SettlementWorkflow retries
// (5 attempts, exponential backoff) instead of pretending money moved.
func (a *Activities) ExecuteSettlementTransfer(ctx context.Context, input models.SettlementWorkflowInput) error {
	activity.RecordHeartbeat(ctx, "executing settlement transfer")
	a.deps()

	if a.tb == nil {
		return fmt.Errorf("ExecuteSettlementTransfer: TigerBeetle ledger client not configured; refusing to fake settlement for trade %s", input.TradeID)
	}
	amount := int64(math.Round(input.Amount * 100)) // minor units
	if amount <= 0 {
		return fmt.Errorf("ExecuteSettlementTransfer: non-positive amount %f for trade %s", input.Amount, input.TradeID)
	}

	buyer, err := a.findAccount(input.BuyerID, "SETTLEMENT", "TRADING")
	if err != nil {
		return fmt.Errorf("ExecuteSettlementTransfer: buyer: %w", err)
	}
	seller, err := a.findAccount(input.SellerID, "SETTLEMENT", "TRADING", "CLEARING")
	if err != nil {
		return fmt.Errorf("ExecuteSettlementTransfer: seller: %w", err)
	}

	transfer, err := a.tb.CreateTransfer(buyer.ID, seller.ID, amount, tigerbeetle.TransferTradeSettlement)
	if err != nil {
		return fmt.Errorf("ExecuteSettlementTransfer: trade %s: %w", input.TradeID, err)
	}
	log.Printf("[Activity] ExecuteSettlementTransfer: tradeId=%s transferId=%s amount=%d buyer=%s seller=%s",
		input.TradeID, transfer.ID, amount, input.BuyerID, input.SellerID)
	return nil
}

// UpdateTradeStatus updates the trade status in the database.
// This worker owns no trade store; it fails closed with an explicit error
// instead of log-only fake success.
func (a *Activities) UpdateTradeStatus(ctx context.Context, tradeID, status string) error {
	activity.RecordHeartbeat(ctx, "updating trade status")
	return fmt.Errorf("UpdateTradeStatus unimplemented in gateway worker: trade status persistence is owned by the portal API (tradeId=%s status=%s)", tradeID, status)
}

// SendSettlementNotification sends settlement confirmation to buyer and seller.
// Notification dispatch is not wired in this worker; failing closed with an
// explicit error rather than silently dropping the notification.
func (a *Activities) SendSettlementNotification(ctx context.Context, input models.SettlementWorkflowInput) error {
	return fmt.Errorf("SendSettlementNotification unimplemented in gateway worker: notification dispatch is owned by the notification service (tradeId=%s)", input.TradeID)
}

// ─── KYC activities ───────────────────────────────────────────────────────────

// kycVerifyResponse mirrors services/kyc-service POST /api/v1/documents/verify.
type kycVerifyResponse struct {
	Success bool `json:"success"`
	Data    struct {
		IsAuthentic       bool     `json:"is_authentic"`
		Confidence        float64  `json:"confidence"`
		TamperingDetected bool     `json:"tampering_detected"`
		ExpiryValid       bool     `json:"expiry_valid"`
		FaceDetected      bool     `json:"face_detected"`
		Issues            []string `json:"issues"`
	} `json:"data"`
}

// RunAutomatedKYCChecks performs real automated document verification by
// fetching the uploaded document and submitting it to the kyc-service
// /api/v1/documents/verify endpoint (OCR + tamper + expiry analysis).
// NEVER auto-approves: transport errors are returned for retry, and the
// check passes only when the service confirms authenticity.
func (a *Activities) RunAutomatedKYCChecks(ctx context.Context, input KYCWorkflowInput) (bool, error) {
	activity.RecordHeartbeat(ctx, "running automated KYC checks")
	a.deps()

	if a.kycURL == "" {
		return false, fmt.Errorf("RunAutomatedKYCChecks: KYC_SERVICE_URL not configured; refusing to auto-approve user %s", input.UserID)
	}
	if input.DocumentURL == "" {
		return false, fmt.Errorf("RunAutomatedKYCChecks: no document URL for user %s; refusing to auto-approve", input.UserID)
	}

	docType := strings.ToLower(strings.TrimSpace(input.DocumentType))
	if docType == "" {
		docType = "national_id"
	}

	// Fetch the document bytes from the upload URL.
	docReq, err := http.NewRequestWithContext(ctx, http.MethodGet, input.DocumentURL, nil)
	if err != nil {
		return false, fmt.Errorf("RunAutomatedKYCChecks: document request: %w", err)
	}
	docResp, err := a.httpClient.Do(docReq)
	if err != nil {
		return false, fmt.Errorf("RunAutomatedKYCChecks: fetch document %s: %w", input.DocumentURL, err)
	}
	defer docResp.Body.Close()
	if docResp.StatusCode != http.StatusOK {
		return false, fmt.Errorf("RunAutomatedKYCChecks: fetch document %s: status %d", input.DocumentURL, docResp.StatusCode)
	}

	// Submit to kyc-service as multipart form (document_type + file).
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	if err := mw.WriteField("document_type", docType); err != nil {
		return false, fmt.Errorf("RunAutomatedKYCChecks: multipart field: %w", err)
	}
	fw, err := mw.CreateFormFile("file", "kyc-document")
	if err != nil {
		return false, fmt.Errorf("RunAutomatedKYCChecks: multipart file: %w", err)
	}
	if _, err := io.Copy(fw, io.LimitReader(docResp.Body, 32<<20)); err != nil {
		return false, fmt.Errorf("RunAutomatedKYCChecks: read document: %w", err)
	}
	if err := mw.Close(); err != nil {
		return false, fmt.Errorf("RunAutomatedKYCChecks: multipart close: %w", err)
	}

	verifyReq, err := http.NewRequestWithContext(ctx, http.MethodPost, a.kycURL+"/api/v1/documents/verify", &buf)
	if err != nil {
		return false, fmt.Errorf("RunAutomatedKYCChecks: verify request: %w", err)
	}
	verifyReq.Header.Set("Content-Type", mw.FormDataContentType())

	verifyResp, err := a.httpClient.Do(verifyReq)
	if err != nil {
		return false, fmt.Errorf("RunAutomatedKYCChecks: kyc-service unavailable: %w", err)
	}
	defer verifyResp.Body.Close()

	if verifyResp.StatusCode >= 500 {
		return false, fmt.Errorf("RunAutomatedKYCChecks: kyc-service error: status %d", verifyResp.StatusCode)
	}
	if verifyResp.StatusCode >= 300 {
		body, _ := io.ReadAll(io.LimitReader(verifyResp.Body, 2048))
		log.Printf("[Activity] RunAutomatedKYCChecks: rejected by kyc-service userId=%s status=%d body=%s",
			input.UserID, verifyResp.StatusCode, string(body))
		return false, nil // client error → document/check rejected, do not retry
	}

	var result kycVerifyResponse
	if err := json.NewDecoder(verifyResp.Body).Decode(&result); err != nil {
		return false, fmt.Errorf("RunAutomatedKYCChecks: decode kyc-service response: %w", err)
	}

	passed := result.Success && result.Data.IsAuthentic && !result.Data.TamperingDetected && result.Data.ExpiryValid
	log.Printf("[Activity] RunAutomatedKYCChecks: userId=%s passed=%v authentic=%v tampering=%v expiryValid=%v confidence=%f issues=%v",
		input.UserID, passed, result.Data.IsAuthentic, result.Data.TamperingDetected,
		result.Data.ExpiryValid, result.Data.Confidence, result.Data.Issues)
	return passed, nil
}

// UpdateKYCStatus updates the KYC status for a user.
// This worker owns no KYC store; it fails closed with an explicit error
// instead of log-only fake success.
func (a *Activities) UpdateKYCStatus(ctx context.Context, userID, status, reason string) error {
	activity.RecordHeartbeat(ctx, "updating KYC status")
	return fmt.Errorf("UpdateKYCStatus unimplemented in gateway worker: KYC status persistence is owned by kyc-service (userId=%s status=%s reason=%q)", userID, status, reason)
}

// SendKYCDecisionNotification notifies the user of their KYC decision.
// Notification dispatch is not wired in this worker; failing closed.
func (a *Activities) SendKYCDecisionNotification(ctx context.Context, userID, status, reason string) error {
	return fmt.Errorf("SendKYCDecisionNotification unimplemented in gateway worker: notification dispatch is owned by the notification service (userId=%s status=%s)", userID, status)
}

// ─── Margin call activities ───────────────────────────────────────────────────

// SendMarginCallNotification sends an urgent margin call notification.
// Notification dispatch is not wired in this worker; failing closed.
func (a *Activities) SendMarginCallNotification(ctx context.Context, input MarginCallInput) error {
	return fmt.Errorf("SendMarginCallNotification unimplemented in gateway worker: notification dispatch is owned by the notification service (userId=%s)", input.UserID)
}

// VerifyMarginTopUp checks, against the real TigerBeetle balance, whether the
// user's margin account still falls short of the required margin after a
// top-up of the given amount. Returns stillDeficient=true when it does.
func (a *Activities) VerifyMarginTopUp(ctx context.Context, input MarginCallInput, topUpAmount float64) (bool, error) {
	activity.RecordHeartbeat(ctx, "verifying margin top-up")
	a.deps()

	if a.tb == nil {
		return false, fmt.Errorf("VerifyMarginTopUp: TigerBeetle ledger client not configured; refusing to auto-resolve margin call for user %s", input.UserID)
	}
	acct, err := a.findAccount(input.UserID, "MARGIN", "SETTLEMENT", "TRADING")
	if err != nil {
		return false, fmt.Errorf("VerifyMarginTopUp: %w", err)
	}
	balance, err := a.tb.GetAccountBalance(acct.ID)
	if err != nil {
		return false, fmt.Errorf("VerifyMarginTopUp: balance lookup: %w", err)
	}

	effective := float64(balance)/100.0 + topUpAmount
	stillDeficient := effective < input.RequiredMargin
	log.Printf("[Activity] VerifyMarginTopUp: userId=%s balance=%f topUp=%f required=%f stillDeficient=%v",
		input.UserID, float64(balance)/100.0, topUpAmount, input.RequiredMargin, stillDeficient)
	return stillDeficient, nil
}

// SendForcedLiquidationNotification notifies the user of imminent liquidation.
// Notification dispatch is not wired in this worker; failing closed.
func (a *Activities) SendForcedLiquidationNotification(ctx context.Context, userID string) error {
	return fmt.Errorf("SendForcedLiquidationNotification unimplemented in gateway worker: notification dispatch is owned by the notification service (userId=%s)", userID)
}

// ExecuteForcedLiquidation closes all open positions for a user.
// Position management is owned by the matching engine / portal API; this
// worker has no honest way to perform it, so it fails closed explicitly
// instead of sleeping and pretending positions were closed.
func (a *Activities) ExecuteForcedLiquidation(ctx context.Context, input MarginCallInput) error {
	activity.RecordHeartbeat(ctx, "executing forced liquidation")
	return fmt.Errorf("ExecuteForcedLiquidation unimplemented in gateway worker: position liquidation is owned by the matching engine (userId=%s accountId=%s)", input.UserID, input.AccountID)
}

// CloseMarginCall marks the margin call as resolved.
// This worker owns no margin-call store; failing closed with an explicit error.
func (a *Activities) CloseMarginCall(ctx context.Context, userID, resolution string) error {
	return fmt.Errorf("CloseMarginCall unimplemented in gateway worker: margin-call persistence is owned by the portal API (userId=%s resolution=%s)", userID, resolution)
}
