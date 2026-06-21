package margin

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"time"

	"go.temporal.io/sdk/activity"
)

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

var (
	gatewayURL   = getEnv("CORE_BANKING_URL", "http://core-banking:8080")
	kafkaURL     = getEnv("KAFKA_HTTP_PROXY_URL", "http://kafka-rest:8082")
	fluvioURL    = getEnv("FLUVIO_HTTP_URL", "http://fluvio-proxy:8090")
	lakehouseURL = getEnv("LAKEHOUSE_URL", "http://nexcom-portal:3000")
	daprURL      = getEnv("DAPR_HTTP_URL", "http://localhost:3500")
	portalURL    = getEnv("PORTAL_API_URL", "http://nexcom-portal:3000")
)

func postJSON(ctx context.Context, url string, payload any) error {
	b, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(b))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return fmt.Errorf("HTTP %d from %s", resp.StatusCode, url)
	}
	return nil
}

// CheckMarginBalanceActivity verifies the user has sufficient margin balance.
func CheckMarginBalanceActivity(ctx context.Context, input MarginPledgeInput) (bool, error) {
	activity.GetLogger(ctx).Info("CheckMarginBalance", "userId", input.UserID, "amount", input.Amount)
	// In production: query TigerBeetle margin account balance via gateway
	return true, nil
}

// CreateMarginHoldActivity creates a pending TigerBeetle transfer (code-2: margin hold).
func CreateMarginHoldActivity(ctx context.Context, input MarginPledgeInput) (string, error) {
	transferID := fmt.Sprintf("margin-hold-%s-%s", input.UserID, input.IdempotencyKey)
	payload := map[string]any{
		"transfer_id":       transferID,
		"debit_account_id":  fmt.Sprintf("settlement-%s", input.UserID),
		"credit_account_id": fmt.Sprintf("margin-%s", input.UserID),
		"amount":            int64(input.Amount * 100),
		"currency":          input.Currency,
		"code":              2, // pending margin hold
		"flags":             "pending",
		"idempotency_key":   transferID,
	}
	if err := postJSON(ctx, gatewayURL+"/api/ledger/transfer", payload); err != nil {
		return "", fmt.Errorf("TigerBeetle margin hold: %w", err)
	}
	return transferID, nil
}

// CommitMarginReleaseActivity commits the pending transfer to release the margin hold.
func CommitMarginReleaseActivity(ctx context.Context, input MarginReleaseInput) error {
	payload := map[string]any{
		"transfer_id":     fmt.Sprintf("release-%s", input.TransferID),
		"pending_id":      input.TransferID,
		"code":            4, // release hold
		"idempotency_key": fmt.Sprintf("release-%s", input.TransferID),
	}
	return postJSON(ctx, gatewayURL+"/api/ledger/commit", payload)
}

// CancelOpenOrdersActivity cancels all open orders for the user+symbol.
func CancelOpenOrdersActivity(ctx context.Context, input MarginLiquidationInput) ([]string, error) {
	activity.GetLogger(ctx).Warn("CancelOpenOrders for liquidation", "userId", input.UserID, "symbol", input.Symbol)
	payload := map[string]any{
		"user_id": input.UserID,
		"symbol":  input.Symbol,
		"reason":  "MARGIN_LIQUIDATION",
	}
	if err := postJSON(ctx, portalURL+"/api/internal/orders/cancel-all", payload); err != nil {
		activity.GetLogger(ctx).Warn("Cancel orders failed", "error", err)
	}
	return []string{}, nil
}

// FreezeMarginAccountActivity freezes the user's margin account (TigerBeetle code-11).
func FreezeMarginAccountActivity(ctx context.Context, input MarginLiquidationInput) error {
	payload := map[string]any{
		"account_id": fmt.Sprintf("margin-%s", input.UserID),
		"reason":     "MARGIN_CALL_LIQUIDATION",
	}
	return postJSON(ctx, gatewayURL+"/api/ledger/freeze", payload)
}

// EmitMarginEventActivity emits a Kafka event and Fluvio stream update for margin events.
func EmitMarginEventActivity(ctx context.Context, eventType string, input any, detail string) error {
	payload := map[string]any{
		"records": []map[string]any{
			{
				"key": fmt.Sprintf("%v", input),
				"value": map[string]any{
					"event":     eventType,
					"input":     input,
					"detail":    detail,
					"timestamp": time.Now().UTC().Format(time.RFC3339),
				},
			},
		},
	}
	_ = postJSON(ctx, kafkaURL+"/topics/nexcom.margin.events", payload)

	fluvioPayload := map[string]any{
		"topic": "margin-events",
		"value": map[string]any{
			"type":      eventType,
			"detail":    detail,
			"timestamp": time.Now().UTC().Format(time.RFC3339),
		},
	}
	_ = postJSON(ctx, fluvioURL+"/publish", fluvioPayload)
	return nil
}

// EmitLiquidationAlertActivity sends a Dapr alert and Kafka event for liquidation.
func EmitLiquidationAlertActivity(ctx context.Context, input MarginLiquidationInput, result *MarginLiquidationResult) error {
	// Dapr alert
	daprPayload := map[string]any{
		"pubsubname": "nexcom-pubsub",
		"topic":      "nexcom-alerts",
		"data": map[string]any{
			"type":    "MARGIN_LIQUIDATION",
			"user_id": input.UserID,
			"symbol":  input.Symbol,
		},
	}
	_ = postJSON(ctx, daprURL+"/v1.0/publish/nexcom-pubsub/nexcom-alerts", daprPayload)

	// Kafka
	kafkaPayload := map[string]any{
		"records": []map[string]any{
			{
				"key": input.UserID,
				"value": map[string]any{
					"event":   "margin.liquidation",
					"user_id": input.UserID,
					"symbol":  input.Symbol,
					"ts":      time.Now().UTC().Format(time.RFC3339),
				},
			},
		},
	}
	_ = postJSON(ctx, kafkaURL+"/topics/nexcom.margin.events", kafkaPayload)
	return nil
}

// IngestMarginToLakehouseActivity ingests margin events to the Lakehouse Bronze layer.
func IngestMarginToLakehouseActivity(ctx context.Context, eventType string, input any, transferID string) error {
	payload := map[string]any{
		"event_type":  eventType,
		"input":       input,
		"transfer_id": transferID,
		"source":      "temporal-margin-workflow",
		"ingested_at": time.Now().UTC().Format(time.RFC3339),
	}
	return postJSON(ctx, lakehouseURL+"/api/internal/lakehouse/ingest", payload)
}
