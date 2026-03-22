// Package kafka provides a high-throughput Kafka producer for NEXCOM event streaming.
// Publishes trade events, settlement notifications, KYC updates, and market data ticks
// to dedicated Kafka topics consumed by analytics, risk, and ingestion services.
package kafka

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"time"

	kafkago "github.com/segmentio/kafka-go"
	"go.uber.org/zap"
)

// Topics used across the NEXCOM platform
const (
	TopicTradeEvents       = "nexcom.trade.events"
	TopicSettlements       = "nexcom.settlements"
	TopicKYCUpdates        = "nexcom.kyc.updates"
	TopicMarketData        = "nexcom.market.data"
	TopicRiskAlerts        = "nexcom.risk.alerts"
	TopicAMLFlags          = "nexcom.aml.flags"
	TopicBlockchainEvents  = "nexcom.blockchain.events"
	TopicMojaloopTransfers = "nexcom.mojaloop.transfers"
	TopicNotifications     = "nexcom.notifications"
	TopicAuditLog          = "nexcom.audit.log"
)

// TradeEvent represents a completed trade for downstream processing
type TradeEvent struct {
	TradeID     string    `json:"trade_id"`
	OrderID     string    `json:"order_id"`
	Symbol      string    `json:"symbol"`
	Side        string    `json:"side"` // BUY | SELL
	Quantity    float64   `json:"quantity"`
	Price       float64   `json:"price"`
	Total       float64   `json:"total"`
	FeeAmount   float64   `json:"fee_amount"`
	FeeCurrency string    `json:"fee_currency"`
	UserID      string    `json:"user_id"`
	CounterID   string    `json:"counter_id"`
	AssetClass  string    `json:"asset_class"`
	Exchange    string    `json:"exchange"`
	Timestamp   time.Time `json:"timestamp"`
}

// SettlementEvent represents a settlement lifecycle event
type SettlementEvent struct {
	SettlementID string    `json:"settlement_id"`
	TradeID      string    `json:"trade_id"`
	Status       string    `json:"status"` // PENDING | MATCHED | SETTLED | FAILED
	Amount       float64   `json:"amount"`
	Currency     string    `json:"currency"`
	DFSPDebit    string    `json:"dfsp_debit"`
	DFSPCredit   string    `json:"dfsp_credit"`
	SettledAt    time.Time `json:"settled_at"`
	T0           bool      `json:"t0"` // true = real-time settlement
}

// KYCUpdateEvent represents a KYC status change
type KYCUpdateEvent struct {
	UserID     string    `json:"user_id"`
	DFSPID     string    `json:"dfsp_id,omitempty"`
	Status     string    `json:"status"` // PENDING | APPROVED | REJECTED | EDD_REQUIRED
	RiskLevel  string    `json:"risk_level"`
	ReviewerID string    `json:"reviewer_id"`
	Reason     string    `json:"reason,omitempty"`
	UpdatedAt  time.Time `json:"updated_at"`
}

// AMLFlagEvent represents an AML detection event
type AMLFlagEvent struct {
	FlagID      string    `json:"flag_id"`
	UserID      string    `json:"user_id"`
	RuleID      string    `json:"rule_id"`
	RuleName    string    `json:"rule_name"`
	Severity    string    `json:"severity"` // LOW | MEDIUM | HIGH | CRITICAL
	Amount      float64   `json:"amount"`
	Currency    string    `json:"currency"`
	Description string    `json:"description"`
	DetectedAt  time.Time `json:"detected_at"`
}

// BlockchainEvent represents a commodity tokenization event
type BlockchainEvent struct {
	EventType   string    `json:"event_type"` // MINT | TRANSFER | LOCK | REDEEM | FRACTIONALIZE
	TokenID     string    `json:"token_id"`
	Chain       string    `json:"chain"` // hyperledger | ethereum | polygon
	From        string    `json:"from,omitempty"`
	To          string    `json:"to"`
	Commodity   string    `json:"commodity"`
	Quantity    float64   `json:"quantity"`
	Unit        string    `json:"unit"`
	WarehouseID string    `json:"warehouse_id"`
	TxHash      string    `json:"tx_hash"`
	Timestamp   time.Time `json:"timestamp"`
}

// NotificationEvent represents a user notification
type NotificationEvent struct {
	UserID    string    `json:"user_id"`
	Title     string    `json:"title"`
	Body      string    `json:"body"`
	Category  string    `json:"category"` // TRADE | KYC | SETTLEMENT | ALERT | SYSTEM
	Priority  string    `json:"priority"`  // LOW | NORMAL | HIGH | URGENT
	ReadAt    *time.Time `json:"read_at,omitempty"`
	CreatedAt time.Time `json:"created_at"`
}

// AuditLogEvent represents an immutable audit trail entry
type AuditLogEvent struct {
	EventID   string                 `json:"event_id"`
	Actor     string                 `json:"actor"`
	Action    string                 `json:"action"`
	Resource  string                 `json:"resource"`
	ResourceID string               `json:"resource_id"`
	IPAddress string                 `json:"ip_address"`
	UserAgent string                 `json:"user_agent"`
	Metadata  map[string]interface{} `json:"metadata,omitempty"`
	Timestamp time.Time              `json:"timestamp"`
}

// Producer wraps the kafka-go writer with topic routing
type Producer struct {
	writers map[string]*kafkago.Writer
	logger  *zap.SugaredLogger
}

// NewProducer creates a new Kafka producer connected to the broker
func NewProducer(logger *zap.SugaredLogger) *Producer {
	brokers := os.Getenv("KAFKA_BROKERS")
	if brokers == "" {
		brokers = "localhost:9092"
	}

	topics := []string{
		TopicTradeEvents, TopicSettlements, TopicKYCUpdates,
		TopicMarketData, TopicRiskAlerts, TopicAMLFlags,
		TopicBlockchainEvents, TopicMojaloopTransfers,
		TopicNotifications, TopicAuditLog,
	}

	writers := make(map[string]*kafkago.Writer, len(topics))
	for _, topic := range topics {
		writers[topic] = &kafkago.Writer{
			Addr:         kafkago.TCP(brokers),
			Topic:        topic,
			Balancer:     &kafkago.LeastBytes{},
			BatchSize:    100,
			BatchTimeout: 10 * time.Millisecond,
			RequiredAcks: kafkago.RequireOne,
			Async:        false,
			Compression:  kafkago.Snappy,
		}
	}

	return &Producer{writers: writers, logger: logger}
}

// publish serializes and sends a message to the given topic
func (p *Producer) publish(ctx context.Context, topic string, key string, payload interface{}) error {
	data, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("marshal error for topic %s: %w", topic, err)
	}

	writer, ok := p.writers[topic]
	if !ok {
		return fmt.Errorf("no writer for topic: %s", topic)
	}

	msg := kafkago.Message{
		Key:   []byte(key),
		Value: data,
		Time:  time.Now(),
		Headers: []kafkago.Header{
			{Key: "source", Value: []byte("nexcom-middleware-hub")},
			{Key: "version", Value: []byte("1.0")},
		},
	}

	if err := writer.WriteMessages(ctx, msg); err != nil {
		p.logger.Errorw("Kafka publish failed", "topic", topic, "key", key, "error", err)
		return fmt.Errorf("kafka write error: %w", err)
	}

	p.logger.Debugw("Published Kafka message", "topic", topic, "key", key, "size", len(data))
	return nil
}

// PublishTradeEvent publishes a completed trade to the trade events topic
func (p *Producer) PublishTradeEvent(ctx context.Context, event TradeEvent) error {
	return p.publish(ctx, TopicTradeEvents, event.TradeID, event)
}

// PublishSettlement publishes a settlement lifecycle event
func (p *Producer) PublishSettlement(ctx context.Context, event SettlementEvent) error {
	return p.publish(ctx, TopicSettlements, event.SettlementID, event)
}

// PublishKYCUpdate publishes a KYC status change event
func (p *Producer) PublishKYCUpdate(ctx context.Context, event KYCUpdateEvent) error {
	key := event.UserID
	if event.DFSPID != "" {
		key = event.DFSPID
	}
	return p.publish(ctx, TopicKYCUpdates, key, event)
}

// PublishAMLFlag publishes an AML detection event
func (p *Producer) PublishAMLFlag(ctx context.Context, event AMLFlagEvent) error {
	return p.publish(ctx, TopicAMLFlags, event.FlagID, event)
}

// PublishBlockchainEvent publishes a commodity tokenization event
func (p *Producer) PublishBlockchainEvent(ctx context.Context, event BlockchainEvent) error {
	return p.publish(ctx, TopicBlockchainEvents, event.TokenID, event)
}

// PublishNotification publishes a user notification event
func (p *Producer) PublishNotification(ctx context.Context, event NotificationEvent) error {
	return p.publish(ctx, TopicNotifications, event.UserID, event)
}

// PublishAuditLog publishes an immutable audit log entry
func (p *Producer) PublishAuditLog(ctx context.Context, event AuditLogEvent) error {
	return p.publish(ctx, TopicAuditLog, event.EventID, event)
}

// Close gracefully shuts down all Kafka writers
func (p *Producer) Close() {
	for topic, writer := range p.writers {
		if err := writer.Close(); err != nil {
			p.logger.Warnw("Error closing Kafka writer", "topic", topic, "error", err)
		}
	}
}

// HealthCheck verifies Kafka connectivity by attempting a dial
func (p *Producer) HealthCheck(ctx context.Context) bool {
	brokers := os.Getenv("KAFKA_BROKERS")
	if brokers == "" {
		brokers = "localhost:9092"
	}
	conn, err := kafkago.DialContext(ctx, "tcp", brokers)
	if err != nil {
		return false
	}
	conn.Close()
	return true
}
