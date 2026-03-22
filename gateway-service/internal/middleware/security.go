package middleware

import (
	"fmt"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
)

// ============================================================
// Rate Limiter (Token Bucket)
// ============================================================

// RateLimiter implements a per-IP token bucket rate limiter.
type RateLimiter struct {
	mu      sync.RWMutex
	buckets map[string]*tokenBucket
	rate    int           // tokens per interval
	burst   int           // max burst
	window  time.Duration // refill interval
}

type tokenBucket struct {
	tokens    int
	lastRefil time.Time
}

// NewRateLimiter creates a rate limiter with the given rate (requests per window) and burst size.
func NewRateLimiter(rate int, burst int, window time.Duration) *RateLimiter {
	rl := &RateLimiter{
		buckets: make(map[string]*tokenBucket),
		rate:    rate,
		burst:   burst,
		window:  window,
	}
	// Cleanup stale entries every 5 minutes
	go func() {
		ticker := time.NewTicker(5 * time.Minute)
		defer ticker.Stop()
		for range ticker.C {
			rl.cleanup()
		}
	}()
	return rl
}

func (rl *RateLimiter) allow(key string) bool {
	rl.mu.Lock()
	defer rl.mu.Unlock()

	now := time.Now()
	bucket, exists := rl.buckets[key]
	if !exists {
		rl.buckets[key] = &tokenBucket{tokens: rl.burst - 1, lastRefil: now}
		return true
	}

	// Refill tokens based on elapsed time
	elapsed := now.Sub(bucket.lastRefil)
	refillCount := int(elapsed / rl.window) * rl.rate
	if refillCount > 0 {
		bucket.tokens += refillCount
		if bucket.tokens > rl.burst {
			bucket.tokens = rl.burst
		}
		bucket.lastRefil = now
	}

	if bucket.tokens > 0 {
		bucket.tokens--
		return true
	}
	return false
}

func (rl *RateLimiter) cleanup() {
	rl.mu.Lock()
	defer rl.mu.Unlock()
	cutoff := time.Now().Add(-10 * time.Minute)
	for key, bucket := range rl.buckets {
		if bucket.lastRefil.Before(cutoff) {
			delete(rl.buckets, key)
		}
	}
}

// RateLimitMiddleware applies per-IP rate limiting.
// Default: 100 requests per second with burst of 200.
func RateLimitMiddleware(rate, burst int) gin.HandlerFunc {
	limiter := NewRateLimiter(rate, burst, time.Second)
	return func(c *gin.Context) {
		ip := c.ClientIP()
		if !limiter.allow(ip) {
			c.Header("Retry-After", "1")
			c.JSON(http.StatusTooManyRequests, gin.H{
				"success": false,
				"error":   "rate limit exceeded",
			})
			c.Abort()
			return
		}
		c.Next()
	}
}

// ============================================================
// Security Headers
// ============================================================

// SecurityHeadersMiddleware adds comprehensive security headers to all responses.
func SecurityHeadersMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		// Prevent MIME type sniffing
		c.Header("X-Content-Type-Options", "nosniff")

		// Clickjacking protection
		c.Header("X-Frame-Options", "DENY")

		// XSS protection (legacy browsers)
		c.Header("X-XSS-Protection", "1; mode=block")

		// Referrer policy
		c.Header("Referrer-Policy", "strict-origin-when-cross-origin")

		// Permissions policy (restrict browser features)
		c.Header("Permissions-Policy", "camera=(), microphone=(), geolocation=(self), payment=(self)")

		// Content Security Policy
		c.Header("Content-Security-Policy", strings.Join([]string{
			"default-src 'self'",
			"script-src 'self' 'unsafe-inline' 'unsafe-eval'",
			"style-src 'self' 'unsafe-inline'",
			"img-src 'self' data: https:",
			"font-src 'self' data:",
			"connect-src 'self' ws: wss: http://localhost:* https://localhost:*",
			"frame-ancestors 'none'",
			"base-uri 'self'",
			"form-action 'self'",
		}, "; "))

		// Strict Transport Security (1 year, include subdomains)
		c.Header("Strict-Transport-Security", "max-age=31536000; includeSubDomains; preload")

		// Prevent caching of sensitive data
		if strings.HasPrefix(c.Request.URL.Path, "/api/") {
			c.Header("Cache-Control", "no-store, no-cache, must-revalidate, private")
			c.Header("Pragma", "no-cache")
		}

		c.Next()
	}
}

// ============================================================
// Request Size Limiter
// ============================================================

// RequestSizeLimitMiddleware limits the maximum request body size.
func RequestSizeLimitMiddleware(maxBytes int64) gin.HandlerFunc {
	return func(c *gin.Context) {
		if c.Request.ContentLength > maxBytes {
			c.JSON(http.StatusRequestEntityTooLarge, gin.H{
				"success": false,
				"error":   fmt.Sprintf("request body too large (max %d bytes)", maxBytes),
			})
			c.Abort()
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxBytes)
		c.Next()
	}
}

// ============================================================
// Input Sanitization
// ============================================================

// InputSanitizationMiddleware rejects requests with common injection patterns.
func InputSanitizationMiddleware() gin.HandlerFunc {
	// Patterns that indicate potential attacks
	dangerousPatterns := []string{
		"<script",
		"javascript:",
		"onerror=",
		"onload=",
		"eval(",
		"document.cookie",
		"window.location",
		"../../../",
		"%00",          // null byte
		"0x",           // hex injection
	}

	return func(c *gin.Context) {
		// Check URL path
		path := strings.ToLower(c.Request.URL.Path)
		query := strings.ToLower(c.Request.URL.RawQuery)

		for _, pattern := range dangerousPatterns {
			if strings.Contains(path, pattern) || strings.Contains(query, pattern) {
				c.JSON(http.StatusBadRequest, gin.H{
					"success": false,
					"error":   "invalid request",
				})
				c.Abort()
				return
			}
		}

		c.Next()
	}
}

// ============================================================
// CORS Hardening
// ============================================================

// StrictCORSMiddleware provides strict CORS with configurable allowed origins.
func StrictCORSMiddleware(allowedOrigins []string) gin.HandlerFunc {
	originSet := make(map[string]bool)
	for _, o := range allowedOrigins {
		originSet[strings.TrimSpace(o)] = true
	}

	return func(c *gin.Context) {
		origin := c.GetHeader("Origin")

		if origin != "" && originSet[origin] {
			c.Header("Access-Control-Allow-Origin", origin)
			c.Header("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
			c.Header("Access-Control-Allow-Headers", "Origin, Content-Type, Authorization, X-Request-ID, X-Trace-ID")
			c.Header("Access-Control-Allow-Credentials", "true")
			c.Header("Access-Control-Max-Age", "86400")
			c.Header("Vary", "Origin")
		}

		if c.Request.Method == "OPTIONS" {
			c.AbortWithStatus(http.StatusNoContent)
			return
		}

		c.Next()
	}
}

// ============================================================
// API Key Authentication (for service-to-service)
// ============================================================

// APIKeyMiddleware validates API keys for service-to-service communication.
// Keys are loaded from environment variables.
func APIKeyMiddleware(validKeys map[string]string) gin.HandlerFunc {
	return func(c *gin.Context) {
		apiKey := c.GetHeader("X-API-Key")
		if apiKey == "" {
			// Fall through to other auth methods
			c.Next()
			return
		}

		// Validate API key
		for _, key := range validKeys {
			if apiKey == key {
				c.Set("authMethod", "api-key")
				c.Next()
				return
			}
		}

		c.JSON(http.StatusUnauthorized, gin.H{
			"success": false,
			"error":   "invalid API key",
		})
		c.Abort()
	}
}
