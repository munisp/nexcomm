// Package main is the entry point for the NEXCOM Middleware Hub.
// This service orchestrates all middleware integrations: Kafka, Dapr, Redis,
// Temporal, TigerBeetle, Lakehouse, APISIX, and Fluvio streaming.
// Exposes HTTP endpoints for health checks, event ingestion, and control.
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/gin-gonic/gin"
	"go.uber.org/zap"

	"github.com/nexcom-exchange/middleware-hub/internal/apisix"
	"github.com/nexcom-exchange/middleware-hub/internal/dapr"
	"github.com/nexcom-exchange/middleware-hub/internal/fluvio"
	"github.com/nexcom-exchange/middleware-hub/internal/kafka"
	"github.com/nexcom-exchange/middleware-hub/internal/lakehouse"
	"github.com/nexcom-exchange/middleware-hub/internal/redis"
	"github.com/nexcom-exchange/middleware-hub/internal/temporal"
	"github.com/nexcom-exchange/middleware-hub/internal/tigerbeetle"
)

// Hub holds all middleware clients
type Hub struct {
	kafka       *kafka.Producer
	dapr        *dapr.Client
	redis       *redis.Client
	tigerbeetle *tigerbeetle.Client
	lakehouse   *lakehouse.Writer
	apisix      *apisix.Client
	fluvio      *fluvio.Client
	activities  *temporal.ActivityWorker
	logger      *zap.SugaredLogger
}

func main() {
	// Initialize structured logger
	zapLogger, _ := zap.NewProduction()
	defer zapLogger.Sync()
	logger := zapLogger.Sugar()

	logger.Info("Starting NEXCOM Middleware Hub")

	// Initialize all middleware clients
	hub := &Hub{
		kafka:       kafka.NewProducer(logger),
		dapr:        dapr.NewClient(logger),
		redis:       redis.NewClient(logger),
		tigerbeetle: tigerbeetle.NewClient(logger),
		lakehouse:   lakehouse.NewWriter(logger),
		apisix:      apisix.NewClient(logger),
		fluvio:      fluvio.NewClient(fluvio.DefaultConfig()),
		activities:  temporal.NewActivityWorker(logger),
		logger:      logger,
	}
	defer hub.kafka.Close()
	defer hub.redis.Close()

	// Bootstrap APISIX routes on startup (non-blocking)
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		if err := hub.apisix.BootstrapNEXCOMRoutes(ctx); err != nil {
			logger.Warnw("APISIX bootstrap failed (will retry on next restart)", "error", err)
		}
	}()

	// Set up Gin HTTP server
	if os.Getenv("GIN_MODE") == "" {
		gin.SetMode(gin.ReleaseMode)
	}
	router := gin.New()
	router.Use(gin.Recovery())

	// Health check endpoint
	router.GET("/health", func(c *gin.Context) {
		ctx := c.Request.Context()
		fluvioOK := hub.fluvio.HealthCheck(ctx) == nil
		status := map[string]interface{}{
			"service":   "nexcom-middleware-hub",
			"version":   "1.1.0",
			"timestamp": time.Now().UTC().Format(time.RFC3339),
			"components": map[string]bool{
				"kafka":       hub.kafka.HealthCheck(ctx),
				"dapr":        hub.dapr.HealthCheck(ctx),
				"redis":       hub.redis.HealthCheck(ctx),
				"tigerbeetle": hub.tigerbeetle.HealthCheck(ctx),
				"lakehouse":   hub.lakehouse.HealthCheck(ctx),
				"apisix":      hub.apisix.HealthCheck(ctx),
				"fluvio":      fluvioOK,
			},
		}
		c.JSON(http.StatusOK, status)
	})

	// Event ingestion endpoints
	api := router.Group("/api/v1")
	{
		// Trade event ingestion
		api.POST("/events/trade", func(c *gin.Context) {
			var event kafka.TradeEvent
			if err := c.ShouldBindJSON(&event); err != nil {
				c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
				return
			}
			ctx := c.Request.Context()

			// Publish to Kafka
			if err := hub.kafka.PublishTradeEvent(ctx, event); err != nil {
				logger.Warnw("Kafka publish failed", "error", err)
			}

			// Publish to Dapr pub/sub
			if err := hub.dapr.PublishEvent(ctx, dapr.TopicTrades, event); err != nil {
				logger.Warnw("Dapr publish failed", "error", err)
			}

			// Publish real-time tick to Fluvio for low-latency consumers
			if err := hub.fluvio.PublishMarketTick(ctx, fluvio.MarketTickEvent{
				Symbol:    event.Symbol,
				Price:     event.Price,
				Volume:    event.Quantity,
				Timestamp: event.Timestamp,
				Source:    "trade",
			}); err != nil {
				logger.Warnw("Fluvio market tick publish failed", "error", err)
			}

			// Publish trade confirmation to Fluvio
			if err := hub.fluvio.PublishTradeConfirm(ctx, fluvio.TradeConfirmEvent{
				TradeID:   event.TradeID,
				Symbol:    event.Symbol,
				BuyerID:   event.UserID,
				Price:     event.Price,
				Quantity:  event.Quantity,
				Value:     event.Total,
				Timestamp: event.Timestamp,
			}); err != nil {
				logger.Warnw("Fluvio trade confirm publish failed", "error", err)
			}

			// Write to Lakehouse Bronze layer
			eventMap := map[string]interface{}{
				"trade_id":  event.TradeID,
				"symbol":    event.Symbol,
				"side":      event.Side,
				"quantity":  event.Quantity,
				"price":     event.Price,
				"total":     event.Total,
				"user_id":   event.UserID,
				"timestamp": event.Timestamp,
			}
			if err := hub.lakehouse.WriteTradeEvent(ctx, eventMap); err != nil {
				logger.Warnw("Lakehouse write failed", "error", err)
			}

			// Cache latest price in Redis
			if err := hub.redis.SetPrice(ctx, redis.PriceTick{
				Symbol:    event.Symbol,
				Price:     event.Price,
				Timestamp: event.Timestamp,
			}); err != nil {
				logger.Warnw("Redis price cache failed", "error", err)
			}

			c.JSON(http.StatusOK, gin.H{"status": "published", "trade_id": event.TradeID})
		})

		// Settlement event ingestion
		api.POST("/events/settlement", func(c *gin.Context) {
			var payload map[string]interface{}
			if err := c.ShouldBindJSON(&payload); err != nil {
				c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
				return
			}
			ctx := c.Request.Context()

			// Write to Lakehouse
			if err := hub.lakehouse.WriteSettlementEvent(ctx, payload); err != nil {
				logger.Warnw("Lakehouse settlement write failed", "error", err)
			}

			// Publish to Dapr
			if err := hub.dapr.PublishEvent(ctx, dapr.TopicSettlements, payload); err != nil {
				logger.Warnw("Dapr settlement publish failed", "error", err)
			}

			c.JSON(http.StatusOK, gin.H{"status": "recorded"})
		})

		// KYC update event
		api.POST("/events/kyc", func(c *gin.Context) {
			var event kafka.KYCUpdateEvent
			if err := c.ShouldBindJSON(&event); err != nil {
				c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
				return
			}
			ctx := c.Request.Context()

			// Publish to Kafka
			if err := hub.kafka.PublishKYCUpdate(ctx, event); err != nil {
				logger.Warnw("Kafka KYC publish failed", "error", err)
			}

			// Publish KYC event to Fluvio
			if err := hub.fluvio.ProduceJSON(ctx, fluvio.TopicKYCEvents, fmt.Sprintf("%d", event.UserID), event); err != nil {
				logger.Warnw("Fluvio KYC event publish failed", "error", err)
			}

			// Cache KYC status in Redis
			if err := hub.redis.SetKYCStatus(ctx, event.UserID, event.Status, event.RiskLevel); err != nil {
				logger.Warnw("Redis KYC cache failed", "error", err)
			}

			c.JSON(http.StatusOK, gin.H{"status": "published"})
		})

		// AML flag event
		api.POST("/events/aml", func(c *gin.Context) {
			var event kafka.AMLFlagEvent
			if err := c.ShouldBindJSON(&event); err != nil {
				c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
				return
			}
			ctx := c.Request.Context()

			// Publish to Kafka
			if err := hub.kafka.PublishAMLFlag(ctx, event); err != nil {
				logger.Warnw("Kafka AML publish failed", "error", err)
			}

			// Publish AML event to Fluvio
			if err := hub.fluvio.ProduceJSON(ctx, fluvio.TopicAMLEvents, event.FlagID, event); err != nil {
				logger.Warnw("Fluvio AML event publish failed", "error", err)
			}

			// Write to Lakehouse
			flagMap := map[string]interface{}{
				"flag_id":     event.FlagID,
				"user_id":     event.UserID,
				"rule_id":     event.RuleID,
				"severity":    event.Severity,
				"amount":      event.Amount,
				"detected_at": event.DetectedAt,
			}
			if err := hub.lakehouse.WriteAMLFlag(ctx, flagMap); err != nil {
				logger.Warnw("Lakehouse AML write failed", "error", err)
			}

			c.JSON(http.StatusOK, gin.H{"status": "published"})
		})

		// Notification event
		api.POST("/events/notification", func(c *gin.Context) {
			var event kafka.NotificationEvent
			if err := c.ShouldBindJSON(&event); err != nil {
				c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
				return
			}
			ctx := c.Request.Context()

			if err := hub.kafka.PublishNotification(ctx, event); err != nil {
				logger.Warnw("Kafka notification publish failed", "error", err)
			}

			c.JSON(http.StatusOK, gin.H{"status": "published"})
		})

		// Audit log event
		api.POST("/events/audit", func(c *gin.Context) {
			var event kafka.AuditLogEvent
			if err := c.ShouldBindJSON(&event); err != nil {
				c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
				return
			}
			ctx := c.Request.Context()

			if err := hub.kafka.PublishAuditLog(ctx, event); err != nil {
				logger.Warnw("Kafka audit log publish failed", "error", err)
			}

			c.JSON(http.StatusOK, gin.H{"status": "published"})
		})

		// ─── Fluvio streaming endpoints ──────────────────────────────────────

		// Publish a market tick directly to Fluvio
		api.POST("/stream/tick", func(c *gin.Context) {
			var tick fluvio.MarketTickEvent
			if err := c.ShouldBindJSON(&tick); err != nil {
				c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
				return
			}
			tick.Timestamp = time.Now().UTC()
			ctx := c.Request.Context()
			if err := hub.fluvio.PublishMarketTick(ctx, tick); err != nil {
				logger.Warnw("Fluvio tick publish failed", "error", err)
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
			// Also update Redis price cache
			_ = hub.redis.SetPrice(ctx, redis.PriceTick{
				Symbol:    tick.Symbol,
				Price:     tick.Price,
				Timestamp: tick.Timestamp,
			})
			c.JSON(http.StatusOK, gin.H{"status": "streamed", "symbol": tick.Symbol})
		})

		// Consume records from a Fluvio topic (for debugging / admin)
		api.GET("/stream/consume", func(c *gin.Context) {
			topic := c.DefaultQuery("topic", fluvio.TopicMarketTicks)
			var offset int64
			fmt.Sscanf(c.DefaultQuery("offset", "0"), "%d", &offset)
			ctx := c.Request.Context()
			resp, err := hub.fluvio.Consume(ctx, fluvio.ConsumeRequest{
				Topic:    topic,
				Offset:   offset,
				MaxBytes: 65536,
			})
			if err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
			c.JSON(http.StatusOK, resp)
		})

		// ─── Redis cache endpoints ────────────────────────────────────────────

		api.GET("/cache/orderbook/:symbol", func(c *gin.Context) {
			symbol := c.Param("symbol")
			ctx := c.Request.Context()
			snapshot, err := hub.redis.GetOrderBook(ctx, symbol)
			if err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
			if snapshot == nil {
				c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
				return
			}
			c.JSON(http.StatusOK, snapshot)
		})

		api.GET("/cache/price/:symbol", func(c *gin.Context) {
			symbol := c.Param("symbol")
			ctx := c.Request.Context()
			tick, err := hub.redis.GetPrice(ctx, symbol)
			if err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
			if tick == nil {
				c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
				return
			}
			c.JSON(http.StatusOK, tick)
		})

		// Lakehouse query endpoint
		api.POST("/lakehouse/query", func(c *gin.Context) {
			var req lakehouse.QueryRequest
			if err := c.ShouldBindJSON(&req); err != nil {
				c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
				return
			}
			ctx := c.Request.Context()
			result, err := hub.lakehouse.Query(ctx, req)
			if err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
			c.JSON(http.StatusOK, result)
		})

		// TigerBeetle account balance
		api.GET("/ledger/balance/:account_id", func(c *gin.Context) {
			var accountID uint64
			if _, err := fmt.Sscanf(c.Param("account_id"), "%d", &accountID); err != nil {
				c.JSON(http.StatusBadRequest, gin.H{"error": "invalid account_id"})
				return
			}
			ctx := c.Request.Context()
			balance, err := hub.tigerbeetle.GetAccountBalance(ctx, accountID)
			if err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
			c.JSON(http.StatusOK, gin.H{
				"account_id": accountID,
				"balance":    balance,
				"currency":   "USD",
			})
		})

		// TigerBeetle transfer
		api.POST("/ledger/transfer", func(c *gin.Context) {
			var req struct {
				TransferID    uint64  `json:"transfer_id"`
				DebitAccount  uint64  `json:"debit_account"`
				CreditAccount uint64  `json:"credit_account"`
				Amount        uint64  `json:"amount"`
				Ledger        uint32  `json:"ledger"`
				Code          uint16  `json:"code"`
			}
			if err := c.ShouldBindJSON(&req); err != nil {
				c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
				return
			}
			ctx := c.Request.Context()
			if err := hub.tigerbeetle.CreateTransfer(ctx, req.TransferID, req.DebitAccount, req.CreditAccount, req.Amount, req.Ledger, req.Code); err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
			c.JSON(http.StatusOK, gin.H{"status": "transferred", "transfer_id": req.TransferID})
		})

		// Dapr state store
		api.GET("/state/:key", func(c *gin.Context) {
			key := c.Param("key")
			ctx := c.Request.Context()
			var value interface{}
			if err := hub.dapr.GetState(ctx, key, &value); err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
			c.JSON(http.StatusOK, gin.H{"key": key, "value": value})
		})

		api.POST("/state/:key", func(c *gin.Context) {
			key := c.Param("key")
			var value interface{}
			if err := c.ShouldBindJSON(&value); err != nil {
				c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
				return
			}
			ctx := c.Request.Context()
			if err := hub.dapr.SaveState(ctx, key, value); err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
			c.JSON(http.StatusOK, gin.H{"status": "saved"})
		})

		// Temporal workflow trigger
		api.POST("/workflow/trigger", func(c *gin.Context) {
			var req struct {
				WorkflowType string          `json:"workflow_type"`
				Input        json.RawMessage `json:"input"`
			}
			if err := c.ShouldBindJSON(&req); err != nil {
				c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
				return
			}
			ctx := c.Request.Context()
			workflowID, err := hub.activities.TriggerWorkflow(ctx, req.WorkflowType, req.Input)
			if err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
			c.JSON(http.StatusOK, gin.H{"status": "triggered", "workflow_id": workflowID})
		})
	}

	// Start HTTP server
	port := os.Getenv("MIDDLEWARE_HUB_PORT")
	if port == "" {
		port = "8020"
	}

	server := &http.Server{
		Addr:    fmt.Sprintf(":%s", port),
		Handler: router,
	}

	// Graceful shutdown
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)

	go func() {
		logger.Infow("Middleware Hub listening", "port", port)
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			logger.Fatalw("Server error", "error", err)
		}
	}()

	<-quit
	logger.Info("Shutting down Middleware Hub...")

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := server.Shutdown(ctx); err != nil {
		logger.Errorw("Server shutdown error", "error", err)
	}

	logger.Info("Middleware Hub stopped")
}
