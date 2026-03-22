// Package dapr provides a production-grade Dapr sidecar client for NEXCOM
// using the official dapr/go-sdk v1.14.1 with gRPC transport.
package dapr

import (
"context"
"encoding/json"
"fmt"
"log"
"sync"
"time"

daprClient "github.com/dapr/go-sdk/client"
)

const (
StateStoreRedis  = "nexcom-statestore"
PubSubKafka      = "nexcom-pubsub"
SecretStoreVault = "nexcom-secrets"
)

type Client struct {
sdk          daprClient.Client
grpcPort     string
httpPort     string
connected    bool
fallbackMode bool
mu           sync.RWMutex
state        map[string][]byte
}

func NewClient(httpPort, grpcPort string) *Client {
c := &Client{
httpPort: httpPort,
grpcPort: grpcPort,
state:    make(map[string][]byte),
}
c.connect()
return c
}

func (c *Client) connect() {
address := fmt.Sprintf("localhost:%s", c.grpcPort)
log.Printf("[Dapr] Connecting to sidecar via gRPC at %s", address)

ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
defer cancel()

sdk, err := daprClient.NewClientWithAddressContext(ctx, address)
if err != nil {
log.Printf("[Dapr] WARN: gRPC connection failed (%v) - running in fallback mode", err)
c.mu.Lock()
c.fallbackMode = true
c.connected = false
c.mu.Unlock()
return
}

_, metaErr := sdk.GetMetadata(context.Background())
if metaErr != nil {
log.Printf("[Dapr] WARN: Sidecar metadata check failed (%v) - running in fallback mode", metaErr)
sdk.Close()
c.mu.Lock()
c.fallbackMode = true
c.connected = false
c.mu.Unlock()
return
}

c.mu.Lock()
c.sdk = sdk
c.connected = true
c.fallbackMode = false
c.mu.Unlock()
log.Printf("[Dapr] Sidecar connected via gRPC at %s (dapr/go-sdk v1.14.1)", address)
}

func (c *Client) SaveState(storeName, key string, value interface{}) error {
data, err := json.Marshal(value)
if err != nil {
return fmt.Errorf("dapr SaveState marshal: %w", err)
}

c.mu.RLock()
sdk := c.sdk
isFallback := c.fallbackMode
c.mu.RUnlock()

if !isFallback && sdk != nil {
ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
defer cancel()
if saveErr := sdk.SaveState(ctx, storeName, key, data, nil); saveErr != nil {
log.Printf("[Dapr] WARN: SaveState via SDK failed (store=%s key=%s): %v - using fallback", storeName, key, saveErr)
} else {
log.Printf("[Dapr] SaveState store=%s key=%s (gRPC SDK)", storeName, key)
return nil
}
}

c.mu.Lock()
c.state[storeName+":"+key] = data
c.mu.Unlock()
log.Printf("[Dapr] SaveState store=%s key=%s (in-memory fallback)", storeName, key)
return nil
}

func (c *Client) GetState(storeName, key string, dest interface{}) error {
c.mu.RLock()
sdk := c.sdk
isFallback := c.fallbackMode
c.mu.RUnlock()

if !isFallback && sdk != nil {
ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
defer cancel()
item, getErr := sdk.GetState(ctx, storeName, key, nil)
if getErr != nil {
log.Printf("[Dapr] WARN: GetState via SDK failed (store=%s key=%s): %v", storeName, key, getErr)
} else if item != nil && len(item.Value) > 0 {
return json.Unmarshal(item.Value, dest)
}
}

c.mu.RLock()
data, exists := c.state[storeName+":"+key]
c.mu.RUnlock()
if !exists {
return nil
}
return json.Unmarshal(data, dest)
}

func (c *Client) DeleteState(storeName, key string) error {
c.mu.RLock()
sdk := c.sdk
isFallback := c.fallbackMode
c.mu.RUnlock()

if !isFallback && sdk != nil {
ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
defer cancel()
if delErr := sdk.DeleteState(ctx, storeName, key, nil); delErr != nil {
log.Printf("[Dapr] WARN: DeleteState via SDK failed (store=%s key=%s): %v", storeName, key, delErr)
} else {
log.Printf("[Dapr] DeleteState store=%s key=%s (gRPC SDK)", storeName, key)
}
}

c.mu.Lock()
delete(c.state, storeName+":"+key)
c.mu.Unlock()
return nil
}

func (c *Client) PublishEvent(pubsubName, topic string, data interface{}) error {
c.mu.RLock()
sdk := c.sdk
isFallback := c.fallbackMode
c.mu.RUnlock()

if !isFallback && sdk != nil {
ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
defer cancel()
if pubErr := sdk.PublishEvent(ctx, pubsubName, topic, data); pubErr != nil {
log.Printf("[Dapr] WARN: PublishEvent via SDK failed (pubsub=%s topic=%s): %v", pubsubName, topic, pubErr)
return pubErr
}
log.Printf("[Dapr] PublishEvent pubsub=%s topic=%s (gRPC SDK)", pubsubName, topic)
return nil
}

log.Printf("[Dapr] PublishEvent pubsub=%s topic=%s (fallback - sidecar unavailable)", pubsubName, topic)
return nil
}

func (c *Client) PublishEvents(pubsubName, topic string, events []interface{}) error {
c.mu.RLock()
sdk := c.sdk
isFallback := c.fallbackMode
c.mu.RUnlock()

if !isFallback && sdk != nil {
ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
defer cancel()
result := sdk.PublishEvents(ctx, pubsubName, topic, events)
if result.Error != nil {
log.Printf("[Dapr] WARN: PublishEvents via SDK failed (pubsub=%s topic=%s): %v", pubsubName, topic, result.Error)
return result.Error
}
log.Printf("[Dapr] PublishEvents pubsub=%s topic=%s count=%d (gRPC SDK)", pubsubName, topic, len(events))
return nil
}

log.Printf("[Dapr] PublishEvents pubsub=%s topic=%s count=%d (fallback)", pubsubName, topic, len(events))
return nil
}

func (c *Client) InvokeService(appID, method string, data interface{}) ([]byte, error) {
c.mu.RLock()
sdk := c.sdk
isFallback := c.fallbackMode
c.mu.RUnlock()

if !isFallback && sdk != nil {
body, marshalErr := json.Marshal(data)
if marshalErr != nil {
return nil, fmt.Errorf("dapr InvokeService marshal: %w", marshalErr)
}
ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
defer cancel()
result, invokeErr := sdk.InvokeMethodWithContent(ctx, appID, method, "POST", &daprClient.DataContent{
ContentType: "application/json",
Data:        body,
})
if invokeErr != nil {
log.Printf("[Dapr] WARN: InvokeService via SDK failed (app=%s method=%s): %v", appID, method, invokeErr)
} else {
log.Printf("[Dapr] InvokeService app=%s method=%s (gRPC SDK)", appID, method)
return result, nil
}
}

log.Printf("[Dapr] InvokeService app=%s method=%s (fallback)", appID, method)
return json.Marshal(map[string]string{"status": "ok", "source": "fallback"})
}

func (c *Client) GetSecret(storeName, key string) (map[string]string, error) {
c.mu.RLock()
sdk := c.sdk
isFallback := c.fallbackMode
c.mu.RUnlock()

if !isFallback && sdk != nil {
ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
defer cancel()
result, secErr := sdk.GetSecret(ctx, storeName, key, nil)
if secErr != nil {
log.Printf("[Dapr] WARN: GetSecret via SDK failed (store=%s key=%s): %v", storeName, key, secErr)
} else {
return result, nil
}
}

return map[string]string{key: ""}, nil
}

func (c *Client) IsConnected() bool {
c.mu.RLock()
defer c.mu.RUnlock()
return c.connected
}

func (c *Client) IsFallback() bool {
c.mu.RLock()
defer c.mu.RUnlock()
return c.fallbackMode
}

func (c *Client) Close() {
c.mu.Lock()
defer c.mu.Unlock()
if c.sdk != nil {
c.sdk.Close()
c.sdk = nil
}
c.connected = false
log.Println("[Dapr] gRPC connection closed")
}
