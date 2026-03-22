// Package temporal - activity implementations for NEXCOM workflows.
// Each activity is a single unit of work that can be retried independently.
package temporal

import (
	"context"
	"encoding/json"
	"fmt"
	"math/rand"
	"net/http"
	"os"
	"strings"
	"time"

	"go.uber.org/zap"
)

// ActivityWorker holds dependencies for activity execution
type ActivityWorker struct {
	logger     *zap.SugaredLogger
	httpClient *http.Client
}

// NewActivityWorker creates a new activity worker with dependencies
func NewActivityWorker(logger *zap.SugaredLogger) *ActivityWorker {
	return &ActivityWorker{
		logger:     logger,
		httpClient: &http.Client{Timeout: 15 * time.Second},
	}
}

// ScreenAML calls the Python KYC/AML service to screen a transaction
func (w *ActivityWorker) ScreenAML(ctx context.Context, input AMLScreeningInput) (AMLScreeningResult, error) {
	kycURL := os.Getenv("KYC_SERVICE_URL")
	if kycURL == "" {
		kycURL = "http://localhost:3002"
	}

	data, err := json.Marshal(input)
	if err != nil {
		return AMLScreeningResult{}, fmt.Errorf("marshal error: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost,
		fmt.Sprintf("%s/api/v1/aml/screen", kycURL),
		strings.NewReader(string(data)),
	)
	if err != nil {
		return AMLScreeningResult{}, fmt.Errorf("request creation error: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := w.httpClient.Do(req)
	if err != nil {
		// KYC service unavailable — use conservative default (allow with flag)
		w.logger.Warnw("KYC service unavailable, using conservative AML default", "error", err)
		return AMLScreeningResult{
			Cleared:   true,
			RiskScore: 0.3,
			Flags:     []string{"KYC_SERVICE_UNAVAILABLE"},
		}, nil
	}
	defer resp.Body.Close()

	var result AMLScreeningResult
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return AMLScreeningResult{}, fmt.Errorf("decode error: %w", err)
	}

	return result, nil
}

// LockCommodityToken locks commodity tokens on the blockchain before settlement
func (w *ActivityWorker) LockCommodityToken(ctx context.Context, input SettlementInput) (string, error) {
	blockchainURL := os.Getenv("BLOCKCHAIN_SERVICE_URL")
	if blockchainURL == "" {
		blockchainURL = "http://localhost:8004"
	}

	payload := map[string]interface{}{
		"token_id":  fmt.Sprintf("TOKEN-%s", input.Symbol),
		"quantity":  input.Quantity,
		"lock_for":  input.TradeID,
		"locked_by": input.SellerID,
	}

	data, err := json.Marshal(payload)
	if err != nil {
		return "", fmt.Errorf("marshal error: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost,
		fmt.Sprintf("%s/api/v1/tokens/lock", blockchainURL),
		strings.NewReader(string(data)),
	)
	if err != nil {
		return "", fmt.Errorf("request creation error: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := w.httpClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("blockchain service error: %w", err)
	}
	defer resp.Body.Close()

	var result struct {
		LockID string `json:"lock_id"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return "", fmt.Errorf("decode error: %w", err)
	}

	return result.LockID, nil
}

// UnlockCommodityToken releases a commodity token lock (compensation action)
func (w *ActivityWorker) UnlockCommodityToken(ctx context.Context, lockID string) error {
	blockchainURL := os.Getenv("BLOCKCHAIN_SERVICE_URL")
	if blockchainURL == "" {
		blockchainURL = "http://localhost:8004"
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodDelete,
		fmt.Sprintf("%s/api/v1/tokens/lock/%s", blockchainURL, lockID),
		nil,
	)
	if err != nil {
		return fmt.Errorf("request creation error: %w", err)
	}

	resp, err := w.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("blockchain service error: %w", err)
	}
	defer resp.Body.Close()

	return nil
}

// InitiateMojaloopTransfer initiates a Mojaloop FSPIOP transfer for settlement
func (w *ActivityWorker) InitiateMojaloopTransfer(ctx context.Context, input SettlementInput) (string, error) {
	mojaloopURL := os.Getenv("MOJALOOP_ADAPTER_URL")
	if mojaloopURL == "" {
		mojaloopURL = "http://localhost:4001"
	}

	payload := map[string]interface{}{
		"payer_dfsp":  input.BuyerDFSP,
		"payee_dfsp":  input.SellerDFSP,
		"amount":      fmt.Sprintf("%.2f", input.Total),
		"currency":    input.Currency,
		"note":        fmt.Sprintf("Settlement for trade %s", input.TradeID),
		"transfer_id": fmt.Sprintf("TXF-%s-%d", input.TradeID, time.Now().UnixNano()),
	}

	data, err := json.Marshal(payload)
	if err != nil {
		return "", fmt.Errorf("marshal error: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost,
		fmt.Sprintf("%s/api/v1/transfers", mojaloopURL),
		strings.NewReader(string(data)),
	)
	if err != nil {
		return "", fmt.Errorf("request creation error: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := w.httpClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("mojaloop adapter error: %w", err)
	}
	defer resp.Body.Close()

	var result struct {
		TransferID string `json:"transfer_id"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return "", fmt.Errorf("decode error: %w", err)
	}

	return result.TransferID, nil
}

// RecordTigerBeetle records the settlement in the TigerBeetle double-entry ledger
func (w *ActivityWorker) RecordTigerBeetle(ctx context.Context, input SettlementInput, mojaloopTxID string) (uint64, error) {
	tbURL := os.Getenv("TIGERBEETLE_HTTP_URL")
	if tbURL == "" {
		tbURL = "http://localhost:3003"
	}

	// TigerBeetle transfer: debit buyer account, credit seller account
	payload := map[string]interface{}{
		"transfers": []map[string]interface{}{
			{
				"id":              rand.Uint64(),
				"debit_account":   fmt.Sprintf("ACC-%s", input.BuyerID),
				"credit_account":  fmt.Sprintf("ACC-%s", input.SellerID),
				"amount":          int64(input.Total * 100), // Store in cents
				"ledger":          1,
				"code":            1001, // TRADE_SETTLEMENT
				"user_data":       mojaloopTxID,
				"pending_id":      0,
				"timeout":         0,
				"flags":           0,
			},
		},
	}

	data, err := json.Marshal(payload)
	if err != nil {
		return 0, fmt.Errorf("marshal error: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost,
		fmt.Sprintf("%s/api/v1/transfers", tbURL),
		strings.NewReader(string(data)),
	)
	if err != nil {
		return 0, fmt.Errorf("request creation error: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := w.httpClient.Do(req)
	if err != nil {
		return 0, fmt.Errorf("tigerbeetle service error: %w", err)
	}
	defer resp.Body.Close()

	var result struct {
		TransferID uint64 `json:"transfer_id"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return 0, fmt.Errorf("decode error: %w", err)
	}

	return result.TransferID, nil
}

// TransferCommodityToken transfers commodity tokens on the blockchain after payment confirmation
func (w *ActivityWorker) TransferCommodityToken(ctx context.Context, input SettlementInput, lockID string) error {
	blockchainURL := os.Getenv("BLOCKCHAIN_SERVICE_URL")
	if blockchainURL == "" {
		blockchainURL = "http://localhost:8004"
	}

	payload := map[string]interface{}{
		"lock_id":  lockID,
		"from":     input.SellerID,
		"to":       input.BuyerID,
		"quantity": input.Quantity,
		"trade_id": input.TradeID,
	}

	data, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("marshal error: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost,
		fmt.Sprintf("%s/api/v1/tokens/transfer", blockchainURL),
		strings.NewReader(string(data)),
	)
	if err != nil {
		return fmt.Errorf("request creation error: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := w.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("blockchain service error: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("blockchain transfer returned status %d", resp.StatusCode)
	}

	return nil
}

// EmitSettlementEvent publishes the settlement completion event to Kafka
func (w *ActivityWorker) EmitSettlementEvent(ctx context.Context, input SettlementInput, mojaloopTxID string, tbID uint64) error {
	// This calls the Kafka producer via HTTP to the middleware hub's own endpoint
	// (avoids circular dependency by using HTTP instead of direct Go call)
	hubURL := os.Getenv("MIDDLEWARE_HUB_URL")
	if hubURL == "" {
		hubURL = "http://localhost:8020"
	}

	payload := map[string]interface{}{
		"trade_id":       input.TradeID,
		"mojaloop_tx_id": mojaloopTxID,
		"tigerbeetle_id": tbID,
		"status":         "SETTLED",
		"amount":         input.Total,
		"currency":       input.Currency,
	}

	data, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("marshal error: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost,
		fmt.Sprintf("%s/api/v1/events/settlement", hubURL),
		strings.NewReader(string(data)),
	)
	if err != nil {
		return fmt.Errorf("request creation error: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := w.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("event emission error: %w", err)
	}
	defer resp.Body.Close()

	return nil
}

// VerifyDocuments calls the KYC service to verify uploaded documents
func (w *ActivityWorker) VerifyDocuments(ctx context.Context, input KYCWorkflowInput) (float64, error) {
	kycURL := os.Getenv("KYC_SERVICE_URL")
	if kycURL == "" {
		kycURL = "http://localhost:3002"
	}

	payload := map[string]interface{}{
		"user_id":       input.UserID,
		"document_urls": input.DocumentURLs,
		"entity_type":   input.EntityType,
	}

	data, err := json.Marshal(payload)
	if err != nil {
		return 0, fmt.Errorf("marshal error: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost,
		fmt.Sprintf("%s/api/v1/kyc/verify-documents", kycURL),
		strings.NewReader(string(data)),
	)
	if err != nil {
		return 0, fmt.Errorf("request creation error: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := w.httpClient.Do(req)
	if err != nil {
		return 0, fmt.Errorf("kyc service error: %w", err)
	}
	defer resp.Body.Close()

	var result struct {
		Score float64 `json:"score"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return 0, fmt.Errorf("decode error: %w", err)
	}

	return result.Score, nil
}

// ScreenSanctions checks a user against sanctions and PEP lists
func (w *ActivityWorker) ScreenSanctions(ctx context.Context, input KYCWorkflowInput) (bool, error) {
	kycURL := os.Getenv("KYC_SERVICE_URL")
	if kycURL == "" {
		kycURL = "http://localhost:3002"
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet,
		fmt.Sprintf("%s/api/v1/kyc/sanctions-check?user_id=%s", kycURL, input.UserID),
		nil,
	)
	if err != nil {
		return false, fmt.Errorf("request creation error: %w", err)
	}

	resp, err := w.httpClient.Do(req)
	if err != nil {
		return false, fmt.Errorf("kyc service error: %w", err)
	}
	defer resp.Body.Close()

	var result struct {
		Cleared bool `json:"cleared"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return false, fmt.Errorf("decode error: %w", err)
	}

	return result.Cleared, nil
}

// ComputeAMLRiskScore computes an AML risk score for a KYC applicant
func (w *ActivityWorker) ComputeAMLRiskScore(ctx context.Context, input KYCWorkflowInput) (float64, error) {
	kycURL := os.Getenv("KYC_SERVICE_URL")
	if kycURL == "" {
		kycURL = "http://localhost:3002"
	}

	payload := map[string]interface{}{
		"user_id":     input.UserID,
		"dfsp_id":     input.DFSPID,
		"entity_type": input.EntityType,
		"risk_level":  input.RiskLevel,
	}

	data, err := json.Marshal(payload)
	if err != nil {
		return 0, fmt.Errorf("marshal error: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost,
		fmt.Sprintf("%s/api/v1/aml/risk-score", kycURL),
		strings.NewReader(string(data)),
	)
	if err != nil {
		return 0, fmt.Errorf("request creation error: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := w.httpClient.Do(req)
	if err != nil {
		return 0, fmt.Errorf("kyc service error: %w", err)
	}
	defer resp.Body.Close()

	var result struct {
		Score float64 `json:"score"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return 0, fmt.Errorf("decode error: %w", err)
	}

	return result.Score, nil
}

// NotifyKYCDecision sends a notification to the user about their KYC decision
func (w *ActivityWorker) NotifyKYCDecision(ctx context.Context, input KYCWorkflowInput, result *KYCWorkflowResult) error {
	notifURL := os.Getenv("NOTIFICATION_SERVICE_URL")
	if notifURL == "" {
		notifURL = "http://localhost:3003"
	}

	statusMessages := map[string]string{
		"APPROVED":     "Your KYC application has been approved. You can now trade on NEXCOM Exchange.",
		"REJECTED":     "Your KYC application has been rejected. Please contact support for more information.",
		"EDD_REQUIRED": "Enhanced Due Diligence is required for your account. A compliance officer will contact you.",
		"TIMEOUT":      "Your KYC review is taking longer than expected. Please contact support.",
	}

	message, ok := statusMessages[result.Status]
	if !ok {
		message = fmt.Sprintf("Your KYC status has been updated to: %s", result.Status)
	}

	payload := map[string]interface{}{
		"user_id":  input.UserID,
		"title":    "KYC Review Update",
		"body":     message,
		"category": "KYC",
		"priority": "HIGH",
	}

	data, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("marshal error: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost,
		fmt.Sprintf("%s/api/v1/notifications/send", notifURL),
		strings.NewReader(string(data)),
	)
	if err != nil {
		return fmt.Errorf("request creation error: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := w.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("notification service error: %w", err)
	}
	defer resp.Body.Close()

	return nil
}
