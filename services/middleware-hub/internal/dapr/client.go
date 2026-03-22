// Package dapr provides Dapr sidecar integration for NEXCOM.
// Uses Dapr pub/sub for event broadcasting and Dapr state store for distributed caching.
// Dapr abstracts the underlying message broker (Kafka/Redis) and state backend (Redis/PostgreSQL).
package dapr

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"strings"
	"time"

	"go.uber.org/zap"
)

// Dapr pub/sub and state store component names (configured in Dapr component YAML)
const (
	PubSubComponent    = "nexcom-pubsub"      // Backed by Kafka
	StateComponent     = "nexcom-state"       // Backed by Redis
	SecretComponent    = "nexcom-secrets"     // Backed by Vault/K8s secrets
	BindingKafka       = "nexcom-kafka"       // Output binding for Kafka
	BindingPostgres    = "nexcom-postgres"    // Output binding for PostgreSQL
)

// Pub/sub topic names (mirror Kafka topics for cross-component compatibility)
const (
	TopicTrades        = "trade-events"
	TopicSettlements   = "settlement-events"
	TopicKYC           = "kyc-updates"
	TopicNotifications = "notification-events"
	TopicAuditLog      = "audit-log"
	TopicRiskAlerts    = "risk-alerts"
	TopicAMLFlags      = "aml-flags"
)

// Client wraps the Dapr HTTP API for pub/sub, state, and service invocation
type Client struct {
	httpClient *http.Client
	daprPort   string
	appID      string
	logger     *zap.SugaredLogger
}

// NewClient creates a new Dapr HTTP client
func NewClient(logger *zap.SugaredLogger) *Client {
	port := os.Getenv("DAPR_HTTP_PORT")
	if port == "" {
		port = "3500"
	}
	appID := os.Getenv("DAPR_APP_ID")
	if appID == "" {
		appID = "nexcom-middleware-hub"
	}
	return &Client{
		httpClient: &http.Client{Timeout: 10 * time.Second},
		daprPort:   port,
		appID:      appID,
		logger:     logger,
	}
}

// baseURL returns the Dapr sidecar base URL
func (c *Client) baseURL() string {
	return fmt.Sprintf("http://localhost:%s", c.daprPort)
}

// PublishEvent publishes an event to a Dapr pub/sub topic
func (c *Client) PublishEvent(ctx context.Context, topic string, payload interface{}) error {
	data, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("marshal error: %w", err)
	}

	url := fmt.Sprintf("%s/v1.0/publish/%s/%s", c.baseURL(), PubSubComponent, topic)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, strings.NewReader(string(data)))
	if err != nil {
		return fmt.Errorf("request creation error: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("dapr publish error: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusNoContent && resp.StatusCode != http.StatusOK {
		return fmt.Errorf("dapr publish returned status %d", resp.StatusCode)
	}

	c.logger.Debugw("Published Dapr event", "topic", topic, "component", PubSubComponent)
	return nil
}

// SaveState saves a key-value pair to the Dapr state store (Redis-backed)
func (c *Client) SaveState(ctx context.Context, key string, value interface{}) error {
	type stateItem struct {
		Key   string      `json:"key"`
		Value interface{} `json:"value"`
	}

	payload := []stateItem{{Key: key, Value: value}}
	data, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("marshal error: %w", err)
	}

	url := fmt.Sprintf("%s/v1.0/state/%s", c.baseURL(), StateComponent)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, strings.NewReader(string(data)))
	if err != nil {
		return fmt.Errorf("request creation error: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("dapr state save error: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusNoContent && resp.StatusCode != http.StatusOK {
		return fmt.Errorf("dapr state save returned status %d", resp.StatusCode)
	}

	return nil
}

// GetState retrieves a value from the Dapr state store
func (c *Client) GetState(ctx context.Context, key string, dest interface{}) error {
	url := fmt.Sprintf("%s/v1.0/state/%s/%s", c.baseURL(), StateComponent, key)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return fmt.Errorf("request creation error: %w", err)
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("dapr state get error: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusNoContent {
		return nil // Key not found
	}
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("dapr state get returned status %d", resp.StatusCode)
	}

	return json.NewDecoder(resp.Body).Decode(dest)
}

// DeleteState removes a key from the Dapr state store
func (c *Client) DeleteState(ctx context.Context, key string) error {
	url := fmt.Sprintf("%s/v1.0/state/%s/%s", c.baseURL(), StateComponent, key)
	req, err := http.NewRequestWithContext(ctx, http.MethodDelete, url, nil)
	if err != nil {
		return fmt.Errorf("request creation error: %w", err)
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("dapr state delete error: %w", err)
	}
	defer resp.Body.Close()

	return nil
}

// InvokeService invokes a method on another Dapr-enabled service
func (c *Client) InvokeService(ctx context.Context, appID string, method string, payload interface{}) ([]byte, error) {
	data, err := json.Marshal(payload)
	if err != nil {
		return nil, fmt.Errorf("marshal error: %w", err)
	}

	url := fmt.Sprintf("%s/v1.0/invoke/%s/method/%s", c.baseURL(), appID, method)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, strings.NewReader(string(data)))
	if err != nil {
		return nil, fmt.Errorf("request creation error: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("dapr service invocation error: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("dapr invoke returned status %d", resp.StatusCode)
	}

	var result []byte
	buf := make([]byte, 4096)
	for {
		n, err := resp.Body.Read(buf)
		if n > 0 {
			result = append(result, buf[:n]...)
		}
		if err != nil {
			break
		}
	}

	return result, nil
}

// HealthCheck verifies the Dapr sidecar is reachable
func (c *Client) HealthCheck(ctx context.Context) bool {
	url := fmt.Sprintf("%s/v1.0/healthz", c.baseURL())
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return false
	}
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return false
	}
	defer resp.Body.Close()
	return resp.StatusCode == http.StatusNoContent || resp.StatusCode == http.StatusOK
}

// GetMetadata returns Dapr sidecar metadata including loaded components
func (c *Client) GetMetadata(ctx context.Context) (map[string]interface{}, error) {
	url := fmt.Sprintf("%s/v1.0/metadata", c.baseURL())
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	var meta map[string]interface{}
	if err := json.NewDecoder(resp.Body).Decode(&meta); err != nil {
		return nil, err
	}
	return meta, nil
}
