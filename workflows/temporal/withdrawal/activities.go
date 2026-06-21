// Package withdrawal — Temporal activities for the withdrawal saga.
package withdrawal

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

type IdempotencyCheckResult struct {
	AlreadyProcessed bool      `json:"already_processed"`
	LedgerTxID       string    `json:"ledger_tx_id,omitempty"`
	ProcessedAt      time.Time `json:"processed_at,omitempty"`
}

type BalanceCheckInput struct {
	UserID   string  `json:"user_id"`
	Amount   float64 `json:"amount"`
	Currency string  `json:"currency"`
}

type BalanceCheckResult struct {
	Sufficient      bool    `json:"sufficient"`
	AvailableAmount float64 `json:"available_amount"`
}

type AMLCheckInput struct {
	UserID    string  `json:"user_id"`
	Amount    float64 `json:"amount"`
	Currency  string  `json:"currency"`
	Direction string  `json:"direction"`
}

type AMLCheckResult struct {
	Blocked bool   `json:"blocked"`
	Reason  string `json:"reason,omitempty"`
	Score   int    `json:"score"`
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

type ExternalTransferInput struct {
	WithdrawalID string  `json:"withdrawal_id"`
	UserID       string  `json:"user_id"`
	Amount       float64 `json:"amount"`
	Currency     string  `json:"currency"`
	Channel      string  `json:"channel"`
	Destination  string  `json:"destination"`
	BankCode     string  `json:"bank_code"`
	Reference    string  `json:"reference"`
}

type ExternalTransferResult struct {
	ExternalTxID string `json:"external_tx_id"`
	Status       string `json:"status"`
}

type MarkWithdrawalCompletedInput struct {
	WithdrawalID string `json:"withdrawal_id"`
	LedgerTxID   string `json:"ledger_tx_id"`
	ExternalTxID string `json:"external_tx_id"`
}

type KafkaEmitInput struct {
	Topic   string                 `json:"topic"`
	Payload map[string]interface{} `json:"payload"`
}

type FluvioEmitInput struct {
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

func fluvioURL() string {
	if u := os.Getenv("FLUVIO_ENDPOINT"); u != "" {
		return u
	}
	return "http://localhost:9003"
}

// ─── Activities ───────────────────────────────────────────────────────────────

func CheckWithdrawalIdempotencyActivity(ctx context.Context, withdrawalID string) (*IdempotencyCheckResult, error) {
	url := fmt.Sprintf("%s/api/v1/withdrawals/%s/status", gatewayURL(), withdrawalID)
	resp, err := http.Get(url)
	if err != nil || resp.StatusCode == 404 {
		return &IdempotencyCheckResult{AlreadyProcessed: false}, nil
	}
	defer resp.Body.Close()
	var result IdempotencyCheckResult
	_ = json.NewDecoder(resp.Body).Decode(&result)
	return &result, nil
}

func CheckBalanceActivity(ctx context.Context, input BalanceCheckInput) (*BalanceCheckResult, error) {
	url := fmt.Sprintf("%s/api/v1/ledger/balance/%s?currency=%s", gatewayURL(), input.UserID, input.Currency)
	resp, err := http.Get(url)
	if err != nil {
		return nil, fmt.Errorf("balance check failed: %w", err)
	}
	defer resp.Body.Close()
	var result BalanceCheckResult
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("failed to decode balance response: %w", err)
	}
	result.Sufficient = result.AvailableAmount >= input.Amount
	return &result, nil
}

func AMLVelocityCheckActivity(ctx context.Context, input AMLCheckInput) (*AMLCheckResult, error) {
	body, _ := json.Marshal(input)
	url := fmt.Sprintf("%s/api/v1/aml/velocity-check", gatewayURL())
	resp, err := http.Post(url, "application/json", bytes.NewReader(body))
	if err != nil {
		return &AMLCheckResult{Blocked: false}, nil
	}
	defer resp.Body.Close()
	var result AMLCheckResult
	_ = json.NewDecoder(resp.Body).Decode(&result)
	return &result, nil
}

func CreatePendingDebitActivity(ctx context.Context, input PendingDebitInput) (*PendingTransferResult, error) {
	body, _ := json.Marshal(map[string]interface{}{
		"debit_account_id":  fmt.Sprintf("user-settlement-%s", input.UserID),
		"credit_account_id": "exchange-withdrawals-pool",
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
		return nil, fmt.Errorf("TigerBeetle pending debit failed: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return nil, fmt.Errorf("TigerBeetle gateway returned %d", resp.StatusCode)
	}
	var result PendingTransferResult
	_ = json.NewDecoder(resp.Body).Decode(&result)
	return &result, nil
}

func VoidPendingDebitActivity(ctx context.Context, pendingID string) error {
	body, _ := json.Marshal(map[string]string{"pending_id": pendingID})
	url := fmt.Sprintf("%s/api/v1/ledger/void-pending", gatewayURL())
	req, _ := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return fmt.Errorf("void pending debit failed: %w", err)
	}
	defer resp.Body.Close()
	return nil
}

func MarkWithdrawalProcessingActivity(ctx context.Context, withdrawalID string) error {
	body, _ := json.Marshal(map[string]string{"status": "PROCESSING"})
	url := fmt.Sprintf("%s/api/v1/withdrawals/%s/status", gatewayURL(), withdrawalID)
	req, _ := http.NewRequestWithContext(ctx, http.MethodPatch, url, bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return fmt.Errorf("failed to mark processing: %w", err)
	}
	defer resp.Body.Close()
	return nil
}

func MarkWithdrawalFailedActivity(ctx context.Context, withdrawalID string) error {
	body, _ := json.Marshal(map[string]string{"status": "FAILED"})
	url := fmt.Sprintf("%s/api/v1/withdrawals/%s/status", gatewayURL(), withdrawalID)
	req, _ := http.NewRequestWithContext(ctx, http.MethodPatch, url, bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil
	}
	defer resp.Body.Close()
	return nil
}

func ExecuteExternalTransferActivity(ctx context.Context, input ExternalTransferInput) (*ExternalTransferResult, error) {
	body, _ := json.Marshal(input)
	url := fmt.Sprintf("%s/api/v1/payments/send", gatewayURL())
	req, _ := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("external transfer failed: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return nil, fmt.Errorf("payment gateway returned %d", resp.StatusCode)
	}
	var result ExternalTransferResult
	_ = json.NewDecoder(resp.Body).Decode(&result)
	return &result, nil
}

func CommitPendingDebitActivity(ctx context.Context, input CommitDebitInput) error {
	body, _ := json.Marshal(input)
	url := fmt.Sprintf("%s/api/v1/ledger/commit-pending", gatewayURL())
	req, _ := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return fmt.Errorf("TigerBeetle commit failed: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return fmt.Errorf("TigerBeetle gateway returned %d on commit", resp.StatusCode)
	}
	return nil
}

func MarkWithdrawalCompletedActivity(ctx context.Context, input MarkWithdrawalCompletedInput) error {
	body, _ := json.Marshal(map[string]string{
		"status":        "COMPLETED",
		"ledger_tx_id":  input.LedgerTxID,
		"external_tx_id": input.ExternalTxID,
	})
	url := fmt.Sprintf("%s/api/v1/withdrawals/%s/status", gatewayURL(), input.WithdrawalID)
	req, _ := http.NewRequestWithContext(ctx, http.MethodPatch, url, bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil
	}
	defer resp.Body.Close()
	return nil
}

func EmitWithdrawalKafkaEventActivity(ctx context.Context, input KafkaEmitInput) error {
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

func EmitFluvioEventActivity(ctx context.Context, input FluvioEmitInput) error {
	body, _ := json.Marshal(map[string]interface{}{
		"topic":   input.Topic,
		"records": []map[string]interface{}{{"value": input.Payload}},
	})
	url := fmt.Sprintf("%s/api/v1/produce", fluvioURL())
	req, _ := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	if key := os.Getenv("FLUVIO_API_KEY"); key != "" {
		req.Header.Set("Authorization", "Bearer "+key)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil
	}
	defer resp.Body.Close()
	return nil
}

func IngestWithdrawalToLakehouseActivity(ctx context.Context, input LakehouseIngestInput) error {
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
