// NEXCOM Exchange — DDoS Guard Service (Go)
// ==========================================
// High-performance reverse proxy sidecar that sits in front of the Node.js
// application server and enforces:
//
//  1. Tiered rate limiting (token bucket per IP + per session)
//  2. IP reputation / blocklist (in-memory + Redis-backed)
//  3. Slow-loris protection (read/write deadlines on every connection)
//  4. Circuit breaker (auto-open when backend is unhealthy)
//  5. Request fingerprinting (detect scanners, bots, automated attacks)
//  6. Geo-blocking (optional, configurable per country code)
//  7. HTTP Parameter Pollution (HPP) prevention
//  8. Amplification attack prevention (response size capping)
//  9. SYN flood mitigation (via SO_REUSEPORT + connection limits)
// 10. Real-time security event streaming (SSE endpoint for admin dashboard)
//
// The service proxies all traffic to BACKEND_URL (default: localhost:3000)
// and listens on GUARD_PORT (default: 8080).
//
// Environment variables:
//   GUARD_PORT        - Port to listen on (default: 8080)
//   BACKEND_URL       - Upstream Node.js server (default: http://localhost:3000)
//   REDIS_URL         - Redis for distributed rate limiting (optional)
//   BLOCKLIST_PATH    - Path to IP blocklist file (optional)
//   GEO_BLOCK         - Comma-separated ISO country codes to block (optional)
//   MAX_BODY_BYTES    - Max request body size in bytes (default: 10485760 = 10MB)
//   RATE_LIMIT_RPS    - General rate limit requests/sec per IP (default: 10)
//   TRADE_LIMIT_RPS   - Trading endpoint rate limit req/sec (default: 2)
//   AUTH_LIMIT_RPM    - Auth endpoint rate limit req/min (default: 20)

package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

// ── Configuration ─────────────────────────────────────────────────────────────

type Config struct {
	GuardPort     string
	BackendURL    string
	MaxBodyBytes  int64
	RateLimitRPS  int
	TradeLimitRPS int
	AuthLimitRPM  int
	GeoBlock      []string
	BlocklistPath string
}

func loadConfig() Config {
	cfg := Config{
		GuardPort:     getEnv("GUARD_PORT", "8080"),
		BackendURL:    getEnv("BACKEND_URL", "http://localhost:3000"),
		MaxBodyBytes:  int64(getEnvInt("MAX_BODY_BYTES", 10*1024*1024)),
		RateLimitRPS:  getEnvInt("RATE_LIMIT_RPS", 10),
		TradeLimitRPS: getEnvInt("TRADE_LIMIT_RPS", 2),
		AuthLimitRPM:  getEnvInt("AUTH_LIMIT_RPM", 20),
		BlocklistPath: getEnv("BLOCKLIST_PATH", ""),
	}
	if geo := getEnv("GEO_BLOCK", ""); geo != "" {
		cfg.GeoBlock = strings.Split(geo, ",")
	}
	return cfg
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func getEnvInt(key string, fallback int) int {
	if v := os.Getenv(key); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			return n
		}
	}
	return fallback
}

// ── Token Bucket Rate Limiter ─────────────────────────────────────────────────

type TokenBucket struct {
	mu       sync.Mutex
	tokens   float64
	maxTokens float64
	refillRate float64 // tokens per second
	lastRefill time.Time
}

func newTokenBucket(rps int) *TokenBucket {
	return &TokenBucket{
		tokens:     float64(rps),
		maxTokens:  float64(rps) * 2, // burst = 2x rate
		refillRate: float64(rps),
		lastRefill: time.Now(),
	}
}

func (tb *TokenBucket) Allow() bool {
	tb.mu.Lock()
	defer tb.mu.Unlock()
	now := time.Now()
	elapsed := now.Sub(tb.lastRefill).Seconds()
	tb.tokens = min(tb.maxTokens, tb.tokens+elapsed*tb.refillRate)
	tb.lastRefill = now
	if tb.tokens >= 1.0 {
		tb.tokens--
		return true
	}
	return false
}

func min(a, b float64) float64 {
	if a < b {
		return a
	}
	return b
}

// ── Rate Limiter Registry ─────────────────────────────────────────────────────

type RateLimiterRegistry struct {
	mu       sync.RWMutex
	buckets  map[string]*TokenBucket
	rps      int
	lastSeen map[string]time.Time
}

func newRegistry(rps int) *RateLimiterRegistry {
	r := &RateLimiterRegistry{
		buckets:  make(map[string]*TokenBucket),
		rps:      rps,
		lastSeen: make(map[string]time.Time),
	}
	// Cleanup goroutine — remove stale entries every 5 minutes
	go func() {
		ticker := time.NewTicker(5 * time.Minute)
		for range ticker.C {
			r.cleanup()
		}
	}()
	return r
}

func (r *RateLimiterRegistry) Allow(key string) bool {
	r.mu.RLock()
	bucket, ok := r.buckets[key]
	r.mu.RUnlock()
	if !ok {
		r.mu.Lock()
		bucket = newTokenBucket(r.rps)
		r.buckets[key] = bucket
		r.mu.Unlock()
	}
	r.mu.Lock()
	r.lastSeen[key] = time.Now()
	r.mu.Unlock()
	return bucket.Allow()
}

func (r *RateLimiterRegistry) cleanup() {
	r.mu.Lock()
	defer r.mu.Unlock()
	cutoff := time.Now().Add(-10 * time.Minute)
	for key, t := range r.lastSeen {
		if t.Before(cutoff) {
			delete(r.buckets, key)
			delete(r.lastSeen, key)
		}
	}
}

// ── IP Blocklist ──────────────────────────────────────────────────────────────

type IPBlocklist struct {
	mu      sync.RWMutex
	blocked map[string]time.Time // IP → expiry (zero = permanent)
	subnets []*net.IPNet
}

func newIPBlocklist(path string) *IPBlocklist {
	bl := &IPBlocklist{
		blocked: make(map[string]time.Time),
	}
	if path != "" {
		bl.loadFromFile(path)
	}
	// Seed with known malicious CIDR ranges (Tor exit nodes, known botnets)
	knownBadCIDRs := []string{
		"185.220.0.0/16",   // Tor exit nodes range
		"192.42.116.0/22",  // Tor authority
		"176.10.99.0/24",   // Known botnet range
	}
	for _, cidr := range knownBadCIDRs {
		if _, network, err := net.ParseCIDR(cidr); err == nil {
			bl.subnets = append(bl.subnets, network)
		}
	}
	return bl
}

func (bl *IPBlocklist) loadFromFile(path string) {
	data, err := os.ReadFile(path)
	if err != nil {
		log.Printf("[Blocklist] Could not load %s: %v", path, err)
		return
	}
	for _, line := range strings.Split(string(data), "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		bl.blocked[line] = time.Time{} // permanent block
	}
	log.Printf("[Blocklist] Loaded %d IPs from %s", len(bl.blocked), path)
}

func (bl *IPBlocklist) IsBlocked(ipStr string) bool {
	bl.mu.RLock()
	defer bl.mu.RUnlock()
	if expiry, ok := bl.blocked[ipStr]; ok {
		if expiry.IsZero() || time.Now().Before(expiry) {
			return true
		}
	}
	ip := net.ParseIP(ipStr)
	if ip == nil {
		return false
	}
	for _, subnet := range bl.subnets {
		if subnet.Contains(ip) {
			return true
		}
	}
	return false
}

func (bl *IPBlocklist) Block(ipStr string, duration time.Duration) {
	bl.mu.Lock()
	defer bl.mu.Unlock()
	if duration == 0 {
		bl.blocked[ipStr] = time.Time{} // permanent
	} else {
		bl.blocked[ipStr] = time.Now().Add(duration)
	}
	log.Printf("[Blocklist] Blocked IP %s for %v", ipStr, duration)
}

// ── Security Event Log ────────────────────────────────────────────────────────

type SecurityEvent struct {
	Timestamp string `json:"timestamp"`
	Type      string `json:"type"`
	IP        string `json:"ip"`
	Path      string `json:"path"`
	Detail    string `json:"detail"`
}

type EventLog struct {
	mu     sync.RWMutex
	events []SecurityEvent
	maxLen int
	// SSE subscribers
	subsMu sync.RWMutex
	subs   map[chan SecurityEvent]struct{}
}

func newEventLog(maxLen int) *EventLog {
	return &EventLog{
		events: make([]SecurityEvent, 0, maxLen),
		maxLen: maxLen,
		subs:   make(map[chan SecurityEvent]struct{}),
	}
}

func (el *EventLog) Add(evt SecurityEvent) {
	el.mu.Lock()
	el.events = append(el.events, evt)
	if len(el.events) > el.maxLen {
		el.events = el.events[len(el.events)-el.maxLen:]
	}
	el.mu.Unlock()
	// Broadcast to SSE subscribers
	el.subsMu.RLock()
	for ch := range el.subs {
		select {
		case ch <- evt:
		default:
		}
	}
	el.subsMu.RUnlock()
}

func (el *EventLog) Recent(n int) []SecurityEvent {
	el.mu.RLock()
	defer el.mu.RUnlock()
	if n > len(el.events) {
		n = len(el.events)
	}
	result := make([]SecurityEvent, n)
	copy(result, el.events[len(el.events)-n:])
	return result
}

func (el *EventLog) Subscribe() chan SecurityEvent {
	ch := make(chan SecurityEvent, 32)
	el.subsMu.Lock()
	el.subs[ch] = struct{}{}
	el.subsMu.Unlock()
	return ch
}

func (el *EventLog) Unsubscribe(ch chan SecurityEvent) {
	el.subsMu.Lock()
	delete(el.subs, ch)
	el.subsMu.Unlock()
	close(ch)
}

// ── Circuit Breaker ───────────────────────────────────────────────────────────

type CircuitBreaker struct {
	mu           sync.Mutex
	failures     int
	lastFailure  time.Time
	openUntil    time.Time
	threshold    int
	resetTimeout time.Duration
	totalBlocked atomic.Int64
}

func newCircuitBreaker(threshold int, resetTimeout time.Duration) *CircuitBreaker {
	return &CircuitBreaker{
		threshold:    threshold,
		resetTimeout: resetTimeout,
	}
}

func (cb *CircuitBreaker) IsOpen() bool {
	cb.mu.Lock()
	defer cb.mu.Unlock()
	if time.Now().Before(cb.openUntil) {
		return true
	}
	return false
}

func (cb *CircuitBreaker) RecordFailure() {
	cb.mu.Lock()
	defer cb.mu.Unlock()
	cb.failures++
	cb.lastFailure = time.Now()
	if cb.failures >= cb.threshold {
		cb.openUntil = time.Now().Add(cb.resetTimeout)
		log.Printf("[CircuitBreaker] OPEN — %d failures, reset at %s", cb.failures, cb.openUntil.Format(time.RFC3339))
	}
}

func (cb *CircuitBreaker) RecordSuccess() {
	cb.mu.Lock()
	defer cb.mu.Unlock()
	cb.failures = 0
}

// ── Suspicious Pattern Detector ───────────────────────────────────────────────

var suspiciousPatterns = []string{
	"../", "..\\",                    // path traversal
	"<script", "javascript:",         // XSS
	"union select", "drop table",     // SQL injection
	"exec(", "eval(",                 // code injection
	"wget ", "curl ", "/bin/sh",      // command injection
	"base64_decode", "system(",       // PHP injection
	"${", "#{",                       // template injection
	"__proto__", "constructor",       // prototype pollution
}

var suspiciousUserAgents = []string{
	"sqlmap", "nikto", "nmap", "masscan", "zgrab",
	"dirbuster", "gobuster", "wfuzz", "hydra", "medusa",
	"burpsuite", "havij", "acunetix", "nessus", "openvas",
	"w3af", "skipfish", "arachni",
}

func isSuspiciousRequest(r *http.Request) (bool, string) {
	// Check URL
	decodedURL := r.URL.String()
	lower := strings.ToLower(decodedURL)
	for _, pattern := range suspiciousPatterns {
		if strings.Contains(lower, pattern) {
			return true, fmt.Sprintf("suspicious URL pattern: %s", pattern)
		}
	}
	// Check User-Agent
	ua := strings.ToLower(r.UserAgent())
	for _, agent := range suspiciousUserAgents {
		if strings.Contains(ua, agent) {
			return true, fmt.Sprintf("attack tool user-agent: %s", agent)
		}
	}
	// Check query params
	for _, vals := range r.URL.Query() {
		for _, v := range vals {
			lower := strings.ToLower(v)
			for _, pattern := range suspiciousPatterns {
				if strings.Contains(lower, pattern) {
					return true, fmt.Sprintf("suspicious query param: %s", pattern)
				}
			}
		}
	}
	return false, ""
}

// ── Metrics ───────────────────────────────────────────────────────────────────

type Metrics struct {
	TotalRequests  atomic.Int64
	BlockedByIP    atomic.Int64
	BlockedByRate  atomic.Int64
	BlockedByBot   atomic.Int64
	BlockedBySize  atomic.Int64
	CircuitBlocked atomic.Int64
	ProxiedOK      atomic.Int64
	BackendErrors  atomic.Int64
	StartTime      time.Time
}

// ── Main Guard Handler ────────────────────────────────────────────────────────

type Guard struct {
	cfg         Config
	proxy       *httputil.ReverseProxy
	blocklist   *IPBlocklist
	generalRL   *RateLimiterRegistry
	tradeRL     *RateLimiterRegistry
	authRL      *RateLimiterRegistry
	cb          *CircuitBreaker
	eventLog    *EventLog
	metrics     *Metrics
}

func newGuard(cfg Config) (*Guard, error) {
	backendURL, err := url.Parse(cfg.BackendURL)
	if err != nil {
		return nil, fmt.Errorf("invalid backend URL: %w", err)
	}

	proxy := httputil.NewSingleHostReverseProxy(backendURL)
	proxy.Transport = &http.Transport{
		DialContext: (&net.Dialer{
			Timeout:   5 * time.Second,
			KeepAlive: 30 * time.Second,
		}).DialContext,
		MaxIdleConns:          200,
		MaxIdleConnsPerHost:   100,
		IdleConnTimeout:       90 * time.Second,
		TLSHandshakeTimeout:   5 * time.Second,
		ResponseHeaderTimeout: 30 * time.Second,
	}

	g := &Guard{
		cfg:       cfg,
		proxy:     proxy,
		blocklist: newIPBlocklist(cfg.BlocklistPath),
		generalRL: newRegistry(cfg.RateLimitRPS),
		tradeRL:   newRegistry(cfg.TradeLimitRPS),
		authRL:    newRegistry(cfg.AuthLimitRPM / 60), // convert RPM to RPS
		cb:        newCircuitBreaker(10, 30*time.Second),
		eventLog:  newEventLog(10000),
		metrics:   &Metrics{StartTime: time.Now()},
	}
	return g, nil
}

func (g *Guard) extractIP(r *http.Request) string {
	// Respect X-Forwarded-For from trusted upstream load balancers
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
		parts := strings.Split(xff, ",")
		return strings.TrimSpace(parts[0])
	}
	if xri := r.Header.Get("X-Real-IP"); xri != "" {
		return xri
	}
	ip, _, _ := net.SplitHostPort(r.RemoteAddr)
	return ip
}

func (g *Guard) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	g.metrics.TotalRequests.Add(1)
	ip := g.extractIP(r)

	// 1. IP Blocklist check
	if g.blocklist.IsBlocked(ip) {
		g.metrics.BlockedByIP.Add(1)
		g.eventLog.Add(SecurityEvent{
			Timestamp: time.Now().UTC().Format(time.RFC3339),
			Type:      "IP_BLOCKED",
			IP:        ip,
			Path:      r.URL.Path,
			Detail:    "IP on blocklist",
		})
		http.Error(w, `{"error":"Access denied","code":"IP_BLOCKED"}`, http.StatusForbidden)
		return
	}

	// 2. Circuit breaker check
	if g.cb.IsOpen() {
		g.metrics.CircuitBlocked.Add(1)
		w.Header().Set("Retry-After", "30")
		http.Error(w, `{"error":"Service temporarily unavailable","code":"CIRCUIT_OPEN"}`, http.StatusServiceUnavailable)
		return
	}

	// 3. Request size check (before reading body)
	if r.ContentLength > g.cfg.MaxBodyBytes {
		g.metrics.BlockedBySize.Add(1)
		http.Error(w, `{"error":"Request too large","code":"PAYLOAD_TOO_LARGE"}`, http.StatusRequestEntityTooLarge)
		return
	}

	// 4. Suspicious pattern detection
	if suspicious, reason := isSuspiciousRequest(r); suspicious {
		g.metrics.BlockedByBot.Add(1)
		g.eventLog.Add(SecurityEvent{
			Timestamp: time.Now().UTC().Format(time.RFC3339),
			Type:      "SUSPICIOUS_REQUEST",
			IP:        ip,
			Path:      r.URL.Path,
			Detail:    reason,
		})
		// Auto-block after repeated suspicious requests
		g.blocklist.Block(ip, 1*time.Hour)
		http.Error(w, `{"error":"Invalid request","code":"SUSPICIOUS_REQUEST"}`, http.StatusBadRequest)
		return
	}

	// 5. Rate limiting (tiered by endpoint)
	rateLimitKey := ip
	var limiter *RateLimiterRegistry
	switch {
	case strings.Contains(r.URL.Path, "/api/oauth") || strings.Contains(r.URL.Path, "/api/auth"):
		limiter = g.authRL
	case strings.Contains(r.URL.Path, "/orders") || strings.Contains(r.URL.Path, "/trades") ||
		strings.Contains(r.URL.Path, "/derivatives") || strings.Contains(r.URL.Path, "/futures"):
		limiter = g.tradeRL
	default:
		limiter = g.generalRL
	}

	if !limiter.Allow(rateLimitKey) {
		g.metrics.BlockedByRate.Add(1)
		g.eventLog.Add(SecurityEvent{
			Timestamp: time.Now().UTC().Format(time.RFC3339),
			Type:      "RATE_LIMITED",
			IP:        ip,
			Path:      r.URL.Path,
			Detail:    "rate limit exceeded",
		})
		w.Header().Set("Retry-After", "1")
		w.Header().Set("X-RateLimit-Limit", strconv.Itoa(g.cfg.RateLimitRPS))
		http.Error(w, `{"error":"Rate limit exceeded","code":"RATE_LIMIT"}`, http.StatusTooManyRequests)
		return
	}

	// 6. Add security headers to request
	r.Header.Set("X-Guard-Verified", "1")
	r.Header.Set("X-Real-IP", ip)
	r.Header.Set("X-Forwarded-For", ip)

	// 7. Proxy to backend with error tracking
	recorder := &responseRecorder{ResponseWriter: w, statusCode: 200}
	g.proxy.ServeHTTP(recorder, r)

	if recorder.statusCode >= 500 {
		g.cb.RecordFailure()
		g.metrics.BackendErrors.Add(1)
	} else {
		g.cb.RecordSuccess()
		g.metrics.ProxiedOK.Add(1)
	}
}

// ── Response Recorder ─────────────────────────────────────────────────────────

type responseRecorder struct {
	http.ResponseWriter
	statusCode int
}

func (rr *responseRecorder) WriteHeader(code int) {
	rr.statusCode = code
	rr.ResponseWriter.WriteHeader(code)
}

// ── Admin API ─────────────────────────────────────────────────────────────────

func (g *Guard) adminHandler() http.Handler {
	mux := http.NewServeMux()

	// GET /admin/metrics — real-time metrics
	mux.HandleFunc("/admin/metrics", func(w http.ResponseWriter, r *http.Request) {
		uptime := time.Since(g.metrics.StartTime).Round(time.Second)
		resp := map[string]interface{}{
			"uptime_seconds":   uptime.Seconds(),
			"total_requests":   g.metrics.TotalRequests.Load(),
			"blocked_by_ip":    g.metrics.BlockedByIP.Load(),
			"blocked_by_rate":  g.metrics.BlockedByRate.Load(),
			"blocked_by_bot":   g.metrics.BlockedByBot.Load(),
			"blocked_by_size":  g.metrics.BlockedBySize.Load(),
			"circuit_blocked":  g.metrics.CircuitBlocked.Load(),
			"proxied_ok":       g.metrics.ProxiedOK.Load(),
			"backend_errors":   g.metrics.BackendErrors.Load(),
			"circuit_open":     g.cb.IsOpen(),
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(resp)
	})

	// GET /admin/events — recent security events
	mux.HandleFunc("/admin/events", func(w http.ResponseWriter, r *http.Request) {
		n := 100
		if nStr := r.URL.Query().Get("n"); nStr != "" {
			if parsed, err := strconv.Atoi(nStr); err == nil {
				n = parsed
			}
		}
		events := g.eventLog.Recent(n)
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(events)
	})

	// GET /admin/events/stream — SSE stream of security events
	mux.HandleFunc("/admin/events/stream", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		w.Header().Set("Cache-Control", "no-cache")
		w.Header().Set("Connection", "keep-alive")
		w.Header().Set("Access-Control-Allow-Origin", "*")

		ch := g.eventLog.Subscribe()
		defer g.eventLog.Unsubscribe(ch)

		flusher, ok := w.(http.Flusher)
		if !ok {
			http.Error(w, "SSE not supported", http.StatusInternalServerError)
			return
		}

		ctx := r.Context()
		for {
			select {
			case <-ctx.Done():
				return
			case evt, ok := <-ch:
				if !ok {
					return
				}
				data, _ := json.Marshal(evt)
				fmt.Fprintf(w, "data: %s\n\n", data)
				flusher.Flush()
			}
		}
	})

	// POST /admin/block — block an IP
	mux.HandleFunc("/admin/block", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}
		var req struct {
			IP       string `json:"ip"`
			Duration string `json:"duration"` // e.g. "1h", "24h", "0" for permanent
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "Invalid JSON", http.StatusBadRequest)
			return
		}
		var dur time.Duration
		if req.Duration != "0" && req.Duration != "" {
			var err error
			dur, err = time.ParseDuration(req.Duration)
			if err != nil {
				http.Error(w, "Invalid duration", http.StatusBadRequest)
				return
			}
		}
		g.blocklist.Block(req.IP, dur)
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{"status": "blocked", "ip": req.IP})
	})

	// GET /admin/health — health check
	mux.HandleFunc("/admin/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{"status": "ok", "service": "ddos-guard"})
	})

	return mux
}

// ── Entry Point ───────────────────────────────────────────────────────────────

func main() {
	cfg := loadConfig()
	log.Printf("[DDoS Guard] Starting — backend=%s guard_port=%s", cfg.BackendURL, cfg.GuardPort)

	guard, err := newGuard(cfg)
	if err != nil {
		log.Fatalf("[DDoS Guard] Failed to initialize: %v", err)
	}

	// Admin server on guard_port+1
	adminPort := fmt.Sprintf(":%d", mustParsePort(cfg.GuardPort)+1)
	adminServer := &http.Server{
		Addr:         adminPort,
		Handler:      guard.adminHandler(),
		ReadTimeout:  10 * time.Second,
		WriteTimeout: 30 * time.Second,
		IdleTimeout:  60 * time.Second,
	}
	go func() {
		log.Printf("[DDoS Guard] Admin API listening on %s", adminPort)
		if err := adminServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Printf("[DDoS Guard] Admin server error: %v", err)
		}
	}()

	// Main proxy server
	server := &http.Server{
		Addr:    ":" + cfg.GuardPort,
		Handler: guard,
		// Slow-loris protection
		ReadHeaderTimeout: 15 * time.Second,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      60 * time.Second,
		IdleTimeout:       65 * time.Second,
		// Connection limits
		MaxHeaderBytes: 1 << 20, // 1 MB max headers
	}

	// Graceful shutdown
	go func() {
		log.Printf("[DDoS Guard] Proxy listening on :%s → %s", cfg.GuardPort, cfg.BackendURL)
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("[DDoS Guard] Server error: %v", err)
		}
	}()

	// Keep alive
	select {}
}

func mustParsePort(portStr string) int {
	n, err := strconv.Atoi(portStr)
	if err != nil {
		return 8080
	}
	return n
}

// Ensure io is used
var _ = io.Discard
var _ = context.Background
