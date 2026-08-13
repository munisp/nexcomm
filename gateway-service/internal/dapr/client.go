package dapr

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sync"
	"time"

	daprClient "github.com/dapr/go-sdk/client"
)

const (
	StateStoreRedis  = "nexcom-statestore"
	PubSubKafka      = "nexcom-pubsub"
	SecretStoreVault = "nexcom-secrets"
)

var ErrUnavailable = errors.New("dapr sidecar unavailable")

// Client is a strict Dapr transport. Durable state, publish, invocation, and
// secret operations either complete through the sidecar or return an error.
type Client struct {
	sdk       daprClient.Client
	grpcPort  string
	httpPort  string
	connected bool
	mu        sync.RWMutex
}

func NewClient(httpPort, grpcPort string) *Client {
	c := &Client{httpPort: httpPort, grpcPort: grpcPort}
	_ = c.connect()
	return c
}

func (c *Client) connect() error {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	sdk, err := daprClient.NewClientWithAddressContext(ctx, fmt.Sprintf("localhost:%s", c.grpcPort))
	if err != nil {
		c.mu.Lock()
		c.connected = false
		c.mu.Unlock()
		return fmt.Errorf("%w: gRPC connection failed: %v", ErrUnavailable, err)
	}
	if _, err := sdk.GetMetadata(ctx); err != nil {
		sdk.Close()
		c.mu.Lock()
		c.connected = false
		c.mu.Unlock()
		return fmt.Errorf("%w: metadata check failed: %v", ErrUnavailable, err)
	}
	c.mu.Lock()
	if c.sdk != nil {
		c.sdk.Close()
	}
	c.sdk = sdk
	c.connected = true
	c.mu.Unlock()
	return nil
}

func (c *Client) requireSDK() (daprClient.Client, error) {
	c.mu.RLock()
	sdk, connected := c.sdk, c.connected
	c.mu.RUnlock()
	if connected && sdk != nil {
		return sdk, nil
	}
	if err := c.connect(); err != nil {
		return nil, err
	}
	c.mu.RLock()
	sdk = c.sdk
	c.mu.RUnlock()
	if sdk == nil {
		return nil, ErrUnavailable
	}
	return sdk, nil
}

func (c *Client) SaveState(storeName, key string, value interface{}) error {
	data, err := json.Marshal(value)
	if err != nil {
		return fmt.Errorf("Dapr SaveState marshal: %w", err)
	}
	sdk, err := c.requireSDK()
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := sdk.SaveState(ctx, storeName, key, data, nil); err != nil {
		return fmt.Errorf("Dapr SaveState: %w", err)
	}
	return nil
}

func (c *Client) GetState(storeName, key string, dest interface{}) error {
	sdk, err := c.requireSDK()
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	item, err := sdk.GetState(ctx, storeName, key, nil)
	if err != nil {
		return fmt.Errorf("Dapr GetState: %w", err)
	}
	if item == nil || len(item.Value) == 0 {
		return errors.New("Dapr state key not found")
	}
	return json.Unmarshal(item.Value, dest)
}

func (c *Client) DeleteState(storeName, key string) error {
	sdk, err := c.requireSDK()
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := sdk.DeleteState(ctx, storeName, key, nil); err != nil {
		return fmt.Errorf("Dapr DeleteState: %w", err)
	}
	return nil
}

func (c *Client) PublishEvent(pubsubName, topic string, data interface{}) error {
	sdk, err := c.requireSDK()
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := sdk.PublishEvent(ctx, pubsubName, topic, data); err != nil {
		return fmt.Errorf("Dapr PublishEvent: %w", err)
	}
	return nil
}

func (c *Client) PublishEvents(pubsubName, topic string, events []interface{}) error {
	sdk, err := c.requireSDK()
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	result := sdk.PublishEvents(ctx, pubsubName, topic, events)
	if result.Error != nil {
		return fmt.Errorf("Dapr PublishEvents: %w", result.Error)
	}
	return nil
}

func (c *Client) InvokeService(appID, method string, data interface{}) ([]byte, error) {
	body, err := json.Marshal(data)
	if err != nil {
		return nil, fmt.Errorf("Dapr InvokeService marshal: %w", err)
	}
	sdk, err := c.requireSDK()
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	result, err := sdk.InvokeMethodWithContent(ctx, appID, method, "POST", &daprClient.DataContent{ContentType: "application/json", Data: body})
	if err != nil {
		return nil, fmt.Errorf("Dapr InvokeService: %w", err)
	}
	return result, nil
}

func (c *Client) GetSecret(storeName, key string) (map[string]string, error) {
	sdk, err := c.requireSDK()
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	result, err := sdk.GetSecret(ctx, storeName, key, nil)
	if err != nil {
		return nil, fmt.Errorf("Dapr GetSecret: %w", err)
	}
	if len(result) == 0 {
		return nil, errors.New("Dapr secret not found")
	}
	return result, nil
}

func (c *Client) IsConnected() bool { c.mu.RLock(); defer c.mu.RUnlock(); return c.connected }
func (c *Client) IsFallback() bool  { return false }
func (c *Client) Close() {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.sdk != nil {
		c.sdk.Close()
		c.sdk = nil
	}
	c.connected = false
}
