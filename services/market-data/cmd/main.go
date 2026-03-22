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

	sugar.Info("Starting NEXCOM Market Data Service...")

	// Initialize feed processor for normalizing external data
	feedProcessor := feeds.NewProcessor(logger)

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
		c.JSON(http.StatusOK, gin.H{"status": "healthy", "service": "market-data"})
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
	}

	// WebSocket endpoint for real-time streaming
	router.GET("/ws/v1/market", func(c *gin.Context) {
		hub.HandleWebSocket(c.Writer, c.Request)
	})

	return router
}
