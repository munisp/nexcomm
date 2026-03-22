package api

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	fluvioclient "github.com/munisp/NGApp/services/gateway/internal/fluvio"
)

// fluvioSSEStream streams Fluvio topic events to the client via Server-Sent Events.
// GET /api/v1/fluvio/stream/:topic
// Query params:
//   - from_offset: "earliest" | "latest" (default: "latest")
//   - heartbeat_ms: heartbeat interval in ms (default: 5000)
func (s *Server) fluvioSSEStream(c *gin.Context) {
	topic := c.Param("topic")
	fromOffset := c.DefaultQuery("from_offset", "latest")
	heartbeatMs := 5000

	// Validate topic name against allowed list to prevent enumeration
	allowed := map[string]bool{
		fluvioclient.TopicOrderEvents:  true,
		fluvioclient.TopicTradeSignals: true,
		fluvioclient.TopicPriceUpdates: true,
		fluvioclient.TopicMarketData:   true,
		"nexcom-order-events":          true,
		"nexcom-trade-signals":         true,
		"nexcom-price-updates":         true,
	}
	if !allowed[topic] {
		c.JSON(http.StatusBadRequest, gin.H{"error": "unknown topic: " + topic})
		return
	}

	// Set SSE headers
	c.Header("Content-Type", "text/event-stream")
	c.Header("Cache-Control", "no-cache")
	c.Header("Connection", "keep-alive")
	c.Header("X-Accel-Buffering", "no") // disable nginx buffering
	c.Header("Access-Control-Allow-Origin", "*")

	clientGone := c.Request.Context().Done()

	// Subscribe to the Fluvio topic via the sidecar
	msgCh, unsubscribe, err := s.fluvio.Subscribe(topic, fromOffset)
	if err != nil {
		log.Printf("[SSE] Failed to subscribe to topic %s: %v", topic, err)
		// Fall back to simulated price feed so the UI still works
		s.simulatedSSEStream(c, topic, clientGone)
		return
	}
	defer unsubscribe()

	heartbeat := time.NewTicker(time.Duration(heartbeatMs) * time.Millisecond)
	defer heartbeat.Stop()

	c.Stream(func(w io.Writer) bool {
		select {
		case <-clientGone:
			return false
		case <-heartbeat.C:
			// Send SSE comment as heartbeat to keep connection alive
			c.SSEvent("heartbeat", gin.H{"ts": time.Now().UnixMilli()})
			return true
		case msg, ok := <-msgCh:
			if !ok {
				return false
			}
			c.SSEvent("message", gin.H{
				"topic": topic,
				"key":   msg.Key,
				"value": msg.Value,
				"ts":    msg.Timestamp,
			})
			return true
		}
	})
}

// fluvioTopicSnapshot returns the latest N records from a Fluvio topic as JSON.
// GET /api/v1/fluvio/stream/:topic/snapshot?limit=50
func (s *Server) fluvioTopicSnapshot(c *gin.Context) {
	topic := c.Param("topic")
	limit := 50

	records, err := s.fluvio.FetchLatest(topic, limit)
	if err != nil {
		// Return simulated snapshot on error
		c.JSON(http.StatusOK, gin.H{
			"topic":   topic,
			"records": s.simulatedSnapshot(topic, limit),
			"source":  "simulated",
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"topic":   topic,
		"records": records,
		"source":  "fluvio",
	})
}

// simulatedSSEStream provides a fallback SSE stream with realistic simulated price data
// when the Fluvio sidecar is unavailable.
func (s *Server) simulatedSSEStream(c *gin.Context, topic string, done <-chan struct{}) {
	symbols := []string{"MAIZE", "GINGER", "SOYBEAN", "SORGHUM", "COCOA", "PALM_OIL", "SESAME", "GROUNDNUT"}
	basePrices := map[string]float64{
		"MAIZE": 45000, "GINGER": 320000, "SOYBEAN": 68000, "SORGHUM": 38000,
		"COCOA": 890000, "PALM_OIL": 125000, "SESAME": 450000, "GROUNDNUT": 95000,
	}
	prices := make(map[string]float64)
	for k, v := range basePrices {
		prices[k] = v
	}

	ticker := time.NewTicker(500 * time.Millisecond)
	heartbeat := time.NewTicker(5 * time.Second)
	defer ticker.Stop()
	defer heartbeat.Stop()

	i := 0
	c.Stream(func(w io.Writer) bool {
		select {
		case <-done:
			return false
		case <-heartbeat.C:
			c.SSEvent("heartbeat", gin.H{"ts": time.Now().UnixMilli()})
			return true
		case <-ticker.C:
			sym := symbols[i%len(symbols)]
			i++
			// Random walk ±0.3%
			change := (float64(time.Now().UnixNano()%200) - 100) / 33333.0
			prices[sym] = prices[sym] * (1 + change)
			payload := map[string]interface{}{
				"symbol": sym,
				"price":  fmt.Sprintf("%.2f", prices[sym]),
				"change": fmt.Sprintf("%.4f", change*100),
				"side":   "BUY",
				"ts":     time.Now().UnixMilli(),
				"source": "simulated",
			}
			b, _ := json.Marshal(payload)
			c.SSEvent("message", gin.H{
				"topic": topic,
				"key":   sym,
				"value": string(b),
				"ts":    time.Now().UnixMilli(),
			})
			return true
		}
	})
}

// simulatedSnapshot returns a snapshot of simulated price records.
func (s *Server) simulatedSnapshot(topic string, limit int) []map[string]interface{} {
	symbols := []string{"MAIZE", "GINGER", "SOYBEAN", "SORGHUM", "COCOA", "PALM_OIL", "SESAME", "GROUNDNUT"}
	records := make([]map[string]interface{}, 0, limit)
	basePrices := map[string]float64{
		"MAIZE": 45000, "GINGER": 320000, "SOYBEAN": 68000, "SORGHUM": 38000,
		"COCOA": 890000, "PALM_OIL": 125000, "SESAME": 450000, "GROUNDNUT": 95000,
	}
	for i := 0; i < limit && i < len(symbols); i++ {
		sym := symbols[i]
		records = append(records, map[string]interface{}{
			"key":   sym,
			"value": map[string]interface{}{"symbol": sym, "price": basePrices[sym], "source": "simulated"},
			"ts":    time.Now().UnixMilli() - int64(i*500),
		})
	}
	return records
}
