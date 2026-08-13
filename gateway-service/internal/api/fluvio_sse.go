package api

import (
	"io"
	"log"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	fluvioclient "github.com/munisp/NGApp/services/gateway/internal/fluvio"
)

// fluvioSSEStream streams only events delivered by Fluvio. If the stream is
// unavailable, callers receive 503 rather than a plausible synthetic feed.
func (s *Server) fluvioSSEStream(c *gin.Context) {
	topic := c.Param("topic")
	fromOffset := c.DefaultQuery("from_offset", "latest")
	allowed := map[string]bool{
		fluvioclient.TopicOrderEvents: true, fluvioclient.TopicTradeSignals: true,
		fluvioclient.TopicPriceUpdates: true, fluvioclient.TopicMarketData: true,
		"nexcom-order-events": true, "nexcom-trade-signals": true, "nexcom-price-updates": true,
	}
	if !allowed[topic] {
		c.JSON(http.StatusBadRequest, gin.H{"error": "unknown topic"})
		return
	}
	msgCh, unsubscribe, err := s.fluvio.Subscribe(topic, fromOffset)
	if err != nil {
		log.Printf("[SSE] Fluvio subscription failed for topic %s: %v", topic, err)
		c.AbortWithStatusJSON(http.StatusServiceUnavailable, gin.H{"error": "market stream unavailable", "topic": topic})
		return
	}
	defer unsubscribe()

	c.Header("Content-Type", "text/event-stream")
	c.Header("Cache-Control", "no-cache")
	c.Header("Connection", "keep-alive")
	c.Header("X-Accel-Buffering", "no")
	clientGone := c.Request.Context().Done()
	heartbeat := time.NewTicker(5 * time.Second)
	defer heartbeat.Stop()
	c.Stream(func(w io.Writer) bool {
		select {
		case <-clientGone:
			return false
		case <-heartbeat.C:
			c.SSEvent("heartbeat", gin.H{"ts": time.Now().UnixMilli(), "source": "fluvio"})
			return true
		case msg, ok := <-msgCh:
			if !ok {
				return false
			}
			c.SSEvent("message", gin.H{"topic": topic, "key": msg.Key, "value": msg.Value, "ts": msg.Timestamp, "source": "fluvio"})
			return true
		}
	})
}

// fluvioTopicSnapshot returns durable records read from Fluvio only.
func (s *Server) fluvioTopicSnapshot(c *gin.Context) {
	topic := c.Param("topic")
	limit := 50
	records, err := s.fluvio.FetchLatest(topic, limit)
	if err != nil {
		log.Printf("[Fluvio] Snapshot failed for topic %s: %v", topic, err)
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "market stream unavailable", "topic": topic})
		return
	}
	c.JSON(http.StatusOK, gin.H{"topic": topic, "records": records, "source": "fluvio"})
}
