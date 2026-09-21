// DEPRECATED: This Go market data service has been superseded by:
//   - services/ingestion-engine/ (Python) — Universal ingestion with 38 data feeds,
//     Kafka/Fluvio integration, Lakehouse connectivity, schema registry
//   - services/gateway/ (Go) — WebSocket market data distribution via /ws/market-data
//
// This service is kept for reference only. Do NOT deploy in production.
// See services/ingestion-engine/ for the production data pipeline.
//
// NEXCOM Exchange - Market Data Service (LEGACY)
// High-frequency data ingestion, OHLCV aggregation, and WebSocket distribution.
// Integrates with Kafka for event streaming and Fluvio for low-latency feeds.
package main

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/nexcom-exchange/market-data/internal/feeds"
	"github.com/nexcom-exchange/market-data/internal/streaming"
	"go.uber.org/zap"
)

func main() {
	logger, _ := zap.NewProduction()
	defer logger.Sync()
	sugar := logger.Sugar()

	// ── Deprecated-service guard ──────────────────────────────────────────────
	// This Go market-data service is LEGACY (superseded by the ingestion-engine
	// lakehouse pipeline). Refuse to start unless explicitly allowed, so
	// accidental deployment is loud instead of silent.
	if os.Getenv("ALLOW_DEPRECATED") != "true" {
		sugar.Fatalw("REFUSING TO START: services/market-data is LEGACY/DEPRECATED — " +
			"use services/ingestion-engine (canonical ingestion path). " +
			"Set ALLOW_DEPRECATED=true ONLY for local reference/testing.",
			"replacement", "services/ingestion-engine")
	}
	sugar.Warnw("╔══════════════════════════════════════════════════════════════════╗")
	sugar.Warnw("║  WARNING: LEGACY market-data starting (ALLOW_DEPRECATED=true)    ║")
	sugar.Warnw("║  Canonical path: services/ingestion-engine. DO NOT DEPLOY        ║")
	sugar.Warnw("╚══════════════════════════════════════════════════════════════════╝")

	sugar.Info("Starting NEXCOM Market Data Service...")

	// Staleness threshold: prices older than this are flagged stale in responses
	staleThreshold := 60 * time.Second
	if v := os.Getenv("MARKET_DATA_STALENESS_THRESHOLD"); v != "" {
		if d, err := time.ParseDuration(v); err == nil && d > 0 {
			staleThreshold = d
		} else {
			sugar.Warnf("Invalid MARKET_DATA_STALENESS_THRESHOLD %q — using default 60s", v)
		}
	}
	feeds.SetStaleThreshold(staleThreshold)

	// Initialize feed processor for normalizing external data
	feedProcessor := feeds.NewProcessor(logger)

	// Upstream feed consumer with reconnect/backoff. When MARKET_DATA_FEED_URL
	// is unset the service serves NO fabricated prices — endpoints return 404 /
	// no_data health rather than silently stale numbers.
	feedCtx, feedCancel := context.WithCancel(context.Background())
	defer feedCancel()
	if feedURL := os.Getenv("MARKET_DATA_FEED_URL"); feedURL != "" {
		go feeds.RunFeedWithBackoff(feedCtx, feedURL, feedProcessor, logger)
		sugar.Infof("Upstream market-data feed enabled: %s", feedURL)
	} else {
		sugar.Warn("MARKET_DATA_FEED_URL not set — no upstream feed; tickers will report no_data/stale")
	}

	// Initialize WebSocket hub for real-time distribution
	wsHub := streaming.NewHub(logger)
	go wsHub.Run()

	// Setup HTTP + WebSocket server
	router := setupRouter(feedProcessor, wsHub, logger)

	port := os.Getenv("PORT")
	if port == "" {
		port = "8002"
	}

	srv := &http.Server{
		Addr:         fmt.Sprintf(":%s", port),
		Handler:      router,
		ReadTimeout:  10 * time.Second,
		WriteTimeout: 10 * time.Second,
	}

	go func() {
		sugar.Infof("Market Data Service listening on port %s", port)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			sugar.Fatalf("Failed to start server: %v", err)
		}
	}()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	sugar.Info("Shutting down Market Data Service...")
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	srv.Shutdown(ctx)
	sugar.Info("Market Data Service stopped")
}

func setupRouter(fp *feeds.Processor, hub *streaming.Hub, logger *zap.Logger) *gin.Engine {
	gin.SetMode(gin.ReleaseMode)
	router := gin.New()
	router.Use(gin.Recovery())

	router.GET("/healthz", func(c *gin.Context) {
		fs := fp.FeedStatus()
		status := "healthy"
		code := http.StatusOK
		if fs.Status != "fresh" {
			// Report degraded honestly when prices are stale or no feed is wired.
			status = "degraded"
			code = http.StatusServiceUnavailable
		}
		c.JSON(code, gin.H{"status": status, "service": "market-data", "feed": fs})
	})

	v1 := router.Group("/api/v1")
	{
		// Get current ticker for a symbol
		v1.GET("/market/ticker/:symbol", func(c *gin.Context) {
			symbol := c.Param("symbol")
			ticker, err := fp.GetTicker(symbol)
			if err != nil {
				c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
				return
			}
			c.JSON(http.StatusOK, ticker)
		})

		// Get OHLCV candles
		v1.GET("/market/candles/:symbol", func(c *gin.Context) {
			symbol := c.Param("symbol")
			interval := c.DefaultQuery("interval", "1h")
			limit := c.DefaultQuery("limit", "100")
			candles, err := fp.GetCandles(symbol, interval, limit)
			if err != nil {
				c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
				return
			}
			c.JSON(http.StatusOK, candles)
		})

		// Get 24h market summary
		v1.GET("/market/summary", func(c *gin.Context) {
			summary := fp.GetMarketSummary()
			c.JSON(http.StatusOK, summary)
		})

		// Feed freshness / staleness status
		v1.GET("/market/health", func(c *gin.Context) {
			fs := fp.FeedStatus()
			code := http.StatusOK
			if fs.Status != "fresh" {
				code = http.StatusServiceUnavailable
			}
			c.JSON(code, fs)
		})
	}

	// WebSocket endpoint for real-time streaming
	router.GET("/ws/v1/market", func(c *gin.Context) {
		hub.HandleWebSocket(c.Writer, c.Request)
	})

	return router
}
