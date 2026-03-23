/*
 * Middleware for NEXCOM Channel Gateway
 * Provides: request logging, Prometheus metrics, internal auth guard
 */

package middleware

import (
	"net/http"
	"os"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
	"github.com/prometheus/client_golang/prometheus/promhttp"
	"go.uber.org/zap"
)

var (
	requestsTotal = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "nexcom_channel_gateway_requests_total",
		Help: "Total HTTP requests",
	}, []string{"method", "path", "status"})

	requestDuration = promauto.NewHistogramVec(prometheus.HistogramOpts{
		Name:    "nexcom_channel_gateway_request_duration_seconds",
		Help:    "HTTP request duration",
		Buckets: []float64{0.01, 0.05, 0.1, 0.25, 0.5, 1.0, 2.0},
	}, []string{"method", "path"})

	whatsappMessages = promauto.NewCounter(prometheus.CounterOpts{
		Name: "nexcom_whatsapp_messages_total",
		Help: "Total WhatsApp messages processed",
	})

	telegramMessages = promauto.NewCounter(prometheus.CounterOpts{
		Name: "nexcom_telegram_messages_total",
		Help: "Total Telegram messages processed",
	})
)

// Logger middleware logs each request
func Logger(log *zap.SugaredLogger) gin.HandlerFunc {
	return func(c *gin.Context) {
		start := time.Now()
		c.Next()
		log.Infow("HTTP request",
			"method", c.Request.Method,
			"path", c.Request.URL.Path,
			"status", c.Writer.Status(),
			"duration_ms", time.Since(start).Milliseconds(),
		)
	}
}

// Metrics middleware records Prometheus metrics
func Metrics() gin.HandlerFunc {
	return func(c *gin.Context) {
		start := time.Now()
		c.Next()
		path := c.FullPath()
		if path == "" {
			path = "unknown"
		}
		status := http.StatusText(c.Writer.Status())
		requestsTotal.WithLabelValues(c.Request.Method, path, status).Inc()
		requestDuration.WithLabelValues(c.Request.Method, path).Observe(time.Since(start).Seconds())

		// Channel-specific counters
		if path == "/webhook/whatsapp" && c.Request.Method == "POST" {
			whatsappMessages.Inc()
		} else if path == "/webhook/telegram" {
			telegramMessages.Inc()
		}
	}
}

// InternalAuth guards internal endpoints (send/whatsapp, send/telegram)
// Requires X-Internal-Token header matching INTERNAL_API_TOKEN env var
func InternalAuth() gin.HandlerFunc {
	token := os.Getenv("INTERNAL_API_TOKEN")
	return func(c *gin.Context) {
		if token == "" {
			// No token configured — allow all internal requests (dev mode)
			c.Next()
			return
		}
		if c.GetHeader("X-Internal-Token") != token {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
			return
		}
		c.Next()
	}
}

// PrometheusHandler returns the Prometheus metrics handler
func PrometheusHandler() gin.HandlerFunc {
	h := promhttp.Handler()
	return func(c *gin.Context) {
		h.ServeHTTP(c.Writer, c.Request)
	}
}
