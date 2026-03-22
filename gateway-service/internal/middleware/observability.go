package middleware

import (
	"fmt"
	"log"
	"net/http"
	"sync"
	"sync/atomic"
	"time"

	"github.com/gin-gonic/gin"
)

// ============================================================
// Prometheus-compatible Metrics
// ============================================================

// MetricsCollector provides Prometheus-compatible metrics for the gateway.
// Exports /metrics endpoint in Prometheus exposition format.
type MetricsCollector struct {
	mu sync.RWMutex

	// Request counters
	requestsTotal    map[string]*atomic.Int64 // method:path:status -> count
	requestDurations map[string][]float64     // method:path -> durations in ms

	// Business metrics
	ordersCreated   atomic.Int64
	ordersCancelled atomic.Int64
	tradesExecuted  atomic.Int64
	loginAttempts   atomic.Int64
	loginFailures   atomic.Int64

	// Middleware health
	kafkaConnected       atomic.Int32
	redisConnected       atomic.Int32
	temporalConnected    atomic.Int32
	tigerbeetleConnected atomic.Int32
	daprConnected        atomic.Int32
	fluvioConnected      atomic.Int32

	// System metrics
	startTime time.Time
}

var globalMetrics *MetricsCollector
var metricsOnce sync.Once

// GetMetrics returns the singleton metrics collector.
func GetMetrics() *MetricsCollector {
	metricsOnce.Do(func() {
		globalMetrics = &MetricsCollector{
			requestsTotal:    make(map[string]*atomic.Int64),
			requestDurations: make(map[string][]float64),
			startTime:        time.Now(),
		}
	})
	return globalMetrics
}

// PrometheusMiddleware records HTTP request metrics.
func PrometheusMiddleware() gin.HandlerFunc {
	m := GetMetrics()
	return func(c *gin.Context) {
		start := time.Now()

		c.Next()

		duration := float64(time.Since(start).Milliseconds())
		status := c.Writer.Status()
		method := c.Request.Method
		path := c.FullPath()
		if path == "" {
			path = c.Request.URL.Path
		}

		// Record request counter
		key := fmt.Sprintf("%s:%s:%d", method, path, status)
		m.mu.Lock()
		counter, ok := m.requestsTotal[key]
		if !ok {
			counter = &atomic.Int64{}
			m.requestsTotal[key] = counter
		}

		// Record duration
		durKey := fmt.Sprintf("%s:%s", method, path)
		m.requestDurations[durKey] = append(m.requestDurations[durKey], duration)
		// Keep only last 1000 durations to avoid memory growth
		if len(m.requestDurations[durKey]) > 1000 {
			m.requestDurations[durKey] = m.requestDurations[durKey][500:]
		}
		m.mu.Unlock()

		counter.Add(1)
	}
}

// RecordOrderCreated increments the orders created counter.
func (m *MetricsCollector) RecordOrderCreated() {
	m.ordersCreated.Add(1)
}

// RecordOrderCancelled increments the orders cancelled counter.
func (m *MetricsCollector) RecordOrderCancelled() {
	m.ordersCancelled.Add(1)
}

// RecordTradeExecuted increments the trades executed counter.
func (m *MetricsCollector) RecordTradeExecuted() {
	m.tradesExecuted.Add(1)
}

// RecordLogin increments login counters.
func (m *MetricsCollector) RecordLogin(success bool) {
	m.loginAttempts.Add(1)
	if !success {
		m.loginFailures.Add(1)
	}
}

// SetMiddlewareHealth updates middleware connectivity status.
func (m *MetricsCollector) SetMiddlewareHealth(name string, connected bool) {
	val := int32(0)
	if connected {
		val = 1
	}
	switch name {
	case "kafka":
		m.kafkaConnected.Store(val)
	case "redis":
		m.redisConnected.Store(val)
	case "temporal":
		m.temporalConnected.Store(val)
	case "tigerbeetle":
		m.tigerbeetleConnected.Store(val)
	case "dapr":
		m.daprConnected.Store(val)
	case "fluvio":
		m.fluvioConnected.Store(val)
	}
}

// MetricsHandler returns Prometheus exposition format metrics.
func MetricsHandler() gin.HandlerFunc {
	return func(c *gin.Context) {
		m := GetMetrics()
		m.mu.RLock()
		defer m.mu.RUnlock()

		var out string

		// Uptime
		uptime := time.Since(m.startTime).Seconds()
		out += fmt.Sprintf("# HELP nexcom_uptime_seconds Gateway uptime in seconds\n")
		out += fmt.Sprintf("# TYPE nexcom_uptime_seconds gauge\n")
		out += fmt.Sprintf("nexcom_uptime_seconds %f\n\n", uptime)

		// Request totals
		out += fmt.Sprintf("# HELP nexcom_http_requests_total Total HTTP requests\n")
		out += fmt.Sprintf("# TYPE nexcom_http_requests_total counter\n")
		for key, counter := range m.requestsTotal {
			out += fmt.Sprintf("nexcom_http_requests_total{key=\"%s\"} %d\n", key, counter.Load())
		}
		out += "\n"

		// Request durations (histogram approximation)
		out += fmt.Sprintf("# HELP nexcom_http_request_duration_ms HTTP request duration in milliseconds\n")
		out += fmt.Sprintf("# TYPE nexcom_http_request_duration_ms summary\n")
		for key, durs := range m.requestDurations {
			if len(durs) == 0 {
				continue
			}
			sum := 0.0
			for _, d := range durs {
				sum += d
			}
			avg := sum / float64(len(durs))
			out += fmt.Sprintf("nexcom_http_request_duration_ms{path=\"%s\",quantile=\"avg\"} %f\n", key, avg)
		}
		out += "\n"

		// Business metrics
		out += fmt.Sprintf("# HELP nexcom_orders_created_total Total orders created\n")
		out += fmt.Sprintf("# TYPE nexcom_orders_created_total counter\n")
		out += fmt.Sprintf("nexcom_orders_created_total %d\n\n", m.ordersCreated.Load())

		out += fmt.Sprintf("# HELP nexcom_orders_cancelled_total Total orders cancelled\n")
		out += fmt.Sprintf("# TYPE nexcom_orders_cancelled_total counter\n")
		out += fmt.Sprintf("nexcom_orders_cancelled_total %d\n\n", m.ordersCancelled.Load())

		out += fmt.Sprintf("# HELP nexcom_trades_total Total trades executed\n")
		out += fmt.Sprintf("# TYPE nexcom_trades_total counter\n")
		out += fmt.Sprintf("nexcom_trades_total %d\n\n", m.tradesExecuted.Load())

		out += fmt.Sprintf("# HELP nexcom_login_attempts_total Total login attempts\n")
		out += fmt.Sprintf("# TYPE nexcom_login_attempts_total counter\n")
		out += fmt.Sprintf("nexcom_login_attempts_total %d\n\n", m.loginAttempts.Load())

		out += fmt.Sprintf("# HELP nexcom_login_failures_total Total login failures\n")
		out += fmt.Sprintf("# TYPE nexcom_login_failures_total counter\n")
		out += fmt.Sprintf("nexcom_login_failures_total %d\n\n", m.loginFailures.Load())

		// Middleware health
		out += fmt.Sprintf("# HELP nexcom_middleware_connected Middleware connectivity (1=connected, 0=disconnected)\n")
		out += fmt.Sprintf("# TYPE nexcom_middleware_connected gauge\n")
		out += fmt.Sprintf("nexcom_middleware_connected{service=\"kafka\"} %d\n", m.kafkaConnected.Load())
		out += fmt.Sprintf("nexcom_middleware_connected{service=\"redis\"} %d\n", m.redisConnected.Load())
		out += fmt.Sprintf("nexcom_middleware_connected{service=\"temporal\"} %d\n", m.temporalConnected.Load())
		out += fmt.Sprintf("nexcom_middleware_connected{service=\"tigerbeetle\"} %d\n", m.tigerbeetleConnected.Load())
		out += fmt.Sprintf("nexcom_middleware_connected{service=\"dapr\"} %d\n", m.daprConnected.Load())
		out += fmt.Sprintf("nexcom_middleware_connected{service=\"fluvio\"} %d\n", m.fluvioConnected.Load())

		c.Data(http.StatusOK, "text/plain; version=0.0.4; charset=utf-8", []byte(out))
	}
}

// ============================================================
// Distributed Tracing (OpenTelemetry-compatible)
// ============================================================

// TraceID generates a unique trace ID for request correlation.
func TraceID() string {
	return fmt.Sprintf("%x", time.Now().UnixNano())
}

// TracingMiddleware adds distributed tracing headers to all requests.
func TracingMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		// Check for incoming trace context (W3C Trace Context format)
		traceParent := c.GetHeader("traceparent")
		traceID := c.GetHeader("X-Trace-ID")
		requestID := c.GetHeader("X-Request-ID")

		if traceID == "" {
			if traceParent != "" {
				// Extract trace ID from W3C traceparent header
				// Format: version-traceId-parentId-traceFlags
				traceID = traceParent
			} else {
				traceID = TraceID()
			}
		}

		if requestID == "" {
			requestID = fmt.Sprintf("req-%s", TraceID())
		}

		// Set trace context in gin context
		c.Set("traceID", traceID)
		c.Set("requestID", requestID)

		// Propagate trace headers downstream
		c.Header("X-Trace-ID", traceID)
		c.Header("X-Request-ID", requestID)

		start := time.Now()
		c.Next()
		duration := time.Since(start)

		// Log trace info for correlation
		log.Printf("[TRACE] %s %s %d %v traceID=%s requestID=%s",
			c.Request.Method, c.Request.URL.Path,
			c.Writer.Status(), duration,
			traceID, requestID)
	}
}

// ============================================================
// Request Logging (structured)
// ============================================================

// StructuredLoggingMiddleware provides JSON-format request logging.
func StructuredLoggingMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		start := time.Now()
		c.Next()
		duration := time.Since(start)

		traceID, _ := c.Get("traceID")
		log.Printf(`{"level":"info","msg":"request","method":"%s","path":"%s","status":%d,"duration_ms":%d,"trace_id":"%v","client_ip":"%s","user_agent":"%s"}`,
			c.Request.Method,
			c.Request.URL.Path,
			c.Writer.Status(),
			duration.Milliseconds(),
			traceID,
			c.ClientIP(),
			c.Request.UserAgent(),
		)
	}
}
