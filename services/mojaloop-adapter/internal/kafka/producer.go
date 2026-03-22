// Package kafka provides a Kafka producer for the Mojaloop DFSP adapter.
// It emits typed events to Kafka topics after FSPIOP callbacks are received,
// enabling the NEXCOM ingestion-engine Bronze layer and portal tRPC layer to
// react to Mojaloop transfer state changes in real time.
//
// Topics emitted:
//   - mojaloop.transfer.initiated  — after POST /transfers succeeds
//   - mojaloop.transfer.committed  — after PUT /callbacks/transfers/{id} (fulfil)
//   - mojaloop.transfer.aborted    — after PUT /callbacks/transfers/{id}/error
//   - mojaloop.quote.accepted      — after PUT /callbacks/quotes/{id}
package kafka

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net"
	"strings"
	"time"
)

// Producer is a minimal synchronous Kafka producer that writes JSON messages
// using a raw TCP connection to a Kafka broker (no external library required).
// For production, replace with franz-go or confluent-kafka-go.
type Producer struct {
	brokers []string
	logger  *slog.Logger
}

// NewProducer creates a new Kafka producer from a comma-separated broker list.
func NewProducer(brokers string, logger *slog.Logger) *Producer {
	bs := strings.Split(brokers, ",")
	for i, b := range bs {
		bs[i] = strings.TrimSpace(b)
	}
	return &Producer{brokers: bs, logger: logger}
}

// baseEvent is the common envelope for all Mojaloop Kafka events.
type baseEvent struct {
	Timestamp int64  `json:"timestamp"`
	Source    string `json:"source"`
}

// TransferInitiatedEvent is emitted after a Mojaloop transfer is created.
type TransferInitiatedEvent struct {
	baseEvent
	TransferID   string  `json:"transferId"`
	SettlementID string  `json:"settlementId,omitempty"`
	PayerFspID   string  `json:"payerFspId"`
	PayeeFspID   string  `json:"payeeFspId"`
	Amount       float64 `json:"amount"`
	Currency     string  `json:"currency"`
	Condition    string  `json:"condition,omitempty"`
	ILPPacket    string  `json:"ilpPacket,omitempty"`
}

// TransferCommittedEvent is emitted after a COMMITTED fulfil callback is received.
type TransferCommittedEvent struct {
	baseEvent
	TransferID   string  `json:"transferId"`
	SettlementID string  `json:"settlementId,omitempty"`
	PayerFspID   string  `json:"payerFspId"`
	PayeeFspID   string  `json:"payeeFspId"`
	Amount       float64 `json:"amount"`
	Currency     string  `json:"currency"`
	Fulfilment   string  `json:"fulfilment,omitempty"`
	CommittedAt  int64   `json:"committedAt"`
}

// TransferAbortedEvent is emitted after an error callback is received.
type TransferAbortedEvent struct {
	baseEvent
	TransferID       string `json:"transferId"`
	SettlementID     string `json:"settlementId,omitempty"`
	ErrorCode        string `json:"errorCode"`
	ErrorDescription string `json:"errorDescription"`
}

// QuoteAcceptedEvent is emitted after a quote response callback is received.
type QuoteAcceptedEvent struct {
	baseEvent
	QuoteID        string  `json:"quoteId"`
	TransferID     string  `json:"transferId,omitempty"`
	PayerFspID     string  `json:"payerFspId"`
	PayeeFspID     string  `json:"payeeFspId"`
	TransferAmount float64 `json:"transferAmount"`
	Currency       string  `json:"currency"`
	PayeeFspFee    float64 `json:"payeeFspFee,omitempty"`
	ILPPacket      string  `json:"ilpPacket,omitempty"`
	Condition      string  `json:"condition,omitempty"`
}

// EmitTransferInitiated publishes a mojaloop.transfer.initiated event.
func (p *Producer) EmitTransferInitiated(ctx context.Context, ev TransferInitiatedEvent) {
	ev.baseEvent = baseEvent{Timestamp: time.Now().UnixMilli(), Source: "mojaloop-adapter"}
	p.emit(ctx, "mojaloop.transfer.initiated", ev)
}

// EmitTransferCommitted publishes a mojaloop.transfer.committed event.
func (p *Producer) EmitTransferCommitted(ctx context.Context, ev TransferCommittedEvent) {
	ev.baseEvent = baseEvent{Timestamp: time.Now().UnixMilli(), Source: "mojaloop-adapter"}
	p.emit(ctx, "mojaloop.transfer.committed", ev)
}

// EmitTransferAborted publishes a mojaloop.transfer.aborted event.
func (p *Producer) EmitTransferAborted(ctx context.Context, ev TransferAbortedEvent) {
	ev.baseEvent = baseEvent{Timestamp: time.Now().UnixMilli(), Source: "mojaloop-adapter"}
	p.emit(ctx, "mojaloop.transfer.aborted", ev)
}

// EmitQuoteAccepted publishes a mojaloop.quote.accepted event.
func (p *Producer) EmitQuoteAccepted(ctx context.Context, ev QuoteAcceptedEvent) {
	ev.baseEvent = baseEvent{Timestamp: time.Now().UnixMilli(), Source: "mojaloop-adapter"}
	p.emit(ctx, "mojaloop.quote.accepted", ev)
}

// emit serialises the payload and sends it to Kafka using the Produce API (v0).
// This is a lightweight implementation that avoids external dependencies.
// It gracefully degrades — if Kafka is unavailable the event is logged and dropped.
func (p *Producer) emit(ctx context.Context, topic string, payload any) {
	data, err := json.Marshal(payload)
	if err != nil {
		p.logger.Error("kafka: failed to marshal event", "topic", topic, "err", err)
		return
	}

	var lastErr error
	for _, broker := range p.brokers {
		if err := p.sendKafkaMessage(ctx, broker, topic, data); err != nil {
			lastErr = err
			continue
		}
		p.logger.Debug("kafka: event emitted", "topic", topic, "broker", broker, "bytes", len(data))
		return
	}
	// All brokers failed — log and degrade gracefully
	p.logger.Warn("kafka: failed to emit event (all brokers unavailable)",
		"topic", topic, "lastErr", lastErr)
}

// sendKafkaMessage sends a single message using the Kafka Produce API v0.
// Wire format: [RequestHeader][ProduceRequest v0][MessageSet]
func (p *Producer) sendKafkaMessage(ctx context.Context, broker, topic string, value []byte) error {
	dialer := net.Dialer{Timeout: 3 * time.Second}
	conn, err := dialer.DialContext(ctx, "tcp", broker)
	if err != nil {
		return fmt.Errorf("dial %s: %w", broker, err)
	}
	defer conn.Close()
	conn.SetDeadline(time.Now().Add(5 * time.Second))

	// Build Kafka Produce request (API key 0, version 0) manually
	// This avoids pulling in a full Kafka client library.
	req := buildProduceRequestV0(topic, value)
	if _, err := conn.Write(req); err != nil {
		return fmt.Errorf("write: %w", err)
	}

	// Read and discard the response (4-byte size + body)
	sizeBuf := make([]byte, 4)
	if _, err := conn.Read(sizeBuf); err != nil {
		// Non-fatal: response read failure doesn't mean the message wasn't written
		p.logger.Debug("kafka: response read skipped", "err", err)
	}
	return nil
}

// buildProduceRequestV0 constructs a minimal Kafka Produce API v0 request frame.
// Layout: [4-byte total length][2-byte API key=0][2-byte API version=0]
//
//	[4-byte correlation ID][2-byte client ID len][client ID bytes]
//	[2-byte required acks=1][4-byte timeout=5000ms]
//	[4-byte topic array len=1][2-byte topic len][topic bytes]
//	[4-byte partition array len=1][4-byte partition=0]
//	[4-byte message set size][message set]
//
// Message set (v0): [8-byte offset=0][4-byte msg size][message]
// Message: [4-byte crc][1-byte magic=0][1-byte attrs=0][4-byte key=-1][4-byte val len][val bytes]
func buildProduceRequestV0(topic string, value []byte) []byte {
	clientID := "mojaloop-adapter"

	// Build message (no key, value only)
	msgPayload := buildMessageV0(value)
	// Message set: offset(8) + msgSize(4) + msg
	msgSetSize := 8 + 4 + len(msgPayload)
	msgSet := make([]byte, msgSetSize)
	putInt64(msgSet, 0, 0)                      // offset = 0
	putInt32(msgSet, 8, int32(len(msgPayload))) // message size
	copy(msgSet[12:], msgPayload)

	// Build request body
	topicBytes := []byte(topic)
	clientIDBytes := []byte(clientID)

	bodySize := 2 + 4 + // required_acks + timeout
		4 + 2 + len(topicBytes) + // topic array
		4 + 4 + 4 + len(msgSet) // partition array + msgset
	body := make([]byte, bodySize)
	off := 0
	putInt16(body, off, 1)    // required_acks = 1
	off += 2
	putInt32(body, off, 5000) // timeout = 5000ms
	off += 4
	putInt32(body, off, 1) // topic array length = 1
	off += 4
	putInt16(body, off, int16(len(topicBytes)))
	off += 2
	copy(body[off:], topicBytes)
	off += len(topicBytes)
	putInt32(body, off, 1) // partition array length = 1
	off += 4
	putInt32(body, off, 0) // partition = 0
	off += 4
	putInt32(body, off, int32(len(msgSet)))
	off += 4
	copy(body[off:], msgSet)

	// Request header: API key(2) + version(2) + correlationID(4) + clientID
	header := make([]byte, 2+2+4+2+len(clientIDBytes))
	putInt16(header, 0, 0)                           // API key = 0 (Produce)
	putInt16(header, 2, 0)                           // API version = 0
	putInt32(header, 4, 1)                           // correlation ID
	putInt16(header, 8, int16(len(clientIDBytes)))   // client ID length
	copy(header[10:], clientIDBytes)

	// Full request: 4-byte size prefix + header + body
	full := make([]byte, 4+len(header)+len(body))
	putInt32(full, 0, int32(len(header)+len(body)))
	copy(full[4:], header)
	copy(full[4+len(header):], body)
	return full
}

// buildMessageV0 constructs a Kafka Message v0 (magic byte = 0).
// Format: [4-byte CRC32][1-byte magic=0][1-byte attrs=0][4-byte key=-1][4-byte val len][val]
func buildMessageV0(value []byte) []byte {
	// Payload without CRC: magic(1) + attrs(1) + key(-1 as int32) + value
	inner := make([]byte, 1+1+4+4+len(value))
	inner[0] = 0 // magic = 0
	inner[1] = 0 // attributes = 0 (no compression)
	putInt32(inner, 2, -1)                    // key = null
	putInt32(inner, 6, int32(len(value)))     // value length
	copy(inner[10:], value)

	// CRC32 of inner
	crc := crc32IEEE(inner)
	msg := make([]byte, 4+len(inner))
	putInt32(msg, 0, int32(crc))
	copy(msg[4:], inner)
	return msg
}

// ─── CRC32 (IEEE polynomial) ──────────────────────────────────────────────────

var crc32Table [256]uint32

func init() {
	const poly = 0xedb88320
	for i := range crc32Table {
		crc := uint32(i)
		for j := 0; j < 8; j++ {
			if crc&1 != 0 {
				crc = (crc >> 1) ^ poly
			} else {
				crc >>= 1
			}
		}
		crc32Table[i] = crc
	}
}

func crc32IEEE(data []byte) uint32 {
	crc := uint32(0xffffffff)
	for _, b := range data {
		crc = (crc >> 8) ^ crc32Table[byte(crc)^b]
	}
	return ^crc
}

// ─── Integer encoding helpers ─────────────────────────────────────────────────

func putInt64(b []byte, off int, v int64) {
	b[off] = byte(v >> 56)
	b[off+1] = byte(v >> 48)
	b[off+2] = byte(v >> 40)
	b[off+3] = byte(v >> 32)
	b[off+4] = byte(v >> 24)
	b[off+5] = byte(v >> 16)
	b[off+6] = byte(v >> 8)
	b[off+7] = byte(v)
}

func putInt32(b []byte, off int, v int32) {
	b[off] = byte(v >> 24)
	b[off+1] = byte(v >> 16)
	b[off+2] = byte(v >> 8)
	b[off+3] = byte(v)
}

func putInt16(b []byte, off int, v int16) {
	b[off] = byte(v >> 8)
	b[off+1] = byte(v)
}
