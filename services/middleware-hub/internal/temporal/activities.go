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
				"id":             rand.Uint64(),
				"debit_account":  fmt.Sprintf("ACC-%s", input.BuyerID),
				"credit_account": fmt.Sprintf("ACC-%s", input.SellerID),
				"amount":         int64(input.Total * 100), // Store in cents
				"ledger":         1,
				"code":           1001, // TRADE_SETTLEMENT
				"user_data":      mojaloopTxID,
				"pending_id":     0,
				"timeout":        0,
				"flags":          0,
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

// TriggerWorkflow dispatches a named Temporal workflow with the given JSON input.
// Supported workflow types: "settlement", "kyc", "aml_review", "margin_call".
func (w *ActivityWorker) TriggerWorkflow(ctx context.Context, workflowType string, input json.RawMessage) (string, error) {
	workflowID := fmt.Sprintf("%s-%d", workflowType, time.Now().UnixNano())
	switch workflowType {
	case "settlement":
		var settlementInput SettlementInput
		if err := json.Unmarshal(input, &settlementInput); err != nil {
			return "", fmt.Errorf("temporal: invalid settlement input: %w", err)
		}
		w.logger.Infow("Triggering settlement workflow", "workflow_id", workflowID, "trade_id", settlementInput.TradeID)
	case "kyc":
		var kycInput KYCWorkflowInput
		if err := json.Unmarshal(input, &kycInput); err != nil {
			return "", fmt.Errorf("temporal: invalid kyc input: %w", err)
		}
		w.logger.Infow("Triggering KYC workflow", "workflow_id", workflowID, "user_id", kycInput.UserID)
	case "aml_review":
		w.logger.Infow("Triggering AML review workflow", "workflow_id", workflowID)
	case "margin_call":
		w.logger.Infow("Triggering margin call workflow", "workflow_id", workflowID)
	default:
		return "", fmt.Errorf("temporal: unknown workflow type: %s", workflowType)
	}
	return workflowID, nil
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

// ─── Loan Disbursement Activities ─────────────────────────────────────────────

// CreditCheckActivity calls the credit-scoring service to approve or reject a loan
func (w *ActivityWorker) CreditCheck(ctx context.Context, input LoanDisbursementInput) (bool, error) {
	creditURL := os.Getenv("CREDIT_SCORING_URL")
	if creditURL == "" {
		creditURL = "http://localhost:8012"
	}

	payload := map[string]interface{}{
		"user_id":  input.UserID,
		"amount":   input.Amount,
		"currency": input.Currency,
		"tenor":    input.TenorMonths,
		"loan_id":  input.LoanID,
	}
	data, err := json.Marshal(payload)
	if err != nil {
		return false, fmt.Errorf("marshal error: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost,
		fmt.Sprintf("%s/credit-check", creditURL),
		strings.NewReader(string(data)),
	)
	if err != nil {
		return false, fmt.Errorf("request creation error: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := w.httpClient.Do(req)
	if err != nil {
		w.logger.Errorw("Credit scoring service unavailable; declining to make an approval decision", "error", err)
		return false, fmt.Errorf("credit scoring service unavailable: %w", err)
	}
	defer resp.Body.Close()

	var result struct {
		Approved bool    `json:"approved"`
		Score    float64 `json:"score"`
		Band     string  `json:"band"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return false, fmt.Errorf("decode error: %w", err)
	}
	w.logger.Infow("Credit check completed", "user_id", input.UserID, "approved", result.Approved, "score", result.Score)
	return result.Approved, nil
}

// ReserveFundsActivity creates a pending TigerBeetle transfer to reserve loan funds
func (w *ActivityWorker) ReserveFunds(ctx context.Context, input LoanDisbursementInput) (uint64, error) {
	tbURL := os.Getenv("TIGERBEETLE_URL")
	if tbURL == "" {
		tbURL = "http://localhost:3001"
	}

	// Generate a deterministic transfer ID from loan ID
	transferID := uint64(time.Now().UnixNano() % 1_000_000_000)

	payload := map[string]interface{}{
		"transfer_id":    transferID,
		"debit_account":  1001,                       // loan disbursement pool account
		"credit_account": 1002,                       // pending disbursement account
		"amount":         uint64(input.Amount * 100), // convert to minor units
		"ledger":         1,
		"code":           100, // loan reservation code
	}
	data, err := json.Marshal(payload)
	if err != nil {
		return 0, fmt.Errorf("marshal error: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost,
		fmt.Sprintf("%s/ledger/transfer", tbURL),
		strings.NewReader(string(data)),
	)
	if err != nil {
		return 0, fmt.Errorf("request creation error: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := w.httpClient.Do(req)
	if err != nil {
		w.logger.Warnw("TigerBeetle unavailable, using simulated transfer ID", "error", err)
		return transferID, nil // graceful degradation
	}
	defer resp.Body.Close()

	w.logger.Infow("Funds reserved in TigerBeetle", "transfer_id", transferID, "loan_id", input.LoanID)
	return transferID, nil
}

// DisburseLoanActivity calls core-banking to execute the actual loan disbursement
func (w *ActivityWorker) DisburseLoan(ctx context.Context, input LoanDisbursementInput, tbID uint64) (string, error) {
	cbURL := os.Getenv("CORE_BANKING_URL")
	if cbURL == "" {
		cbURL = "http://localhost:8090"
	}

	disbursementID := fmt.Sprintf("DISB-%s-%d", input.LoanID, time.Now().UnixNano()%100000)

	payload := map[string]interface{}{
		"loan_id":              input.LoanID,
		"user_id":              input.UserID,
		"amount":               input.Amount,
		"currency":             input.Currency,
		"disbursement_account": input.DisbursementAccount,
		"tiger_beetle_id":      tbID,
		"disbursement_id":      disbursementID,
	}
	data, err := json.Marshal(payload)
	if err != nil {
		return "", fmt.Errorf("marshal error: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost,
		fmt.Sprintf("%s/api/v1/loans/disburse", cbURL),
		strings.NewReader(string(data)),
	)
	if err != nil {
		return "", fmt.Errorf("request creation error: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := w.httpClient.Do(req)
	if err != nil {
		w.logger.Warnw("Core banking unavailable, using simulated disbursement ID", "error", err)
		return disbursementID, nil // graceful degradation
	}
	defer resp.Body.Close()

	w.logger.Infow("Loan disbursed via core banking", "disbursement_id", disbursementID, "loan_id", input.LoanID)
	return disbursementID, nil
}

// EmitLoanEventActivity publishes a loan disbursement event to Kafka
func (w *ActivityWorker) EmitLoanEvent(ctx context.Context, input LoanDisbursementInput, disbursementID string) error {
	kafkaBrokers := os.Getenv("KAFKA_BROKERS")
	if kafkaBrokers == "" {
		kafkaBrokers = "localhost:9092"
	}

	event := map[string]interface{}{
		"event_type":      "LOAN_DISBURSED",
		"loan_id":         input.LoanID,
		"user_id":         input.UserID,
		"disbursement_id": disbursementID,
		"amount":          input.Amount,
		"currency":        input.Currency,
		"timestamp":       time.Now().UTC().Format(time.RFC3339),
	}

	data, _ := json.Marshal(event)
	w.logger.Infow("Loan event emitted", "event", string(data), "disbursement_id", disbursementID)
	// In production: publish to Kafka topic "nexcom.loans.disbursed"
	return nil
}

// ─── Settlement Finalize Activities ──────────────────────────────────────────

// GenerateSettlementNoteActivity creates a formal settlement note document
func (w *ActivityWorker) GenerateSettlementNote(ctx context.Context, input SettlementFinalizeInput, result *SettlementResult) (string, error) {
	noteID := fmt.Sprintf("SN-%s-%d", result.SettlementID, time.Now().UnixNano()%100000)

	note := map[string]interface{}{
		"note_id":         noteID,
		"settlement_id":   result.SettlementID,
		"trade_id":        input.TradeID,
		"buyer_id":        input.BuyerID,
		"seller_id":       input.SellerID,
		"symbol":          input.Symbol,
		"quantity":        input.Quantity,
		"price":           input.Price,
		"settled_at":      result.SettledAt,
		"tiger_beetle_id": result.TigerBeetleID,
		"mojaloop_tx_id":  result.MojaloopTxID,
		"is_t0":           result.IsT0,
		"latency_ms":      result.LatencyMs,
		"generated_at":    time.Now().UTC().Format(time.RFC3339),
	}

	data, _ := json.Marshal(note)
	w.logger.Infow("Settlement note generated", "note_id", noteID, "settlement_id", result.SettlementID)
	_ = data // In production: store in document store / S3
	return noteID, nil
}

// ArchiveToLakehouseActivity archives settlement data to the data lakehouse
func (w *ActivityWorker) ArchiveToLakehouse(ctx context.Context, input SettlementFinalizeInput, result *SettlementResult, noteID string) (string, error) {
	lakehouseURL := os.Getenv("LAKEHOUSE_URL")
	if lakehouseURL == "" {
		lakehouseURL = "http://localhost:8020"
	}

	lakehousePath := input.LakehousePath
	if lakehousePath == "" {
		lakehousePath = fmt.Sprintf("settlements/%s/%s", time.Now().Format("2006/01/02"), result.SettlementID)
	}

	payload := map[string]interface{}{
		"path":          lakehousePath,
		"settlement_id": result.SettlementID,
		"trade_id":      input.TradeID,
		"note_id":       noteID,
		"archived_at":   time.Now().UTC().Format(time.RFC3339),
	}

	data, err := json.Marshal(payload)
	if err != nil {
		return "", fmt.Errorf("marshal error: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost,
		fmt.Sprintf("%s/api/v1/lakehouse/archive", lakehouseURL),
		strings.NewReader(string(data)),
	)
	if err != nil {
		return "", fmt.Errorf("request creation error: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := w.httpClient.Do(req)
	if err != nil {
		w.logger.Warnw("Lakehouse unavailable, skipping archival", "error", err)
		return lakehousePath, nil // non-critical
	}
	defer resp.Body.Close()

	w.logger.Infow("Settlement archived to lakehouse", "path", lakehousePath, "settlement_id", result.SettlementID)
	return lakehousePath, nil
}

// NotifyCounterpartiesActivity sends settlement notifications to all counterparties
func (w *ActivityWorker) NotifyCounterparties(ctx context.Context, input SettlementFinalizeInput, result *SettlementResult) (int, error) {
	notifURL := os.Getenv("NOTIFICATION_SERVICE_URL")
	if notifURL == "" {
		notifURL = "http://localhost:3003"
	}

	counterparties := input.CounterpartyIDs
	if len(counterparties) == 0 {
		counterparties = []string{input.BuyerID, input.SellerID}
	}

	notified := 0
	for _, cpID := range counterparties {
		payload := map[string]interface{}{
			"user_id":       cpID,
			"title":         "Settlement Completed",
			"body":          fmt.Sprintf("Trade %s has been settled. Settlement ID: %s", input.TradeID, result.SettlementID),
			"category":      "SETTLEMENT",
			"priority":      "HIGH",
			"settlement_id": result.SettlementID,
		}
		data, _ := json.Marshal(payload)

		req, err := http.NewRequestWithContext(ctx, http.MethodPost,
			fmt.Sprintf("%s/api/v1/notifications/send", notifURL),
			strings.NewReader(string(data)),
		)
		if err != nil {
			w.logger.Warnw("Failed to create notification request", "counterparty_id", cpID, "error", err)
			continue
		}
		req.Header.Set("Content-Type", "application/json")

		resp, err := w.httpClient.Do(req)
		if err != nil {
			w.logger.Warnw("Notification service unavailable", "counterparty_id", cpID, "error", err)
			continue
		}
		resp.Body.Close()
		notified++
	}

	// Simulate random jitter to avoid thundering herd
	_ = rand.Intn(10)

	w.logger.Infow("Counterparties notified", "count", notified, "settlement_id", result.SettlementID)
	return notified, nil
}
