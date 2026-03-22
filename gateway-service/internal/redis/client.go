// Package redis provides a production-grade Redis client for NEXCOM Exchange.
// Uses github.com/redis/go-redis/v9 with real RESP3 protocol, replacing the
// previous raw TCP implementation. Maintains the same public interface so
// callers in server.go require no changes.
package redis

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"sync"
	"time"

	goredis "github.com/redis/go-redis/v9"
)

// Client wraps go-redis/v9 with graceful fallback to in-memory store.
// Key patterns:
//
//	cache:market:{symbol}        - Market ticker cache (TTL: 1s)
//	cache:orderbook:{symbol}     - Order book cache (TTL: 500ms)
//	cache:portfolio:{userId}     - Portfolio cache (TTL: 5s)
//	session:{sessionId}          - User session data (TTL: 24h)
//	rate:{userId}:{endpoint}     - Rate limiting counters (sliding window)
type Client struct {
	rdb          *goredis.Client
	connected    bool
	fallbackMode bool
	mu           sync.RWMutex
	store        map[string]cacheEntry // in-memory fallback
	url          string
}

type cacheEntry struct {
	data      []byte
	expiresAt time.Time
}

// NewClient creates a Redis client that connects via the official go-redis/v9
// library using the RESP2/RESP3 protocol. Falls back to in-memory cache if
// the Redis server is unreachable.
func NewClient(url string) *Client {
	c := &Client{
		url:   url,
		store: make(map[string]cacheEntry),
	}
	c.connect()
	return c
}

func (c *Client) connect() {
	log.Printf("[Redis] Connecting to %s", c.url)

	opts, err := goredis.ParseURL(c.url)
	if err != nil {
		// Treat url as plain host:port
		opts = &goredis.Options{
			Addr:            c.url,
			MaxRetries:      3,
			MinRetryBackoff: time.Millisecond,
			MaxRetryBackoff: 100 * time.Millisecond,
			PoolSize:        50,
			MinIdleConns:    10,
			ReadTimeout:     500 * time.Millisecond,
			WriteTimeout:    500 * time.Millisecond,
			DialTimeout:     5 * time.Second,
		}
	}

	rdb := goredis.NewClient(opts)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if pingErr := rdb.Ping(ctx).Err(); pingErr != nil {
		log.Printf("[Redis] WARN: Cannot reach %s: %v — running in fallback mode (in-memory cache)", c.url, pingErr)
		c.mu.Lock()
		c.fallbackMode = true
		c.connected = false
		c.mu.Unlock()
		return
	}

	c.mu.Lock()
	c.rdb = rdb
	c.connected = true
	c.fallbackMode = false
	c.mu.Unlock()
	log.Printf("[Redis] Connected to %s (go-redis/v9 RESP3 verified)", c.url)
}

// ─── Core operations (preserve existing interface) ────────────────────────────

// Set stores a value with TTL. Marshals value to JSON.
func (c *Client) Set(key string, value interface{}, ttl time.Duration) error {
	data, err := json.Marshal(value)
	if err != nil {
		return fmt.Errorf("redis Set marshal: %w", err)
	}

	c.mu.RLock()
	fb := c.fallbackMode
	c.mu.RUnlock()

	if fb {
		c.mu.Lock()
		c.store[key] = cacheEntry{data: data, expiresAt: time.Now().Add(ttl)}
		c.mu.Unlock()
		return nil
	}

	ctx, cancel := context.WithTimeout(context.Background(), 500*time.Millisecond)
	defer cancel()
	return c.rdb.Set(ctx, key, data, ttl).Err()
}

// Get retrieves a cached value and unmarshals it into dest.
// Returns ErrCacheMiss if the key does not exist or has expired.
func (c *Client) Get(key string, dest interface{}) error {
	c.mu.RLock()
	fb := c.fallbackMode
	c.mu.RUnlock()

	if fb {
		c.mu.RLock()
		entry, ok := c.store[key]
		c.mu.RUnlock()
		if !ok || time.Now().After(entry.expiresAt) {
			return ErrCacheMiss
		}
		return json.Unmarshal(entry.data, dest)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 500*time.Millisecond)
	defer cancel()

	data, err := c.rdb.Get(ctx, key).Bytes()
	if err == goredis.Nil {
		return ErrCacheMiss
	}
	if err != nil {
		return fmt.Errorf("redis Get: %w", err)
	}
	return json.Unmarshal(data, dest)
}

// Delete removes one or more keys.
func (c *Client) Delete(key string) error {
	c.mu.RLock()
	fb := c.fallbackMode
	c.mu.RUnlock()

	if fb {
		c.mu.Lock()
		delete(c.store, key)
		c.mu.Unlock()
		return nil
	}

	ctx, cancel := context.WithTimeout(context.Background(), 500*time.Millisecond)
	defer cancel()
	return c.rdb.Del(ctx, key).Err()
}

// Increment atomically increments a counter and sets TTL on first creation.
// Used for rate limiting.
func (c *Client) Increment(key string, ttl time.Duration) (int64, error) {
	c.mu.RLock()
	fb := c.fallbackMode
	c.mu.RUnlock()

	if fb {
		c.mu.Lock()
		defer c.mu.Unlock()
		entry, exists := c.store[key]
		if !exists || time.Now().After(entry.expiresAt) {
			data, _ := json.Marshal(int64(1))
			c.store[key] = cacheEntry{data: data, expiresAt: time.Now().Add(ttl)}
			return 1, nil
		}
		var count int64
		_ = json.Unmarshal(entry.data, &count)
		count++
		data, _ := json.Marshal(count)
		c.store[key] = cacheEntry{data: data, expiresAt: entry.expiresAt}
		return count, nil
	}

	ctx, cancel := context.WithTimeout(context.Background(), 500*time.Millisecond)
	defer cancel()

	pipe := c.rdb.TxPipeline()
	incr := pipe.Incr(ctx, key)
	pipe.Expire(ctx, key, ttl)
	if _, err := pipe.Exec(ctx); err != nil {
		return 0, fmt.Errorf("redis Increment: %w", err)
	}
	return incr.Val(), nil
}

// CheckRateLimit checks if a request exceeds the rate limit using a sliding
// window implemented with a Redis sorted set and a Lua script for atomicity.
// Falls back to permissive allow-all when Redis is unavailable.
func (c *Client) CheckRateLimit(userID string, endpoint string, maxRequests int64, window time.Duration) (bool, error) {
	c.mu.RLock()
	fb := c.fallbackMode
	c.mu.RUnlock()

	if fb {
		// Permissive fallback — allow all requests when Redis is unavailable
		return true, nil
	}

	key := "rate:" + userID + ":" + endpoint
	ctx, cancel := context.WithTimeout(context.Background(), 500*time.Millisecond)
	defer cancel()

	now := time.Now().UnixMilli()
	windowStart := now - window.Milliseconds()

	// Atomic sliding window using sorted set + Lua script
	luaScript := goredis.NewScript(`
		local key = KEYS[1]
		local now = tonumber(ARGV[1])
		local window_start = tonumber(ARGV[2])
		local limit = tonumber(ARGV[3])
		local window_ms = tonumber(ARGV[4])
		redis.call('ZREMRANGEBYSCORE', key, '-inf', window_start)
		local count = redis.call('ZCARD', key)
		if count < limit then
			redis.call('ZADD', key, now, now .. math.random(1000000))
			redis.call('PEXPIRE', key, window_ms)
			return 1
		end
		return 0
	`)

	result, err := luaScript.Run(ctx, c.rdb, []string{key},
		now, windowStart, maxRequests, window.Milliseconds()).Int64()
	if err != nil {
		log.Printf("[Redis] Rate limit script error: %v — allowing request", err)
		return true, nil
	}
	return result == 1, nil
}

// ─── Pub/Sub ──────────────────────────────────────────────────────────────────

// Publish sends a message to a Redis channel.
func (c *Client) Publish(ctx context.Context, channel string, message interface{}) error {
	data, err := json.Marshal(message)
	if err != nil {
		return fmt.Errorf("redis Publish marshal: %w", err)
	}

	c.mu.RLock()
	fb := c.fallbackMode
	c.mu.RUnlock()

	if fb {
		return nil // No-op in fallback mode
	}
	return c.rdb.Publish(ctx, channel, data).Err()
}

// ─── Status ───────────────────────────────────────────────────────────────────

// IsConnected returns true if the client has a live Redis connection.
func (c *Client) IsConnected() bool {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.connected
}

// IsFallback returns true if the client is running in in-memory fallback mode.
func (c *Client) IsFallback() bool {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.fallbackMode
}

// Reconnect attempts to re-establish the Redis connection.
func (c *Client) Reconnect() {
	c.mu.RLock()
	if c.connected && !c.fallbackMode {
		c.mu.RUnlock()
		return
	}
	c.mu.RUnlock()
	c.connect()
}

// Close gracefully closes the Redis connection.
func (c *Client) Close() {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.rdb != nil {
		_ = c.rdb.Close()
	}
	c.connected = false
	log.Println("[Redis] Connection closed")
}

// Ping checks the Redis connection health.
func (c *Client) Ping() error {
	c.mu.RLock()
	fb := c.fallbackMode
	c.mu.RUnlock()
	if fb {
		return fmt.Errorf("redis: running in fallback mode")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	return c.rdb.Ping(ctx).Err()
}

// ErrCacheMiss indicates a cache miss.
type CacheMissError struct{}

func (e CacheMissError) Error() string { return "cache miss" }

// ErrCacheMiss is returned by Get when the key does not exist or has expired.
var ErrCacheMiss = CacheMissError{}
