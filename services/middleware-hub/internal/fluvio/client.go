// Package fluvio provides a Fluvio streaming client for the NEXCOM middleware hub.
// Fluvio is used for high-throughput, low-latency event streaming of market data ticks,
// order book updates, and trade confirmations — complementing Kafka for real-time feeds.
package fluvio

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"sync"
	"time"
)

// Config holds Fluvio connection settings.
type Config struct {
	Endpoint string // e.g. "localhost:9003" or "fluvio.nexcom.internal:9003"
	TLSEnabled bool
	APIToken   string
}

// DefaultConfig returns config from environment variables.
func DefaultConfig() Config {
	endpoint := os.Getenv("FLUVIO_ENDPOINT")
	if endpoint == "" {
		endpoint = "localhost:9003"
	}
	return Config{
		Endpoint:   endpoint,
		TLSEnabled: os.Getenv("FLUVIO_TLS") == "true",
		APIToken:   os.Getenv("FLUVIO_API_TOKEN"),
	}
}

// Client wraps the Fluvio HTTP/WebSocket API for producing and consuming records.
type Client struct {
	cfg    Config
	http   *http.Client
	mu     sync.Mutex
	topics map[string]bool
}

// NewClient creates a new Fluvio client with the given config.
func NewClient(cfg Config) *Client {
	return &Client{
		cfg:    cfg,
		http:   &http.Client{Timeout: 10 * time.Second},
		topics: make(map[string]bool),
	}
}

// Record represents a Fluvio message.
type Record struct {
	Key     string          `json:"key,omitempty"`
	Value   json.RawMessage `json:"value"`
	Topic   string          `json:"topic"`
	Offset  int64           `json:"offset,omitempty"`
	Timestamp time.Time     `json:"timestamp,omitempty"`
}

// ProduceRequest is the payload for the Fluvio produce API.
type ProduceRequest struct {
	Topic   string   `json:"topic"`
	Records []Record `json:"records"`
}

// Produce sends one or more records to a Fluvio topic.
func (c *Client) Produce(ctx context.Context, topic string, records []Record) error {
	req := ProduceRequest{Topic: topic, Records: records}
	body, err := json.Marshal(req)
	if err != nil {
		return fmt.Errorf("fluvio: marshal produce request: %w", err)
	}

	scheme := "http"
	if c.cfg.TLSEnabled {
		scheme = "https"
	}
	url := fmt.Sprintf("%s://%s/api/v1/produce", scheme, c.cfg.Endpoint)

	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("fluvio: create request: %w", err)
	}
	httpReq.Header.Set("Content-Type", "application/json")
	if c.cfg.APIToken != "" {
		httpReq.Header.Set("Authorization", "Bearer "+c.cfg.APIToken)
	}

	resp, err := c.http.Do(httpReq)
	if err != nil {
		return fmt.Errorf("fluvio: produce HTTP error: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		respBody, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("fluvio: produce failed (status %d): %s", resp.StatusCode, string(respBody))
	}
	return nil
}

// ProduceJSON is a convenience wrapper that marshals value to JSON and produces it.
func (c *Client) ProduceJSON(ctx context.Context, topic string, key string, value any) error {
	raw, err := json.Marshal(value)
	if err != nil {
		return fmt.Errorf("fluvio: marshal value: %w", err)
	}
	return c.Produce(ctx, topic, []Record{{
		Key:       key,
		Value:     raw,
		Topic:     topic,
		Timestamp: time.Now().UTC(),
	}})
}

// ConsumeRequest is the payload for the Fluvio consume API.
type ConsumeRequest struct {
	Topic     string `json:"topic"`
	Partition int    `json:"partition"`
	Offset    int64  `json:"offset"`
	MaxBytes  int    `json:"max_bytes,omitempty"`
}

// ConsumeResponse holds records returned from a consume call.
type ConsumeResponse struct {
	Records    []Record `json:"records"`
	NextOffset int64    `json:"next_offset"`
}

// Consume fetches records from a Fluvio topic starting at the given offset.
func (c *Client) Consume(ctx context.Context, req ConsumeRequest) (*ConsumeResponse, error) {
	scheme := "http"
	if c.cfg.TLSEnabled {
		scheme = "https"
	}
	url := fmt.Sprintf("%s://%s/api/v1/consume?topic=%s&partition=%d&offset=%d",
		scheme, c.cfg.Endpoint, req.Topic, req.Partition, req.Offset)
	if req.MaxBytes > 0 {
		url += fmt.Sprintf("&max_bytes=%d", req.MaxBytes)
	}

	httpReq, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, fmt.Errorf("fluvio: create consume request: %w", err)
	}
	if c.cfg.APIToken != "" {
		httpReq.Header.Set("Authorization", "Bearer "+c.cfg.APIToken)
	}

	resp, err := c.http.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("fluvio: consume HTTP error: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		respBody, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("fluvio: consume failed (status %d): %s", resp.StatusCode, string(respBody))
	}

	var result ConsumeResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("fluvio: decode consume response: %w", err)
	}
	return &result, nil
}

// ─── NEXCOM-specific Topics ──────────────────────────────────────────────────

const (
	TopicMarketTicks   = "nexcom.market.ticks"      // Real-time price ticks
	TopicOrderBook     = "nexcom.market.orderbook"  // Order book depth updates
	TopicTradeConfirms = "nexcom.trades.confirmed"  // Confirmed trade events
	TopicPriceAlerts   = "nexcom.alerts.price"      // Triggered price alerts
	TopicKYCEvents     = "nexcom.kyc.events"        // KYC status change events
	TopicAMLEvents     = "nexcom.aml.events"        // AML alert events
)

// MarketTickEvent represents a real-time price tick for a commodity.
type MarketTickEvent struct {
	Symbol    string    `json:"symbol"`
	Price     float64   `json:"price"`
	Volume    float64   `json:"volume,omitempty"`
	Bid       float64   `json:"bid,omitempty"`
	Ask       float64   `json:"ask,omitempty"`
	Timestamp time.Time `json:"timestamp"`
	Source    string    `json:"source"`
}

// PublishMarketTick publishes a price tick to the market ticks topic.
func (c *Client) PublishMarketTick(ctx context.Context, tick MarketTickEvent) error {
	return c.ProduceJSON(ctx, TopicMarketTicks, tick.Symbol, tick)
}

// TradeConfirmEvent represents a confirmed trade.
type TradeConfirmEvent struct {
	TradeID   string    `json:"trade_id"`
	Symbol    string    `json:"symbol"`
	BuyerID   int       `json:"buyer_id"`
	SellerID  int       `json:"seller_id"`
	Price     float64   `json:"price"`
	Quantity  float64   `json:"quantity"`
	Value     float64   `json:"value"`
	Timestamp time.Time `json:"timestamp"`
}

// PublishTradeConfirm publishes a trade confirmation event.
func (c *Client) PublishTradeConfirm(ctx context.Context, trade TradeConfirmEvent) error {
	return c.ProduceJSON(ctx, TopicTradeConfirms, trade.TradeID, trade)
}

// HealthCheck verifies the Fluvio endpoint is reachable.
func (c *Client) HealthCheck(ctx context.Context) error {
	scheme := "http"
	if c.cfg.TLSEnabled {
		scheme = "https"
	}
	url := fmt.Sprintf("%s://%s/health", scheme, c.cfg.Endpoint)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return err
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return fmt.Errorf("fluvio: health check failed: %w", err)
	}
	resp.Body.Close()
	if resp.StatusCode >= 400 {
		return fmt.Errorf("fluvio: health check returned %d", resp.StatusCode)
	}
	return nil
}
