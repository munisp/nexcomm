/*
 * Kafka producer for the NEXCOM Channel Gateway.
 * Emits channel events to the NEXCOM event bus.
 */

package kafka

import (
	"context"
	"encoding/json"
	"time"

	kafkago "github.com/segmentio/kafka-go"
	"go.uber.org/zap"
)

// Producer wraps kafka-go writer with graceful degradation
type Producer struct {
	writer *kafkago.Writer
	log    *zap.SugaredLogger
	active bool
}

func NewProducer(brokers string, log *zap.SugaredLogger) *Producer {
	w := &kafkago.Writer{
		Addr:         kafkago.TCP(brokers),
		Balancer:     &kafkago.LeastBytes{},
		WriteTimeout: 5 * time.Second,
		ReadTimeout:  5 * time.Second,
		MaxAttempts:  2,
	}
	p := &Producer{writer: w, log: log, active: true}
	// Test connectivity
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	if err := w.WriteMessages(ctx, kafkago.Message{Topic: "nexcom.health", Value: []byte("ping")}); err != nil {
		log.Warnw("Kafka not available — channel events will be skipped", "error", err)
		p.active = false
	}
	return p
}

// Emit sends an event to the specified Kafka topic
func (p *Producer) Emit(topic string, payload map[string]interface{}) {
	if !p.active {
		return
	}
	body, err := json.Marshal(payload)
	if err != nil {
		p.log.Errorw("Kafka marshal failed", "error", err)
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := p.writer.WriteMessages(ctx, kafkago.Message{
		Topic: topic,
		Value: body,
	}); err != nil {
		p.log.Warnw("Kafka emit failed", "topic", topic, "error", err)
		p.active = false // Back off after first failure
	}
}

// Close shuts down the Kafka writer
func (p *Producer) Close() {
	if p.writer != nil {
		p.writer.Close()
	}
}
