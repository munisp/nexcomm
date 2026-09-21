/*
 * Package dedup provides a minimal Redis SET NX PX client implemented over the
 * Go standard library (RESP2 protocol), used for inbound webhook idempotency.
 *
 * It mirrors the SET NX + TTL semantics of gateway-service/internal/redis
 * without adding a module dependency to channel-gateway's go.mod.
 *
 * Usage:
 *   c, _ := dedup.NewRedisClient(os.Getenv("REDIS_URL"))
 *   first, err := c.SetNX(ctx, "nexcom:telegram:update:123", "1", 24*time.Hour)
 *   // first == true  → first occurrence, process
 *   // first == false → duplicate delivery, skip
 */
package dedup

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"net"
	"net/url"
	"strings"
	"time"
)

// RedisClient is a minimal RESP2 client supporting AUTH + SET NX PX.
type RedisClient struct {
	addr     string
	password string
	dialTO   time.Duration
	opTO     time.Duration
}

// NewRedisClient parses a redis://[:password@]host[:port] URL.
func NewRedisClient(rawURL string) (*RedisClient, error) {
	if rawURL == "" {
		return nil, errors.New("empty REDIS_URL")
	}
	u, err := url.Parse(rawURL)
	if err != nil {
		return nil, fmt.Errorf("parse REDIS_URL: %w", err)
	}
	addr := u.Host
	if addr == "" {
		addr = rawURL // tolerate bare host:port
	}
	if !strings.Contains(addr, ":") {
		addr += ":6379"
	}
	pw := ""
	if u.User != nil {
		pw, _ = u.User.Password()
	}
	return &RedisClient{addr: addr, password: pw, dialTO: 3 * time.Second, opTO: 3 * time.Second}, nil
}

// SetNX sets key=value only if the key does not exist, with the given TTL.
// Returns true when the key was set (first occurrence) and false when it
// already existed (duplicate delivery).
func (c *RedisClient) SetNX(ctx context.Context, key, value string, ttl time.Duration) (bool, error) {
	d := net.Dialer{Timeout: c.dialTO}
	conn, err := d.DialContext(ctx, "tcp", c.addr)
	if err != nil {
		return false, fmt.Errorf("redis dial %s: %w", c.addr, err)
	}
	defer conn.Close()
	_ = conn.SetDeadline(time.Now().Add(c.opTO))
	br := bufio.NewReader(conn)

	if c.password != "" {
		if err := writeCommand(conn, "AUTH", c.password); err != nil {
			return false, err
		}
		if _, err := readReply(br); err != nil {
			return false, fmt.Errorf("redis AUTH: %w", err)
		}
	}

	px := fmt.Sprintf("%d", ttl.Milliseconds())
	if err := writeCommand(conn, "SET", key, value, "NX", "PX", px); err != nil {
		return false, err
	}
	reply, err := readReply(br)
	if err != nil {
		return false, fmt.Errorf("redis SET NX PX: %w", err)
	}
	// SET ... NX returns +OK when the key was set, nil (Null Bulk) otherwise.
	return reply == "OK", nil
}

func writeCommand(conn net.Conn, args ...string) error {
	var b strings.Builder
	fmt.Fprintf(&b, "*%d\r\n", len(args))
	for _, a := range args {
		fmt.Fprintf(&b, "$%d\r\n%s\r\n", len(a), a)
	}
	_, err := conn.Write([]byte(b.String()))
	return err
}

// readReply parses simple strings (+OK), errors (-ERR) and bulk strings
// ($-1 nil → empty string, $n → value). Sufficient for AUTH/SET replies.
func readReply(br *bufio.Reader) (string, error) {
	line, err := br.ReadString('\n')
	if err != nil {
		return "", fmt.Errorf("redis read: %w", err)
	}
	if len(line) < 1 {
		return "", errors.New("empty redis reply")
	}
	switch line[0] {
	case '+':
		return strings.TrimRight(line[1:], "\r\n"), nil
	case '-':
		return "", errors.New(strings.TrimRight(line[1:], "\r\n"))
	case '$':
		if strings.HasPrefix(line, "$-1") {
			return "", nil // nil bulk (NX condition not met)
		}
		value, err := br.ReadString('\n')
		if err != nil {
			return "", fmt.Errorf("redis read bulk: %w", err)
		}
		return strings.TrimRight(value, "\r\n"), nil
	default:
		return "", fmt.Errorf("unexpected redis reply type: %q", line)
	}
}
