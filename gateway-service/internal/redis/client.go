package redis

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sync"
	"time"

	goredis "github.com/redis/go-redis/v9"
)

var (
	ErrUnavailable = errors.New("redis unavailable")
	ErrCacheMiss   = CacheMissError{}
)

type Client struct {
	rdb       *goredis.Client
	connected bool
	mu        sync.RWMutex
	url       string
}

func NewClient(url string) *Client {
	c := &Client{url: url}
	_ = c.connect()
	return c
}

func (c *Client) connect() error {
	opts, err := goredis.ParseURL(c.url)
	if err != nil {
		opts = &goredis.Options{Addr: c.url, MaxRetries: 3, MinRetryBackoff: time.Millisecond, MaxRetryBackoff: 100 * time.Millisecond, PoolSize: 50, MinIdleConns: 10, ReadTimeout: 500 * time.Millisecond, WriteTimeout: 500 * time.Millisecond, DialTimeout: 5 * time.Second}
	}
	rdb := goredis.NewClient(opts)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := rdb.Ping(ctx).Err(); err != nil {
		_ = rdb.Close()
		c.mu.Lock()
		c.connected = false
		c.mu.Unlock()
		return fmt.Errorf("%w: %v", ErrUnavailable, err)
	}
	c.mu.Lock()
	if c.rdb != nil {
		_ = c.rdb.Close()
	}
	c.rdb = rdb
	c.connected = true
	c.mu.Unlock()
	return nil
}

func (c *Client) requireClient() (*goredis.Client, error) {
	c.mu.RLock()
	rdb, connected := c.rdb, c.connected
	c.mu.RUnlock()
	if connected && rdb != nil {
		return rdb, nil
	}
	if err := c.connect(); err != nil {
		return nil, err
	}
	c.mu.RLock()
	rdb = c.rdb
	c.mu.RUnlock()
	if rdb == nil {
		return nil, ErrUnavailable
	}
	return rdb, nil
}

func (c *Client) Set(key string, value interface{}, ttl time.Duration) error {
	data, err := json.Marshal(value)
	if err != nil {
		return fmt.Errorf("redis Set marshal: %w", err)
	}
	rdb, err := c.requireClient()
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 500*time.Millisecond)
	defer cancel()
	if err := rdb.Set(ctx, key, data, ttl).Err(); err != nil {
		return fmt.Errorf("redis Set: %w", err)
	}
	return nil
}

func (c *Client) Get(key string, dest interface{}) error {
	rdb, err := c.requireClient()
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 500*time.Millisecond)
	defer cancel()
	data, err := rdb.Get(ctx, key).Bytes()
	if errors.Is(err, goredis.Nil) {
		return ErrCacheMiss
	}
	if err != nil {
		return fmt.Errorf("redis Get: %w", err)
	}
	return json.Unmarshal(data, dest)
}

func (c *Client) Delete(key string) error {
	rdb, err := c.requireClient()
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 500*time.Millisecond)
	defer cancel()
	if err := rdb.Del(ctx, key).Err(); err != nil {
		return fmt.Errorf("redis Delete: %w", err)
	}
	return nil
}

func (c *Client) Increment(key string, ttl time.Duration) (int64, error) {
	rdb, err := c.requireClient()
	if err != nil {
		return 0, err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 500*time.Millisecond)
	defer cancel()
	pipe := rdb.TxPipeline()
	incr := pipe.Incr(ctx, key)
	pipe.Expire(ctx, key, ttl)
	if _, err := pipe.Exec(ctx); err != nil {
		return 0, fmt.Errorf("redis Increment: %w", err)
	}
	return incr.Val(), nil
}

func (c *Client) CheckRateLimit(userID, endpoint string, maxRequests int64, window time.Duration) (bool, error) {
	if userID == "" || endpoint == "" || maxRequests <= 0 || window <= 0 {
		return false, errors.New("invalid rate-limit parameters")
	}
	rdb, err := c.requireClient()
	if err != nil {
		return false, err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 500*time.Millisecond)
	defer cancel()
	now := time.Now().UnixMilli()
	windowStart := now - window.Milliseconds()
	script := goredis.NewScript(`
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
	result, err := script.Run(ctx, rdb, []string{"rate:" + userID + ":" + endpoint}, now, windowStart, maxRequests, window.Milliseconds()).Int64()
	if err != nil {
		return false, fmt.Errorf("redis rate-limit script: %w", err)
	}
	return result == 1, nil
}

func (c *Client) Publish(ctx context.Context, channel string, message interface{}) error {
	data, err := json.Marshal(message)
	if err != nil {
		return fmt.Errorf("redis Publish marshal: %w", err)
	}
	rdb, err := c.requireClient()
	if err != nil {
		return err
	}
	if err := rdb.Publish(ctx, channel, data).Err(); err != nil {
		return fmt.Errorf("redis Publish: %w", err)
	}
	return nil
}

func (c *Client) IsConnected() bool { c.mu.RLock(); defer c.mu.RUnlock(); return c.connected }
func (c *Client) IsFallback() bool  { return false }
func (c *Client) Reconnect()        { _ = c.connect() }
func (c *Client) Close() {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.rdb != nil {
		_ = c.rdb.Close()
		c.rdb = nil
	}
	c.connected = false
}
func (c *Client) Ping() error {
	rdb, err := c.requireClient()
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	return rdb.Ping(ctx).Err()
}

type CacheMissError struct{}

func (CacheMissError) Error() string { return "cache miss" }
