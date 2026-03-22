// DEPRECATED: This Go risk management service has been superseded by the Rust
// matching engine at services/matching-engine/ which includes built-in:
//   - Real-time position tracking and margin calculations
//   - Circuit breakers (price limits, volume limits, volatility halts)
//   - Surveillance module (spoofing, wash trading, insider detection)
//   - Clearing and settlement integration
//
// This service is kept for reference only. Do NOT deploy in production.
// See services/matching-engine/ for integrated risk management.
//
// NEXCOM Exchange - Risk Management Service (LEGACY)
// Real-time position monitoring, margin calculations, and circuit breakers.
// Consumes trade events from Kafka and maintains risk state in Redis/PostgreSQL.
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
	"github.com/nexcom-exchange/risk-management/internal/calculator"
	"github.com/nexcom-exchange/risk-management/internal/position"
	"go.uber.org/zap"
)

func main() {
	logger, _ := zap.NewProduction()
	defer logger.Sync()
	sugar := logger.Sugar()

	sugar.Info("Starting NEXCOM Risk Management Service...")

	positionMgr := position.NewManager(logger)
	riskCalc := calculator.NewRiskCalculator(positionMgr, logger)

	router := setupRouter(positionMgr, riskCalc, logger)

	port := os.Getenv("PORT")
	if port == "" {
		port = "8004"
	}

	srv := &http.Server{
		Addr:         fmt.Sprintf(":%s", port),
		Handler:      router,
		ReadTimeout:  5 * time.Second,
		WriteTimeout: 10 * time.Second,
	}

	go func() {
		sugar.Infof("Risk Management Service listening on port %s", port)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			sugar.Fatalf("Failed to start server: %v", err)
		}
	}()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	sugar.Info("Shutting down Risk Management Service...")
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	srv.Shutdown(ctx)
}

func setupRouter(pm *position.Manager, rc *calculator.RiskCalculator, logger *zap.Logger) *gin.Engine {
	gin.SetMode(gin.ReleaseMode)
	router := gin.New()
	router.Use(gin.Recovery())

	router.GET("/healthz", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"status": "healthy", "service": "risk-management"})
	})

	v1 := router.Group("/api/v1/risk")
	{
		// Get user positions
		v1.GET("/positions/:userId", func(c *gin.Context) {
			userID := c.Param("userId")
			positions := pm.GetUserPositions(userID)
			c.JSON(http.StatusOK, positions)
		})

		// Get risk summary for a user
		v1.GET("/summary/:userId", func(c *gin.Context) {
			userID := c.Param("userId")
			summary := rc.GetRiskSummary(userID)
			c.JSON(http.StatusOK, summary)
		})

		// Check if an order passes risk checks
		v1.POST("/check", func(c *gin.Context) {
			var req RiskCheckRequest
			if err := c.ShouldBindJSON(&req); err != nil {
				c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
				return
			}
			result := rc.CheckOrder(req.UserID, req.Symbol, req.Side, req.Quantity, req.Price)
			c.JSON(http.StatusOK, result)
		})

		// Get circuit breaker status
		v1.GET("/circuit-breakers", func(c *gin.Context) {
			status := rc.GetCircuitBreakerStatus()
			c.JSON(http.StatusOK, status)
		})

		// Get margin requirements for a symbol
		v1.GET("/margin/:symbol", func(c *gin.Context) {
			symbol := c.Param("symbol")
			margin := rc.GetMarginRequirements(symbol)
			c.JSON(http.StatusOK, margin)
		})
	}

	return router
}

// RiskCheckRequest represents an incoming risk check request
type RiskCheckRequest struct {
	UserID   string `json:"user_id" binding:"required"`
	Symbol   string `json:"symbol" binding:"required"`
	Side     string `json:"side" binding:"required"`
	Quantity string `json:"quantity" binding:"required"`
	Price    string `json:"price" binding:"required"`
}
