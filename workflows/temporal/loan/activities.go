// Package loan — Temporal activities for the loan disbursement saga.
package loan

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"time"
)

// ─── Types ────────────────────────────────────────────────────────────────────

type CreditScoreInput struct {
	UserID          string  `json:"user_id"`
	RequestedAmount float64 `json:"requested_amount"`
	TenorDays       int     `json:"tenor_days"`
}

type CreditScoreResult struct {
	Approved bool   `json:"approved"`
	Score    int    `json:"score"`
	Reason   string `json:"reason,omitempty"`
}

type CollateralHoldInput struct {
	UserID         string  `json:"user_id"`
	CollateralType string  `json:"collateral_type"`
	CollateralID   string  `json:"collateral_id"`
	LoanAmount     float64 `json:"loan_amount"`
	LoanID         string  `json:"loan_id"`
}

type CollateralHoldResult struct {
	Success bool   `json:"success"`
	HoldID  string `json:"hold_id"`
	Reason  string `json:"reason,omitempty"`
}

type PendingDebitInput struct {
	UserID    string `json:"user_id"`
	Amount    int64  `json:"amount"`
	Reference string `json:"reference"`
	Code      int    `json:"code"`
}

type PendingTransferResult struct {
	PendingID string `json:"pending_id"`
	Success   bool   `json:"success"`
}

type CommitDebitInput struct {
	PendingID string `json:"pending_id"`
	Reference string `json:"reference"`
}

type LedgerCreditInput struct {
	UserID    string `json:"user_id"`
	Amount    int64  `json:"amount"`
	Reference string `json:"reference"`
	Code      int    `json:"code"`
}

type LedgerCreditResult struct {
	TransferID string `json:"transfer_id"`
	Success    bool   `json:"success"`
}

type ExternalTransferInput struct {
	LoanID      string  `json:"loan_id"`
	UserID      string  `json:"user_id"`
	Amount      float64 `json:"amount"`
	Currency    string  `json:"currency"`
	Channel     string  `json:"channel"`
	Destination string  `json:"destination"`
	Reference   string  `json:"reference"`
}

type ExternalTransferResult struct {
	ExternalTxID string `json:"external_tx_id"`
	Status       string `json:"status"`
}

type MarkLoanActiveInput struct {
	LoanID        string    `json:"loan_id"`
	LedgerTxID    string    `json:"ledger_tx_id"`
	ExternalTxID  string    `json:"external_tx_id"`
	RepaymentDate time.Time `json:"repayment_date"`
}

type KafkaEmitInput struct {
	Topic   string                 `json:"topic"`
	Payload map[string]interface{} `json:"payload"`
}

type LakehouseIngestInput struct {
	Table   string                 `json:"table"`
	Payload map[string]interface{} `json:"payload"`
}

type AlertInput struct {
	Severity string `json:"severity"`
	Message  string `json:"message"`
}

// ─── Service URLs ─────────────────────────────────────────────────────────────

func gatewayURL() string {
	if u := os.Getenv("GATEWAY_SERVICE_URL"); u != "" {
		return u
	}
	return "http://localhost:8200"
}

func lakehouseURL() string {
	if u := os.Getenv("LAKEHOUSE_INGESTION_URL"); u != "" {
		return u
	}
	return "http://localhost:8400"
}

// ─── Activities ───────────────────────────────────────────────────────────────

func CreditScoringActivity(ctx context.Context, input CreditScoreInput) (*CreditScoreResult, error) {
	body, _ := json.Marshal(input)
	url := fmt.Sprintf("%s/api/v1/credit/score", gatewayURL())
	resp, err := http.Post(url, "application/json", bytes.NewReader(body))
	if err != nil {
		// Fail open with minimum score if service unavailable
		return &CreditScoreResult{Approved: true, Score: 500, Reason: "credit-service-unavailable"}, nil
	}
	defer resp.Body.Close()
	var result CreditScoreResult
	_ = json.NewDecoder(resp.Body).Decode(&result)
	return &result, nil
}

func HoldCollateralActivity(ctx context.Context, input CollateralHoldInput) (*CollateralHoldResult, error) {
	body, _ := json.Marshal(input)
	url := fmt.Sprintf("%s/api/v1/collateral/hold", gatewayURL())
	req, _ := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("collateral hold failed: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return nil, fmt.Errorf("collateral service returned %d", resp.StatusCode)
	}
	var result CollateralHoldResult
	_ = json.NewDecoder(resp.Body).Decode(&result)
	return &result, nil
}

func ReleaseCollateralActivity(ctx context.Context, holdID string) error {
	body, _ := json.Marshal(map[string]string{"hold_id": holdID})
	url := fmt.Sprintf("%s/api/v1/collateral/release", gatewayURL())
	req, _ := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil
	}
	defer resp.Body.Close()
	return nil
}

func CreatePendingLoanDebitActivity(ctx context.Context, input PendingDebitInput) (*PendingTransferResult, error) {
	body, _ := json.Marshal(map[string]interface{}{
		"debit_account_id":  "exchange-loan-pool",
		"credit_account_id": fmt.Sprintf("user-settlement-%s", input.UserID),
		"amount":            input.Amount,
		"code":              input.Code,
		"pending":           true,
		"user_data":         input.Reference,
	})
	url := fmt.Sprintf("%s/api/v1/ledger/transfer", gatewayURL())
	req, _ := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("TigerBeetle pending loan debit failed: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return nil, fmt.Errorf("TigerBeetle gateway returned %d", resp.StatusCode)
	}
	var result PendingTransferResult
	_ = json.NewDecoder(resp.Body).Decode(&result)
	return &result, nil
}

func VoidPendingLoanDebitActivity(ctx context.Context, pendingID string) error {
	body, _ := json.Marshal(map[string]string{"pending_id": pendingID})
	url := fmt.Sprintf("%s/api/v1/ledger/void-pending", gatewayURL())
	req, _ := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil
	}
	defer resp.Body.Close()
	return nil
}

func MarkLoanDisbursingActivity(ctx context.Context, loanID string) error {
	body, _ := json.Marshal(map[string]string{"status": "DISBURSING"})
	url := fmt.Sprintf("%s/api/v1/loans/%s/status", gatewayURL(), loanID)
	req, _ := http.NewRequestWithContext(ctx, http.MethodPatch, url, bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return fmt.Errorf("failed to mark disbursing: %w", err)
	}
	defer resp.Body.Close()
	return nil
}

func MarkLoanFailedActivity(ctx context.Context, loanID string) error {
	body, _ := json.Marshal(map[string]string{"status": "FAILED"})
	url := fmt.Sprintf("%s/api/v1/loans/%s/status", gatewayURL(), loanID)
	req, _ := http.NewRequestWithContext(ctx, http.MethodPatch, url, bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil
	}
	defer resp.Body.Close()
	return nil
}

func DisburseLoanExternallyActivity(ctx context.Context, input ExternalTransferInput) (*ExternalTransferResult, error) {
	body, _ := json.Marshal(input)
	url := fmt.Sprintf("%s/api/v1/payments/send", gatewayURL())
	req, _ := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("external disbursement failed: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return nil, fmt.Errorf("payment gateway returned %d", resp.StatusCode)
	}
	var result ExternalTransferResult
	_ = json.NewDecoder(resp.Body).Decode(&result)
	return &result, nil
}

func CommitLoanDebitActivity(ctx context.Context, input CommitDebitInput) error {
	body, _ := json.Marshal(input)
	url := fmt.Sprintf("%s/api/v1/ledger/commit-pending", gatewayURL())
	req, _ := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return fmt.Errorf("TigerBeetle commit failed: %w", err)
	}
	defer resp.Body.Close()
	return nil
}

func CreditLoanProceedsActivity(ctx context.Context, input LedgerCreditInput) (*LedgerCreditResult, error) {
	body, _ := json.Marshal(map[string]interface{}{
		"debit_account_id":  "exchange-loan-pool",
		"credit_account_id": fmt.Sprintf("user-settlement-%s", input.UserID),
		"amount":            input.Amount,
		"code":              input.Code,
		"user_data":         input.Reference,
	})
	url := fmt.Sprintf("%s/api/v1/ledger/transfer", gatewayURL())
	req, _ := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return &LedgerCreditResult{}, nil
	}
	defer resp.Body.Close()
	var result LedgerCreditResult
	_ = json.NewDecoder(resp.Body).Decode(&result)
	return &result, nil
}

func MarkLoanActiveActivity(ctx context.Context, input MarkLoanActiveInput) error {
	body, _ := json.Marshal(map[string]interface{}{
		"status":         "ACTIVE",
		"ledger_tx_id":   input.LedgerTxID,
		"external_tx_id": input.ExternalTxID,
		"repayment_date": input.RepaymentDate,
	})
	url := fmt.Sprintf("%s/api/v1/loans/%s/status", gatewayURL(), input.LoanID)
	req, _ := http.NewRequestWithContext(ctx, http.MethodPatch, url, bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil
	}
	defer resp.Body.Close()
	return nil
}

func EmitLoanKafkaEventActivity(ctx context.Context, input KafkaEmitInput) error {
	body, _ := json.Marshal(input)
	url := fmt.Sprintf("%s/api/v1/kafka/emit", gatewayURL())
	req, _ := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil
	}
	defer resp.Body.Close()
	return nil
}

func IngestLoanToLakehouseActivity(ctx context.Context, input LakehouseIngestInput) error {
	input.Payload["_ingested_at"] = time.Now().UTC().Format(time.RFC3339)
	body, _ := json.Marshal(map[string]interface{}{
		"table":   input.Table,
		"records": []map[string]interface{}{input.Payload},
	})
	url := fmt.Sprintf("%s/api/v1/ingest", lakehouseURL())
	req, _ := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil
	}
	defer resp.Body.Close()
	return nil
}

func AlertOpsActivity(ctx context.Context, input AlertInput) error {
	body, _ := json.Marshal(input)
	url := fmt.Sprintf("%s/api/v1/alerts/ops", gatewayURL())
	req, _ := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil
	}
	defer resp.Body.Close()
	return nil
}
