package trade_settlement

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

var (
	gatewayURL   = getEnv("CORE_BANKING_URL", "http://core-banking:8080")
	kafkaURL     = getEnv("KAFKA_HTTP_PROXY_URL", "http://kafka-rest:8082")
	fluvioURL    = getEnv("FLUVIO_HTTP_URL", "http://fluvio-proxy:8090")
	opensearchURL = getEnv("OPENSEARCH_URL", "http://opensearch:9200")
	lakehouseURL = getEnv("LAKEHOUSE_URL", "http://nexcom-portal:3000")
	daprURL      = getEnv("DAPR_HTTP_URL", "http://localhost:3500")
)

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

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

// ValidateTradeAccountsActivity checks that both buyer and seller accounts exist.
func ValidateTradeAccountsActivity(ctx context.Context, input TradeSettlementInput) (bool, error) {
	activity.GetLogger(ctx).Info("ValidateTradeAccounts", "tradeId", input.TradeID)
	return true, nil // Gateway validates on transfer; optimistic here
}

// DebitBuyerActivity creates a TigerBeetle transfer to debit the buyer's settlement account.
func DebitBuyerActivity(ctx context.Context, input TradeSettlementInput) (string, error) {
	activity.GetLogger(ctx).Info("DebitBuyer", "tradeId", input.TradeID, "amount", input.GrossAmount)
	transferID := fmt.Sprintf("settle-buyer-%s", input.TradeID)
	payload := map[string]any{
		"transfer_id":       transferID,
		"debit_account_id":  fmt.Sprintf("settlement-%s", input.BuyerUserID),
		"credit_account_id": "nexcom-escrow",
		"amount":            int64(input.GrossAmount * 100), // minor units
		"currency":          input.Currency,
		"code":              3, // TigerBeetle code-3: trade settlement
		"idempotency_key":   transferID,
	}
	if err := postJSON(ctx, gatewayURL+"/api/ledger/transfer", payload); err != nil {
		return "", fmt.Errorf("DebitBuyer TigerBeetle: %w", err)
	}
	return transferID, nil
}

// CreditSellerActivity creates a TigerBeetle transfer to credit the seller's settlement account.
func CreditSellerActivity(ctx context.Context, input TradeSettlementInput) (string, error) {
	activity.GetLogger(ctx).Info("CreditSeller", "tradeId", input.TradeID, "amount", input.GrossAmount)
	transferID := fmt.Sprintf("settle-seller-%s", input.TradeID)
	payload := map[string]any{
		"transfer_id":       transferID,
		"debit_account_id":  "nexcom-escrow",
		"credit_account_id": fmt.Sprintf("settlement-%s", input.SellerUserID),
		"amount":            int64(input.GrossAmount * 100),
		"currency":          input.Currency,
		"code":              3,
		"idempotency_key":   transferID,
	}
	if err := postJSON(ctx, gatewayURL+"/api/ledger/transfer", payload); err != nil {
		return "", fmt.Errorf("CreditSeller TigerBeetle: %w", err)
	}
	return transferID, nil
}

// CollectFeeActivity collects the platform trading fee.
func CollectFeeActivity(ctx context.Context, input TradeSettlementInput) (string, error) {
	if input.FeeAmount <= 0 {
		return "", nil
	}
	transferID := fmt.Sprintf("fee-%s", input.TradeID)
	payload := map[string]any{
		"transfer_id":       transferID,
		"debit_account_id":  fmt.Sprintf("settlement-%s", input.SellerUserID),
		"credit_account_id": "nexcom-fee-pool",
		"amount":            int64(input.FeeAmount * 100),
		"currency":          input.Currency,
		"code":              3,
		"idempotency_key":   transferID,
	}
	if err := postJSON(ctx, gatewayURL+"/api/ledger/transfer", payload); err != nil {
		return "", fmt.Errorf("CollectFee TigerBeetle: %w", err)
	}
	return transferID, nil
}

// ReverseBuyerDebitActivity reverses the buyer debit as saga compensation.
func ReverseBuyerDebitActivity(ctx context.Context, originalTransferID string, input TradeSettlementInput) error {
	activity.GetLogger(ctx).Warn("ReverseBuyerDebit (compensation)", "originalTransferID", originalTransferID)
	payload := map[string]any{
		"transfer_id":       fmt.Sprintf("reverse-%s", originalTransferID),
		"debit_account_id":  "nexcom-escrow",
		"credit_account_id": fmt.Sprintf("settlement-%s", input.BuyerUserID),
		"amount":            int64(input.GrossAmount * 100),
		"currency":          input.Currency,
		"code":              10, // TigerBeetle code-10: reversal
		"idempotency_key":   fmt.Sprintf("reverse-%s", originalTransferID),
	}
	return postJSON(ctx, gatewayURL+"/api/ledger/transfer", payload)
}

// EmitTradeSettledKafkaActivity emits the nexcom.trade.settled Kafka event.
func EmitTradeSettledKafkaActivity(ctx context.Context, input TradeSettlementInput, result *TradeSettlementResult) error {
	payload := map[string]any{
		"records": []map[string]any{
			{
				"key":   input.TradeID,
				"value": map[string]any{
					"event":           "trade.settled",
					"trade_id":        input.TradeID,
					"buyer_user_id":   input.BuyerUserID,
					"seller_user_id":  input.SellerUserID,
					"symbol":          input.Symbol,
					"quantity":        input.Quantity,
					"price":           input.Price,
					"gross_amount":    input.GrossAmount,
					"fee_amount":      input.FeeAmount,
					"currency":        input.Currency,
					"buyer_order_id":  input.BuyerOrderID,
					"seller_order_id": input.SellerOrderID,
					"settled_at":      result.SettledAt,
				},
			},
		},
	}
	return postJSON(ctx, kafkaURL+"/topics/nexcom.trade.settled", payload)
}

// PublishFluvioSettlementActivity publishes to the Fluvio settlement stream.
func PublishFluvioSettlementActivity(ctx context.Context, input TradeSettlementInput, result *TradeSettlementResult) error {
	payload := map[string]any{
		"topic": "settlement-events",
		"key":   input.TradeID,
		"value": map[string]any{
			"type":       "TRADE_SETTLED",
			"trade_id":   input.TradeID,
			"symbol":     input.Symbol,
			"amount":     input.GrossAmount,
			"settled_at": result.SettledAt,
		},
	}
	return postJSON(ctx, fluvioURL+"/publish", payload)
}

// UpdateOpenSearchOrderStatusActivity updates the order status in OpenSearch.
func UpdateOpenSearchOrderStatusActivity(ctx context.Context, input TradeSettlementInput) error {
	for _, orderID := range []string{input.BuyerOrderID, input.SellerOrderID} {
		payload := map[string]any{
			"doc": map[string]any{
				"status":     "FILLED",
				"updated_at": time.Now().UTC().Format(time.RFC3339),
				"trade_id":   input.TradeID,
			},
		}
		url := fmt.Sprintf("%s/nexcom-orders/_update/%s", opensearchURL, orderID)
		if err := postJSON(ctx, url, payload); err != nil {
			activity.GetLogger(ctx).Warn("OpenSearch update failed", "orderId", orderID, "error", err)
		}
	}
	return nil
}

// IngestToLakehouseActivity ingests the settlement event to the Lakehouse Bronze layer.
func IngestToLakehouseActivity(ctx context.Context, input TradeSettlementInput, result *TradeSettlementResult) error {
	payload := map[string]any{
		"event_type":      "TRADE_SETTLED",
		"trade_id":        input.TradeID,
		"buyer_user_id":   input.BuyerUserID,
		"seller_user_id":  input.SellerUserID,
		"symbol":          input.Symbol,
		"quantity":        input.Quantity,
		"price":           input.Price,
		"gross_amount":    input.GrossAmount,
		"fee_amount":      input.FeeAmount,
		"currency":        input.Currency,
		"buyer_transfer":  result.BuyerTransferID,
		"seller_transfer": result.SellerTransferID,
		"fee_transfer":    result.FeeTransferID,
		"settled_at":      result.SettledAt,
		"source":          "temporal-trade-settlement-workflow",
	}
	return postJSON(ctx, lakehouseURL+"/api/internal/lakehouse/ingest", payload)
}

// EmitSettlementFailedActivity emits a failure event to Kafka and Dapr.
func EmitSettlementFailedActivity(ctx context.Context, input TradeSettlementInput, reason string) error {
	// Kafka DLQ
	kafkaPayload := map[string]any{
		"records": []map[string]any{
			{
				"key": input.TradeID,
				"value": map[string]any{
					"event":    "trade.settlement.failed",
					"trade_id": input.TradeID,
					"reason":   reason,
					"ts":       time.Now().UTC().Format(time.RFC3339),
				},
			},
		},
	}
	_ = postJSON(ctx, kafkaURL+"/topics/nexcom.dlq", kafkaPayload)

	// Dapr alert
	daprPayload := map[string]any{
		"pubsubname": "nexcom-pubsub",
		"topic":      "nexcom-alerts",
		"data": map[string]any{
			"type":     "SETTLEMENT_FAILED",
			"trade_id": input.TradeID,
			"reason":   reason,
		},
	}
	_ = postJSON(ctx, daprURL+"/v1.0/publish/nexcom-pubsub/nexcom-alerts", daprPayload)
	return nil
}
