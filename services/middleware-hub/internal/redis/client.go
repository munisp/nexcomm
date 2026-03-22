// Package redis provides Redis integration for NEXCOM.
// Implements distributed caching (order book snapshots, session tokens, rate limits),
// pub/sub for real-time price feeds, and distributed locks for settlement coordination.
package redis

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"time"

	goredis "github.com/go-redis/redis/v8"
	"go.uber.org/zap"
)

// Key prefixes for organized namespace management
const (
	PrefixOrderBook    = "nexcom:orderbook:"     // Order book snapshots per symbol
	PrefixSession      = "nexcom:session:"       // User session tokens
	PrefixRateLimit    = "nexcom:ratelimit:"     // API rate limiting counters
	PrefixPriceCache   = "nexcom:price:"         // Latest price per symbol
	PrefixSettleLock   = "nexcom:lock:settle:"   // Distributed locks for settlement
	PrefixKYCCache     = "nexcom:kyc:"           // KYC status cache
	PrefixAMLScore     = "nexcom:aml:score:"     // AML risk score cache
	PrefixTokenBalance = "nexcom:token:balance:" // Commodity token balance cache
	PrefixMarketDepth  = "nexcom:depth:"         // Market depth cache
	PrefixUserPerms    = "nexcom:perms:"         // User permissions cache (Permify)
)

// TTL constants for cache expiry
const (
	TTLOrderBook    = 5 * time.Second
	TTLSession      = 24 * time.Hour
	TTLRateLimit    = 1 * time.Minute
	TTLPriceCache   = 1 * time.Second
	TTLSettleLock   = 30 * time.Second
	TTLKYCCache     = 1 * time.Hour
	TTLAMLScore     = 15 * time.Minute
	TTLTokenBalance = 10 * time.Second
	TTLMarketDepth  = 2 * time.Second
	TTLUserPerms    = 5 * time.Minute
)

// OrderBookSnapshot represents a cached order book state
type OrderBookSnapshot struct {
	Symbol    string        `json:"symbol"`
	Bids      []PriceLevel  `json:"bids"`
	Asks      []PriceLevel  `json:"asks"`
	Timestamp time.Time     `json:"timestamp"`
	Sequence  int64         `json:"sequence"`
}

// PriceLevel represents a single price level in the order book
type PriceLevel struct {
	Price    float64 `json:"price"`
	Quantity float64 `json:"quantity"`
	Count    int     `json:"count"`
}

// PriceTick represents a real-time price update
type PriceTick struct {
	Symbol    string    `json:"symbol"`
	Price     float64   `json:"price"`
	Change24h float64   `json:"change_24h"`
	Volume24h float64   `json:"volume_24h"`
	High24h   float64   `json:"high_24h"`
	Low24h    float64   `json:"low_24h"`
	Timestamp time.Time `json:"timestamp"`
}

// Client wraps the go-redis client with NEXCOM-specific operations
type Client struct {
	rdb    *goredis.Client
	logger *zap.SugaredLogger
}

// NewClient creates a new Redis client
func NewClient(logger *zap.SugaredLogger) *Client {
	addr := os.Getenv("REDIS_URL")
	if addr == "" {
		addr = "localhost:6379"
	}
	password := os.Getenv("REDIS_PASSWORD")

	rdb := goredis.NewClient(&goredis.Options{
		Addr:         addr,
		Password:     password,
		DB:           0,
		PoolSize:     20,
		MinIdleConns: 5,
		DialTimeout:  5 * time.Second,
		ReadTimeout:  3 * time.Second,
		WriteTimeout: 3 * time.Second,
	})

	return &Client{rdb: rdb, logger: logger}
}

// HealthCheck pings the Redis server
func (c *Client) HealthCheck(ctx context.Context) bool {
	return c.rdb.Ping(ctx).Err() == nil
}

// SetOrderBook caches an order book snapshot for a symbol
func (c *Client) SetOrderBook(ctx context.Context, symbol string, snapshot OrderBookSnapshot) error {
	data, err := json.Marshal(snapshot)
	if err != nil {
		return fmt.Errorf("marshal error: %w", err)
	}
	key := PrefixOrderBook + symbol
	return c.rdb.Set(ctx, key, data, TTLOrderBook).Err()
}

// GetOrderBook retrieves a cached order book snapshot
func (c *Client) GetOrderBook(ctx context.Context, symbol string) (*OrderBookSnapshot, error) {
	key := PrefixOrderBook + symbol
	data, err := c.rdb.Get(ctx, key).Bytes()
	if err == goredis.Nil {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("redis get error: %w", err)
	}
	var snapshot OrderBookSnapshot
	if err := json.Unmarshal(data, &snapshot); err != nil {
		return nil, fmt.Errorf("unmarshal error: %w", err)
	}
	return &snapshot, nil
}

// SetPrice caches the latest price for a symbol
func (c *Client) SetPrice(ctx context.Context, tick PriceTick) error {
	data, err := json.Marshal(tick)
	if err != nil {
		return fmt.Errorf("marshal error: %w", err)
	}
	key := PrefixPriceCache + tick.Symbol
	return c.rdb.Set(ctx, key, data, TTLPriceCache).Err()
}

// GetPrice retrieves the latest cached price for a symbol
func (c *Client) GetPrice(ctx context.Context, symbol string) (*PriceTick, error) {
	key := PrefixPriceCache + symbol
	data, err := c.rdb.Get(ctx, key).Bytes()
	if err == goredis.Nil {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("redis get error: %w", err)
	}
	var tick PriceTick
	if err := json.Unmarshal(data, &tick); err != nil {
		return nil, fmt.Errorf("unmarshal error: %w", err)
	}
	return &tick, nil
}

// AcquireSettlementLock acquires a distributed lock for settlement processing
// Returns true if lock was acquired, false if already locked
func (c *Client) AcquireSettlementLock(ctx context.Context, settlementID string) (bool, error) {
	key := PrefixSettleLock + settlementID
	result, err := c.rdb.SetNX(ctx, key, "locked", TTLSettleLock).Result()
	if err != nil {
		return false, fmt.Errorf("redis lock error: %w", err)
	}
	return result, nil
}

// ReleaseSettlementLock releases a distributed settlement lock
func (c *Client) ReleaseSettlementLock(ctx context.Context, settlementID string) error {
	key := PrefixSettleLock + settlementID
	return c.rdb.Del(ctx, key).Err()
}

// CheckRateLimit implements token bucket rate limiting
// Returns (allowed bool, remaining int, resetAt time.Time)
func (c *Client) CheckRateLimit(ctx context.Context, userID string, limit int, window time.Duration) (bool, int64, error) {
	key := PrefixRateLimit + userID
	pipe := c.rdb.Pipeline()
	incr := pipe.Incr(ctx, key)
	pipe.Expire(ctx, key, window)
	_, err := pipe.Exec(ctx)
	if err != nil {
		return false, 0, fmt.Errorf("rate limit pipeline error: %w", err)
	}
	count := incr.Val()
	remaining := int64(limit) - count
	if remaining < 0 {
		remaining = 0
	}
	return count <= int64(limit), remaining, nil
}

// SetKYCStatus caches a user's KYC status
func (c *Client) SetKYCStatus(ctx context.Context, userID string, status string, riskLevel string) error {
	data, err := json.Marshal(map[string]string{
		"status":     status,
		"risk_level": riskLevel,
		"cached_at":  time.Now().UTC().Format(time.RFC3339),
	})
	if err != nil {
		return fmt.Errorf("marshal error: %w", err)
	}
	key := PrefixKYCCache + userID
	return c.rdb.Set(ctx, key, data, TTLKYCCache).Err()
}

// GetKYCStatus retrieves a cached KYC status
func (c *Client) GetKYCStatus(ctx context.Context, userID string) (map[string]string, error) {
	key := PrefixKYCCache + userID
	data, err := c.rdb.Get(ctx, key).Bytes()
	if err == goredis.Nil {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("redis get error: %w", err)
	}
	var status map[string]string
	if err := json.Unmarshal(data, &status); err != nil {
		return nil, fmt.Errorf("unmarshal error: %w", err)
	}
	return status, nil
}

// SetAMLScore caches an AML risk score for a user
func (c *Client) SetAMLScore(ctx context.Context, userID string, score float64, flags []string) error {
	data, err := json.Marshal(map[string]interface{}{
		"score":     score,
		"flags":     flags,
		"cached_at": time.Now().UTC().Format(time.RFC3339),
	})
	if err != nil {
		return fmt.Errorf("marshal error: %w", err)
	}
	key := PrefixAMLScore + userID
	return c.rdb.Set(ctx, key, data, TTLAMLScore).Err()
}

// PublishPriceTick publishes a price tick to the Redis pub/sub channel
func (c *Client) PublishPriceTick(ctx context.Context, tick PriceTick) error {
	data, err := json.Marshal(tick)
	if err != nil {
		return fmt.Errorf("marshal error: %w", err)
	}
	channel := "nexcom:prices:" + tick.Symbol
	return c.rdb.Publish(ctx, channel, data).Err()
}

// SubscribePriceFeed subscribes to real-time price updates for a symbol
func (c *Client) SubscribePriceFeed(ctx context.Context, symbol string) *goredis.PubSub {
	channel := "nexcom:prices:" + symbol
	return c.rdb.Subscribe(ctx, channel)
}

// SetUserPermissions caches user permissions from Permify
func (c *Client) SetUserPermissions(ctx context.Context, userID string, perms map[string]bool) error {
	data, err := json.Marshal(perms)
	if err != nil {
		return fmt.Errorf("marshal error: %w", err)
	}
	key := PrefixUserPerms + userID
	return c.rdb.Set(ctx, key, data, TTLUserPerms).Err()
}

// GetUserPermissions retrieves cached user permissions
func (c *Client) GetUserPermissions(ctx context.Context, userID string) (map[string]bool, error) {
	key := PrefixUserPerms + userID
	data, err := c.rdb.Get(ctx, key).Bytes()
	if err == goredis.Nil {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("redis get error: %w", err)
	}
	var perms map[string]bool
	if err := json.Unmarshal(data, &perms); err != nil {
		return nil, fmt.Errorf("unmarshal error: %w", err)
	}
	return perms, nil
}

// InvalidateUserPermissions removes cached permissions (e.g., after role change)
func (c *Client) InvalidateUserPermissions(ctx context.Context, userID string) error {
	key := PrefixUserPerms + userID
	return c.rdb.Del(ctx, key).Err()
}

// Close gracefully shuts down the Redis connection pool
func (c *Client) Close() error {
	return c.rdb.Close()
}
