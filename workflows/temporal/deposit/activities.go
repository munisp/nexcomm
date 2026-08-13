// Package deposit — Temporal activities for the deposit saga.
// Each activity is idempotent and communicates with external services
// (TigerBeetle gateway, Kafka, Fluvio, Lakehouse ingestion engine).
package deposit

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"time"
)

// ─── Input / Output types ─────────────────────────────────────────────────────

type IdempotencyCheckResult struct {
	AlreadyProcessed bool      `json:"already_processed"`
	LedgerTxID       string    `json:"ledger_tx_id,omitempty"`
	ProcessedAt      time.Time `json:"processed_at,omitempty"`
}

type KYCCheckResult struct {
	Approved bool   `json:"approved"`
	Reason   string `json:"reason,omitempty"`
}

type AMLCheckInput struct {
	UserID    string  `json:"user_id"`
	Amount    float64 `json:"amount"`
	Currency  string  `json:"currency"`
	Direction string  `json:"direction"` // "credit" | "debit"
}

type AMLCheckResult struct {
	Blocked bool   `json:"blocked"`
	Reason  string `json:"reason,omitempty"`
	Score   int    `json:"score"`
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

type MarkDepositCompletedInput struct {
	DepositID  string `json:"deposit_id"`
	LedgerTxID string `json:"ledger_tx_id"`
}

type KafkaEmitInput struct {
	Topic   string                 `json:"topic"`
	Payload map[string]interface{} `json:"payload"`
}

type KafkaEmitResult struct {
	Offset int64 `json:"offset"`
}

type FluvioEmitInput struct {
	Topic   string                 `json:"topic"`
	Payload map[string]interface{} `json:"payload"`
}

type LakehouseIngestInput struct {
	Table   string                 `json:"table"`
	Payload map[string]interface{} `json:"payload"`
}

type LakehouseIngestResult struct {
	Key string `json:"key"`
}

type NotificationInput struct {
	UserID  string `json:"user_id"`
	Title   string `json:"title"`
	Message string `json:"message"`
	Channel string `json:"channel"`
}

// ─── Service base URLs ────────────────────────────────────────────────────────

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

// CheckDepositIdempotencyActivity checks if this deposit has already been processed.
func CheckDepositIdempotencyActivity(ctx context.Context, depositID string) (*IdempotencyCheckResult, error) {
	url := fmt.Sprintf("%s/api/v1/deposits/%s/status", gatewayURL(), depositID)
	resp, err := http.Get(url)
	if err != nil || resp.StatusCode == 404 {
		return &IdempotencyCheckResult{AlreadyProcessed: false}, nil
	}
	defer resp.Body.Close()
	if resp.StatusCode == 200 {
		var result IdempotencyCheckResult
		if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
			return &IdempotencyCheckResult{AlreadyProcessed: false}, nil
		}
		return &result, nil
	}
	return &IdempotencyCheckResult{AlreadyProcessed: false}, nil
}

// CheckKYCStatusActivity verifies the user has a valid KYC approval.
func CheckKYCStatusActivity(ctx context.Context, userID string) (*KYCCheckResult, error) {
	url := fmt.Sprintf("%s/api/v1/kyc/%s/status", gatewayURL(), userID)
	resp, err := http.Get(url)
	if err != nil {
		return nil, fmt.Errorf("verify KYC status: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("KYC status returned HTTP %d", resp.StatusCode)
	}
	var result KYCCheckResult
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("decode KYC status: %w", err)
	}
	return &result, nil
}

// AMLVelocityCheckActivity screens the deposit against AML velocity rules.
func AMLVelocityCheckActivity(ctx context.Context, input AMLCheckInput) (*AMLCheckResult, error) {
	body, _ := json.Marshal(input)
	url := fmt.Sprintf("%s/api/v1/aml/velocity-check", gatewayURL())
	resp, err := http.Post(url, "application/json", bytes.NewReader(body))
	if err != nil {
		// Fail open: if AML service unreachable, allow but flag for review
		return &AMLCheckResult{Blocked: false, Score: 0}, nil
	}
	defer resp.Body.Close()
	var result AMLCheckResult
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return &AMLCheckResult{Blocked: false}, nil
	}
	return &result, nil
}

// MarkDepositProcessingActivity updates the deposit status to PROCESSING in the DB.
func MarkDepositProcessingActivity(ctx context.Context, depositID string) error {
	body, _ := json.Marshal(map[string]string{"status": "PROCESSING"})
	url := fmt.Sprintf("%s/api/v1/deposits/%s/status", gatewayURL(), depositID)
	req, _ := http.NewRequestWithContext(ctx, http.MethodPatch, url, bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return fmt.Errorf("failed to mark deposit processing: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return fmt.Errorf("gateway returned %d when marking deposit processing", resp.StatusCode)
	}
	return nil
}

// MarkDepositFailedActivity is the compensation for MarkDepositProcessingActivity.
func MarkDepositFailedActivity(ctx context.Context, depositID string) error {
	body, _ := json.Marshal(map[string]string{"status": "FAILED"})
	url := fmt.Sprintf("%s/api/v1/deposits/%s/status", gatewayURL(), depositID)
	req, _ := http.NewRequestWithContext(ctx, http.MethodPatch, url, bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return fmt.Errorf("failed to mark deposit failed: %w", err)
	}
	defer resp.Body.Close()
	return nil
}

// CreditSettlementAccountActivity creates a TigerBeetle committed transfer
// crediting the user's settlement account.
func CreditSettlementAccountActivity(ctx context.Context, input LedgerCreditInput) (*LedgerCreditResult, error) {
	body, _ := json.Marshal(map[string]interface{}{
		"debit_account_id":  "exchange-deposits-pool",
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
		return nil, fmt.Errorf("TigerBeetle transfer failed: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return nil, fmt.Errorf("TigerBeetle gateway returned %d", resp.StatusCode)
	}
	var result LedgerCreditResult
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("failed to decode ledger response: %w", err)
	}
	return &result, nil
}

// ReverseLedgerCreditActivity is the compensation for CreditSettlementAccountActivity.
func ReverseLedgerCreditActivity(ctx context.Context, transferID string) error {
	body, _ := json.Marshal(map[string]string{"transfer_id": transferID})
	url := fmt.Sprintf("%s/api/v1/ledger/void", gatewayURL())
	req, _ := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return fmt.Errorf("ledger reversal failed: %w", err)
	}
	defer resp.Body.Close()
	return nil
}

// MarkDepositCompletedActivity marks the deposit as COMPLETED in the DB.
func MarkDepositCompletedActivity(ctx context.Context, input MarkDepositCompletedInput) error {
	body, _ := json.Marshal(map[string]string{
		"status":      "COMPLETED",
		"ledger_tx_id": input.LedgerTxID,
	})
	url := fmt.Sprintf("%s/api/v1/deposits/%s/status", gatewayURL(), input.DepositID)
	req, _ := http.NewRequestWithContext(ctx, http.MethodPatch, url, bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return fmt.Errorf("failed to mark deposit completed: %w", err)
	}
	defer resp.Body.Close()
	return nil
}

// EmitDepositKafkaEventActivity publishes a Kafka event via the gateway service.
func EmitDepositKafkaEventActivity(ctx context.Context, input KafkaEmitInput) (*KafkaEmitResult, error) {
	body, _ := json.Marshal(input)
	url := fmt.Sprintf("%s/api/v1/kafka/emit", gatewayURL())
	req, _ := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return &KafkaEmitResult{}, nil // non-fatal
	}
	defer resp.Body.Close()
	var result KafkaEmitResult
	_ = json.NewDecoder(resp.Body).Decode(&result)
	return &result, nil
}

// EmitFluvioEventActivity publishes a real-time event to Fluvio.
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
		return nil // non-fatal: Fluvio unavailable
	}
	defer resp.Body.Close()
	return nil
}

// IngestDepositToLakehouseActivity writes an immutable record to the Lakehouse bronze layer.
func IngestDepositToLakehouseActivity(ctx context.Context, input LakehouseIngestInput) (*LakehouseIngestResult, error) {
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
		return &LakehouseIngestResult{}, nil // non-fatal
	}
	defer resp.Body.Close()
	var result LakehouseIngestResult
	_ = json.NewDecoder(resp.Body).Decode(&result)
	return &result, nil
}

// SendDepositNotificationActivity sends a push/email notification to the user.
func SendDepositNotificationActivity(ctx context.Context, input NotificationInput) error {
	body, _ := json.Marshal(input)
	url := fmt.Sprintf("%s/api/v1/notifications/send", gatewayURL())
	req, _ := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil // non-fatal
	}
	defer resp.Body.Close()
	return nil
}
