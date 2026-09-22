// feed_runner.go — upstream market-data feed consumer with reconnect/backoff.
//
// Connects to an upstream WebSocket feed (MARKET_DATA_FEED_URL), decodes JSON
// ticks, and feeds them into the Processor. On any connection or read failure
// it reconnects with exponential backoff (1s → 60s cap) instead of silently
// serving stale data; while disconnected, the Processor's staleness flags mark
// all affected prices as stale in API responses.
package feeds

import (
	"context"
	"time"

	"github.com/gorilla/websocket"
	"go.uber.org/zap"
)

const (
	feedBackoffInitial = 1 * time.Second
	feedBackoffMax     = 60 * time.Second
	feedReadTimeout    = 90 * time.Second
)

// RunFeedWithBackoff consumes an upstream tick feed until ctx is cancelled.
// It never returns on transient errors — it reconnects with exponential
// backoff and logs every transition so feed outages are loud.
func RunFeedWithBackoff(ctx context.Context, feedURL string, p *Processor, logger *zap.Logger) {
	backoff := feedBackoffInitial
	for {
		if ctx.Err() != nil {
			return
		}
		err := consumeFeed(ctx, feedURL, p, logger)
		if ctx.Err() != nil {
			return
		}
		logger.Warn("market-data feed disconnected; backing off before reconnect",
			zap.String("url", feedURL),
			zap.Duration("backoff", backoff),
			zap.Error(err),
		)
		select {
		case <-ctx.Done():
			return
		case <-time.After(backoff):
		}
		backoff *= 2
		if backoff > feedBackoffMax {
			backoff = feedBackoffMax
		}
	}
}

// consumeFeed runs a single feed connection until it fails.
func consumeFeed(ctx context.Context, feedURL string, p *Processor, logger *zap.Logger) error {
	conn, _, err := websocket.DefaultDialer.DialContext(ctx, feedURL, nil)
	if err != nil {
		return err
	}
	defer conn.Close()

	logger.Info("market-data feed connected", zap.String("url", feedURL))

	// Watchdog: if no message arrives within feedReadTimeout the read fails
	// and the outer loop reconnects.
	done := make(chan struct{})
	defer close(done)
	go func() {
		select {
		case <-ctx.Done():
			_ = conn.Close()
		case <-done:
		}
	}()

	for {
		conn.SetReadDeadline(time.Now().Add(feedReadTimeout))
		_, message, err := conn.ReadMessage()
		if err != nil {
			return err
		}
		var tick Tick
		if err := decodeTick(message, &tick); err != nil {
			logger.Warn("dropping malformed feed tick", zap.Error(err))
			continue
		}
		if tick.Timestamp.IsZero() {
			tick.Timestamp = time.Now().UTC()
		}
		if err := p.ProcessTick(tick); err != nil {
			logger.Warn("tick rejected", zap.String("symbol", tick.Symbol), zap.Error(err))
		}
	}
}
