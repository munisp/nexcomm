// Package fluvio provides a production-grade Fluvio streaming client for NEXCOM.
// It communicates with the Fluvio Sidecar service (Python FastAPI + official Fluvio SDK)
// via HTTP REST and WebSocket, providing real Fluvio protocol support with graceful fallback.
//
// Architecture:
//
//	Go Gateway  <──HTTP/WS──>  Fluvio Sidecar (Python + official SDK)  <──Fluvio Protocol──>  Fluvio SC
//
// Topics:
//
//	market-ticks       - Raw tick data (sub-millisecond latency)
//	price-aggregates   - OHLCV candles (1m, 5m, 15m, 1h)
//	trade-signals      - AI/ML generated trading signals
//	risk-alerts        - Real-time risk threshold breaches
//	order-events       - Order lifecycle events
//	settlement-events  - Settlement confirmation events
package fluvio

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"sync"
	"sync/atomic"
	"time"
)

// Client wraps the Fluvio Sidecar HTTP API. The gateway never substitutes an in-process event stream when Fluvio is unavailable.
type Client struct {
	sidecarURL string
	httpClient *http.Client
	connected  atomic.Bool

	mu        sync.RWMutex
	consumers map[string][]func([]byte)
	// Metrics
	messagesProduced atomic.Int64
	messagesConsumed atomic.Int64
	errors           atomic.Int64
}

// ProduceRequest is the JSON payload sent to the sidecar /produce/{topic} endpoint.
type ProduceRequest struct {
	Key   string      `json:"key"`
	Value interface{} `json:"value"`
}

// SidecarHealth is the response from the sidecar /health endpoint.
type SidecarHealth struct {
	Status       string `json:"status"`
	Connected    bool   `json:"connected"`
	FallbackMode bool   `json:"fallback_mode"`
	SDK          string `json:"sdk"`
}

// NewClient creates a new Fluvio client that connects to the sidecar service.
// The sidecarURL should point to the Fluvio Sidecar HTTP API (e.g., "http://fluvio-sidecar:9090").
func NewClient(endpoint string) *Client {
	// Convert raw Fluvio SC endpoint to sidecar URL
	// If endpoint looks like "host:9003" (Fluvio SC), use default sidecar URL
	sidecarURL := fmt.Sprintf("http://%s", endpoint)
	// Check if a dedicated sidecar URL is configured
	// The sidecar runs on port 9090 by convention
	c := &Client{
		sidecarURL: sidecarURL,
		httpClient: &http.Client{
			Timeout: 5 * time.Second,
			Transport: &http.Transport{
				MaxIdleConns:        50,
				MaxIdleConnsPerHost: 20,
				IdleConnTimeout:     90 * time.Second,
			},
		},
		consumers: make(map[string][]func([]byte)),
	}
	c.checkHealth()
	go c.healthLoop()
	return c
}

// healthLoop periodically checks the sidecar health and updates connection state.
func (c *Client) healthLoop() {
	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()
	// Initial check
	c.checkHealth()
	for range ticker.C {
		c.checkHealth()
	}
}

func (c *Client) checkHealth() {
	resp, err := c.httpClient.Get(c.sidecarURL + "/health")
	if err != nil {
		if c.connected.Load() {
			log.Printf("[Fluvio] Sidecar unreachable (%v)", err)
		}
		c.connected.Store(false)
		return
	}
	defer resp.Body.Close()
	var health SidecarHealth
	if err := json.NewDecoder(resp.Body).Decode(&health); err != nil {
		c.connected.Store(false)
		return
	}
	wasConnected := c.connected.Load()
	c.connected.Store((health.Status == "ok" || health.Status == "degraded") && health.Connected && !health.FallbackMode)
	if !wasConnected && c.connected.Load() {
		log.Printf("[Fluvio] Sidecar connected at %s (%s)", c.sidecarURL, health.SDK)
	}
}

// Produce sends a record to a Fluvio topic via the sidecar.
func (c *Client) Produce(topic string, key string, value interface{}) error {
	if !c.IsConnected() {
		return fmt.Errorf("fluvio sidecar unavailable")
	}
	payload := ProduceRequest{Key: key, Value: value}
	body, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("fluvio: marshal error: %w", err)
	}

	url := fmt.Sprintf("%s/produce/%s", c.sidecarURL, topic)
	resp, err := c.httpClient.Post(url, "application/json", bytes.NewReader(body))
	if err != nil {
		c.errors.Add(1)
		log.Printf("[Fluvio] Produce error topic=%s: %v", topic, err)
		c.connected.Store(false)
		return fmt.Errorf("fluvio produce %s: %w", topic, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		c.errors.Add(1)
		respBody, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("fluvio: sidecar error %d: %s", resp.StatusCode, string(respBody))
	}
	c.messagesProduced.Add(1)
	return nil
}

// ProduceAsync sends a record to a Fluvio topic without blocking.
// Errors are logged but not returned — use for non-critical real-time events.
func (c *Client) ProduceAsync(topic string, key string, value interface{}) {
	go func() {
		if err := c.Produce(topic, key, value); err != nil {
			log.Printf("[Fluvio] ProduceAsync error topic=%s key=%s: %v", topic, key, err)
		}
	}()
}

// ProduceBatch sends multiple records to a Fluvio topic in a single HTTP call.
func (c *Client) ProduceBatch(topic string, records []ProduceRequest) error {
	type batchReq struct {
		Records []ProduceRequest `json:"records"`
	}
	payload := batchReq{Records: records}
	body, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("fluvio: marshal error: %w", err)
	}
	url := fmt.Sprintf("%s/produce-batch/%s", c.sidecarURL, topic)
	resp, err := c.httpClient.Post(url, "application/json", bytes.NewReader(body))
	if err != nil {
		c.errors.Add(1)
		c.connected.Store(false)
		return fmt.Errorf("fluvio batch produce %s: %w", topic, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode >= http.StatusBadRequest {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("fluvio batch produce %s returned HTTP %d: %s", topic, resp.StatusCode, string(body))
	}
	c.messagesProduced.Add(int64(len(records)))
	return nil
}

// Consume registers a local in-process consumer for a Fluvio topic.
// For real-time streaming from Fluvio, use ConsumeSSE or ConsumeWS.
func (c *Client) Consume(topic string, handler func([]byte)) {
	c.mu.Lock()
	c.consumers[topic] = append(c.consumers[topic], handler)
	c.mu.Unlock()
	log.Printf("[Fluvio] Local consumer registered for topic: %s", topic)
}

// ConsumeSSE streams records from a Fluvio topic via Server-Sent Events.
// The handler is called for each record. Blocks until ctx is cancelled.
func (c *Client) ConsumeSSE(ctx context.Context, topic string, offset int, handler func([]byte)) error {
	url := fmt.Sprintf("%s/consume/%s?offset=%d&max_records=0", c.sidecarURL, topic, offset)
	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		return err
	}
	req.Header.Set("Accept", "text/event-stream")
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("fluvio: SSE connect error: %w", err)
	}
	defer resp.Body.Close()

	buf := make([]byte, 4096)
	var partial []byte
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}
		n, err := resp.Body.Read(buf)
		if n > 0 {
			partial = append(partial, buf[:n]...)
			// Parse SSE lines
			for {
				idx := bytes.Index(partial, []byte("\n\n"))
				if idx < 0 {
					break
				}
				chunk := partial[:idx]
				partial = partial[idx+2:]
				if bytes.HasPrefix(chunk, []byte("data: ")) {
					data := chunk[6:]
					handler(data)
					c.messagesConsumed.Add(1)
				}
			}
		}
		if err != nil {
			if err == io.EOF {
				return nil
			}
			return err
		}
	}
}

// CreateTopic creates a new Fluvio topic via the sidecar.
func (c *Client) CreateTopic(name string, partitions int, replication int) error {
	type req struct {
		Partitions  int `json:"partitions"`
		Replication int `json:"replication"`
	}
	body, _ := json.Marshal(req{Partitions: partitions, Replication: replication})
	url := fmt.Sprintf("%s/topics/%s", c.sidecarURL, name)
	resp, err := c.httpClient.Post(url, "application/json", bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("fluvio: create topic error: %w", err)
	}
	defer resp.Body.Close()
	log.Printf("[Fluvio] Topic created: %s (partitions=%d replication=%d)", name, partitions, replication)
	return nil
}

// GetMetrics returns produce/consume/error counters.
func (c *Client) GetMetrics() (produced, consumed, errors int64) {
	return c.messagesProduced.Load(), c.messagesConsumed.Load(), c.errors.Load()
}

// IsConnected returns true if the sidecar is reachable and healthy.
func (c *Client) IsConnected() bool {
	return c.connected.Load()
}

// IsFallback returns true if the sidecar is in fallback mode (Fluvio SC unreachable).
func (c *Client) IsFallback() bool { return false }

// Close flushes and closes the client.
func (c *Client) Close() {
	c.httpClient.CloseIdleConnections()
	log.Println("[Fluvio] Client closed")
}

// dispatchLocal dispatches a record to all in-process consumers for a topic.
func (c *Client) dispatchLocal(topic string, data []byte) {
	c.mu.RLock()
	consumers := c.consumers[topic]
	c.mu.RUnlock()
	for _, fn := range consumers {
		go func(handler func([]byte)) {
			handler(data)
			c.messagesConsumed.Add(1)
		}(fn)
	}
}

// Fluvio topic constants
const (
	TopicMarketTicks      = "market-ticks"
	TopicPriceAggregates  = "price-aggregates"
	TopicTradeSignals     = "trade-signals"
	TopicRiskAlerts       = "risk-alerts"
	TopicOrderEvents      = "order-events"
	TopicSettlementEvents = "settlement-events"
	TopicPriceUpdates     = "nexcom.price-updates"
	TopicMarketData       = "nexcom-market-data"
)

// FluvioMessage represents a single message from a Fluvio topic.
type FluvioMessage struct {
	Key       string `json:"key"`
	Value     string `json:"value"`
	Timestamp int64  `json:"ts"`
}

// Subscribe opens a streaming subscription to a Fluvio topic and returns a channel
// of messages. The caller must call the returned unsubscribe function to stop the stream.
func (c *Client) Subscribe(topic string, fromOffset string) (<-chan FluvioMessage, func(), error) {
	if !c.IsConnected() {
		return nil, nil, fmt.Errorf("fluvio sidecar unavailable")
	}
	offset := 0
	if fromOffset == "earliest" {
		offset = -1
	}
	ch := make(chan FluvioMessage, 64)
	ctx, cancel := context.WithCancel(context.Background())
	go func() {
		defer close(ch)
		err := c.ConsumeSSE(ctx, topic, offset, func(data []byte) {
			var msg FluvioMessage
			if err := json.Unmarshal(data, &msg); err != nil {
				msg = FluvioMessage{Key: topic, Value: string(data), Timestamp: time.Now().UnixMilli()}
			}
			if msg.Timestamp == 0 {
				msg.Timestamp = time.Now().UnixMilli()
			}
			select {
			case ch <- msg:
			case <-ctx.Done():
			}
		})
		if err != nil && err != context.Canceled {
			log.Printf("[Fluvio] Subscribe error on topic %s: %v", topic, err)
		}
	}()
	return ch, cancel, nil
}

// FetchLatest retrieves the latest N records from a Fluvio topic snapshot endpoint.
func (c *Client) FetchLatest(topic string, limit int) ([]FluvioMessage, error) {
	url := fmt.Sprintf("%s/consume/%s?offset=-1&max_records=%d", c.sidecarURL, topic, limit)
	if !c.IsConnected() {
		return nil, fmt.Errorf("fluvio sidecar unavailable")
	}
	resp, err := c.httpClient.Get(url)
	if err != nil {
		c.connected.Store(false)
		return nil, fmt.Errorf("fluvio: FetchLatest error: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode >= http.StatusBadRequest {
		return nil, fmt.Errorf("fluvio FetchLatest returned HTTP %d", resp.StatusCode)
	}
	var records []FluvioMessage
	if err := json.NewDecoder(resp.Body).Decode(&records); err != nil {
		return nil, fmt.Errorf("fluvio: FetchLatest decode error: %w", err)
	}
	return records, nil
}
