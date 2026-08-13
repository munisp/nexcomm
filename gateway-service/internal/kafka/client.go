// Package kafka provides a production-grade Kafka client for NEXCOM Exchange.
// Uses the official segmentio/kafka-go library with real Kafka protocol frames,
// consumer groups, and LZ4 compression. Broker delivery failures are surfaced
// to callers; the gateway never substitutes an in-memory event bus.
package kafka

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"strings"
	"sync"
	"time"

	kafkago "github.com/segmentio/kafka-go"
	"github.com/segmentio/kafka-go/compress"
)

// Topic constants — all NEXCOM Kafka topics.
const (
	TopicOrders        = "nexcom.orders"
	TopicTrades        = "nexcom.trades"
	TopicMarketData    = "nexcom.market-data"
	TopicSettlements   = "nexcom.settlements"
	TopicAlerts        = "nexcom.alerts"
	TopicNotifications = "nexcom.notifications"
	TopicAuditLog      = "nexcom.audit-log"
	TopicRiskEvents    = "nexcom.risk-events"
	TopicKYCEvents     = "nexcom.kyc-events"
	TopicMarginEvents  = "nexcom.margin-events"
)

// consumerGroupID is the Kafka consumer group for the gateway service.
const consumerGroupID = "nexcom-gateway"

// Client wraps segmentio/kafka-go with a producer writer and per-topic consumers.
type Client struct {
	brokers   []string
	connected bool

	mu sync.RWMutex

	// Producer: single shared writer with LZ4 compression and batching
	writer *kafkago.Writer

	// Consumers: one reader per subscribed topic
	readers  map[string]*kafkago.Reader
	handlers map[string][]func([]byte)
	cancelFn context.CancelFunc
	ctx      context.Context
}

// NewClient creates a Kafka client that connects via the official SDK.
func NewClient(brokers string) *Client {
	brokerList := parseBrokers(brokers)
	ctx, cancel := context.WithCancel(context.Background())

	c := &Client{
		brokers:  brokerList,
		handlers: make(map[string][]func([]byte)),
		readers:  make(map[string]*kafkago.Reader),
		ctx:      ctx,
		cancelFn: cancel,
	}
	c.connect()
	return c
}

func parseBrokers(brokers string) []string {
	parts := strings.Split(brokers, ",")
	result := make([]string, 0, len(parts))
	for _, b := range parts {
		b = strings.TrimSpace(b)
		if b != "" {
			result = append(result, b)
		}
	}
	if len(result) == 0 {
		return []string{"localhost:9092"}
	}
	return result
}

func (c *Client) connect() {
	log.Printf("[Kafka] Connecting to brokers: %v", c.brokers)

	// Probe the first broker with a metadata request to verify connectivity
	dialCtx, dialCancel := context.WithTimeout(c.ctx, 5*time.Second)
	defer dialCancel()
	conn, err := kafkago.DialContext(dialCtx, "tcp", c.brokers[0])
	if err != nil {
		log.Printf("[Kafka] Cannot reach %s: %v", c.brokers[0], err)
		c.mu.Lock()
		c.connected = false
		c.mu.Unlock()
		return
	}
	// Verify we can read broker metadata
	_, metaErr := conn.ReadPartitions()
	conn.Close()
	if metaErr != nil {
		log.Printf("[Kafka] Metadata read failed: %v", metaErr)
		c.mu.Lock()
		c.connected = false
		c.mu.Unlock()
		return
	}

	// Build the shared writer (producer) with LZ4 compression and async batching
	writer := &kafkago.Writer{
		Addr:                   kafkago.TCP(c.brokers...),
		Balancer:               &kafkago.LeastBytes{},
		Compression:            compress.Lz4,
		BatchSize:              100,
		BatchTimeout:           5 * time.Millisecond,
		RequiredAcks:           kafkago.RequireOne,
		MaxAttempts:            3,
		WriteBackoffMin:        100 * time.Millisecond,
		WriteBackoffMax:        1 * time.Second,
		AllowAutoTopicCreation: true,
	}

	c.mu.Lock()
	c.writer = writer
	c.connected = true
	c.mu.Unlock()

	log.Printf("[Kafka] Connected to brokers: %v (segmentio/kafka-go, metadata verified)", c.brokers)
}

// Reconnect attempts to re-establish connection.
func (c *Client) Reconnect() {
	c.mu.RLock()
	if c.connected {
		c.mu.RUnlock()
		return
	}
	c.mu.RUnlock()
	c.connect()
}

// Produce sends a message to Kafka. A broker failure is returned to the caller.
func (c *Client) Produce(topic string, key string, value interface{}) error {
	data, err := json.Marshal(value)
	if err != nil {
		return fmt.Errorf("marshal error: %w", err)
	}

	c.mu.RLock()
	writer := c.writer
	connected := c.connected
	c.mu.RUnlock()
	if !connected || writer == nil {
		return fmt.Errorf("Kafka broker unavailable")
	}
	msg := kafkago.Message{Topic: topic, Key: []byte(key), Value: data, Time: time.Now()}
	writeCtx, cancel := context.WithTimeout(c.ctx, 5*time.Second)
	defer cancel()
	if err := writer.WriteMessages(writeCtx, msg); err != nil {
		c.mu.Lock()
		c.connected = false
		c.mu.Unlock()
		return fmt.Errorf("Kafka produce topic=%s: %w", topic, err)
	}
	log.Printf("[Kafka] Produced to topic=%s key=%s size=%d bytes", topic, key, len(data))
	return nil
}

// ProduceAsync sends a message without blocking (for non-critical events).
func (c *Client) ProduceAsync(topic string, key string, value interface{}) {
	go func() {
		if err := c.Produce(topic, key, value); err != nil {
			log.Printf("[Kafka] Async produce error: topic=%s err=%v", topic, err)
		}
	}()
}

// Subscribe registers a handler for a Kafka topic and starts a consumer reader.
// Uses consumer group semantics for at-least-once delivery.
func (c *Client) Subscribe(topic string, handler func([]byte)) {
	c.mu.Lock()
	c.handlers[topic] = append(c.handlers[topic], handler)
	c.mu.Unlock()
	log.Printf("[Kafka] Subscribed to topic: %s", topic)

	c.mu.RLock()
	connected := c.connected
	_, alreadyReading := c.readers[topic]
	c.mu.RUnlock()

	if !connected || alreadyReading {
		return
	}

	// Start a consumer reader for this topic
	reader := kafkago.NewReader(kafkago.ReaderConfig{
		Brokers:        c.brokers,
		Topic:          topic,
		GroupID:        consumerGroupID,
		MinBytes:       1,
		MaxBytes:       10e6, // 10 MB
		MaxWait:        100 * time.Millisecond,
		CommitInterval: time.Second,
		StartOffset:    kafkago.LastOffset,
		MaxAttempts:    3,
	})

	c.mu.Lock()
	c.readers[topic] = reader
	c.mu.Unlock()

	go c.consumeLoop(topic, reader)
}

// consumeLoop runs a blocking read loop for a single topic reader.
func (c *Client) consumeLoop(topic string, reader *kafkago.Reader) {
	log.Printf("[Kafka] Consumer loop started for topic: %s group: %s", topic, consumerGroupID)
	for {
		select {
		case <-c.ctx.Done():
			log.Printf("[Kafka] Consumer loop stopped for topic: %s", topic)
			return
		default:
		}

		msg, err := reader.FetchMessage(c.ctx)
		if err != nil {
			if c.ctx.Err() != nil {
				return // Context cancelled — clean shutdown
			}
			log.Printf("[Kafka] Fetch error topic=%s: %v — retrying in 1s", topic, err)
			time.Sleep(time.Second)
			continue
		}

		// Dispatch to all registered handlers
		c.mu.RLock()
		handlers := c.handlers[topic]
		c.mu.RUnlock()
		for _, h := range handlers {
			go h(msg.Value)
		}

		// Commit offset after successful dispatch
		if commitErr := reader.CommitMessages(c.ctx, msg); commitErr != nil {
			log.Printf("[Kafka] Commit error topic=%s offset=%d: %v", topic, msg.Offset, commitErr)
		}
	}
}

// IsConnected returns the connection status.
func (c *Client) IsConnected() bool {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.connected
}

func (c *Client) IsFallback() bool { return false }

// Close gracefully shuts down all readers and the writer.
func (c *Client) Close() {
	c.cancelFn() // Signal all consumer loops to stop

	c.mu.Lock()
	defer c.mu.Unlock()

	for topic, reader := range c.readers {
		if closeErr := reader.Close(); closeErr != nil {
			log.Printf("[Kafka] Error closing reader for topic %s: %v", topic, closeErr)
		}
	}
	if c.writer != nil {
		if closeErr := c.writer.Close(); closeErr != nil {
			log.Printf("[Kafka] Error closing writer: %v", closeErr)
		}
	}
	c.connected = false
	log.Println("[Kafka] Connection closed")
}
