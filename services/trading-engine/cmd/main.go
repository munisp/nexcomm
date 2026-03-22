// DEPRECATED: This Go trading engine has been superseded by the Rust matching engine
// at services/matching-engine/. The Rust implementation provides:
//   - 10x lower latency (~50μs vs ~500μs)
//   - Production-grade features: circuit breakers, auction mechanism, surveillance
//   - Market makers, indices, corporate actions, brokers modules
//   - Fee engine with 10 monetization streams
//   - Futures, options, and fractional trading support
//
// This service is kept for reference only. Do NOT deploy in production.
// See services/matching-engine/ for the production matching engine.
//
// NEXCOM Exchange - Trading Engine Service (LEGACY)
// Ultra-low latency order matching engine with FIFO and Pro-Rata algorithms.
// Handles order placement, matching, and order book management.
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
	"github.com/nexcom-exchange/trading-engine/internal/matching"
	"github.com/nexcom-exchange/trading-engine/internal/orderbook"
	"go.uber.org/zap"
)

func main() {
	logger, _ := zap.NewProduction()
	defer logger.Sync()

	sugar := logger.Sugar()
	sugar.Info("Starting NEXCOM Trading Engine...")

	// Initialize matching engine with all configured symbols
	engine := matching.NewEngine(logger)

	// Initialize order book manager
	bookManager := orderbook.NewManager(engine, logger)

	// Load active symbols and initialize order books
	symbols := []string{
		"MAIZE", "WHEAT", "SOYBEAN", "RICE", "COFFEE", "COCOA",
		"COTTON", "SUGAR", "PALM_OIL", "CASHEW",
		"GOLD", "SILVER", "COPPER",
		"CRUDE_OIL", "BRENT", "NAT_GAS",
		"CARBON",
	}
	for _, symbol := range symbols {
		bookManager.CreateOrderBook(symbol)
	}

	// Setup HTTP server with Gin
	router := setupRouter(engine, bookManager, logger)

	port := os.Getenv("PORT")
	if port == "" {
		port = "8001"
	}

	srv := &http.Server{
		Addr:         fmt.Sprintf(":%s", port),
		Handler:      router,
		ReadTimeout:  5 * time.Second,
		WriteTimeout: 10 * time.Second,
		IdleTimeout:  120 * time.Second,
	}

	// Graceful shutdown
	go func() {
		sugar.Infof("Trading Engine listening on port %s", port)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			sugar.Fatalf("Failed to start server: %v", err)
		}
	}()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit
	sugar.Info("Shutting down Trading Engine...")

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	// Persist order books before shutdown
	bookManager.PersistAll(ctx)

	if err := srv.Shutdown(ctx); err != nil {
		sugar.Fatalf("Server forced to shutdown: %v", err)
	}
	sugar.Info("Trading Engine stopped")
}

func setupRouter(engine *matching.Engine, bookManager *orderbook.Manager, logger *zap.Logger) *gin.Engine {
	gin.SetMode(gin.ReleaseMode)
	router := gin.New()
	router.Use(gin.Recovery())

	// Health checks
	router.GET("/healthz", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"status": "healthy", "service": "trading-engine"})
	})
	router.GET("/readyz", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"status": "ready"})
	})
	// Prometheus metrics endpoint
	router.GET("/metrics", func(c *gin.Context) {
		stats := engine.Stats()
		body := fmt.Sprintf(
			"# HELP nexcom_trading_orders_total Total orders processed\n"+
			"# TYPE nexcom_trading_orders_total counter\n"+
			"nexcom_trading_orders_total{service=\"trading-engine\"} %d\n"+
			"# HELP nexcom_trading_trades_total Total trades executed\n"+
			"# TYPE nexcom_trading_trades_total counter\n"+
			"nexcom_trading_trades_total{service=\"trading-engine\"} %d\n"+
			"# HELP nexcom_trading_active_orders Current active orders in all books\n"+
			"# TYPE nexcom_trading_active_orders gauge\n"+
			"nexcom_trading_active_orders{service=\"trading-engine\"} %d\n",
			stats.TotalOrders, stats.TotalTrades, stats.ActiveOrders,
		)
		c.Data(http.StatusOK, "text/plain; version=0.0.4; charset=utf-8", []byte(body))
	})

	// Order API
	v1 := router.Group("/api/v1")
	{
		// Place a new order
		v1.POST("/orders", func(c *gin.Context) {
			var req OrderRequest
			if err := c.ShouldBindJSON(&req); err != nil {
				c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
				return
			}

			order, err := engine.PlaceOrder(c.Request.Context(), req.ToOrder())
			if err != nil {
				logger.Error("Failed to place order", zap.Error(err))
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}

			c.JSON(http.StatusCreated, order)
		})

		// Cancel an order
		v1.DELETE("/orders/:orderId", func(c *gin.Context) {
			orderID := c.Param("orderId")
			err := engine.CancelOrder(c.Request.Context(), orderID)
			if err != nil {
				c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
				return
			}
			c.JSON(http.StatusOK, gin.H{"status": "cancelled", "order_id": orderID})
		})

		// Get order by ID
		v1.GET("/orders/:orderId", func(c *gin.Context) {
			orderID := c.Param("orderId")
			order, err := engine.GetOrder(c.Request.Context(), orderID)
			if err != nil {
				c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
				return
			}
			c.JSON(http.StatusOK, order)
		})

		// Get order book for a symbol
		v1.GET("/orderbook/:symbol", func(c *gin.Context) {
			symbol := c.Param("symbol")
			depth := 10 // default depth
			book, err := bookManager.GetOrderBook(symbol, depth)
			if err != nil {
				c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
				return
			}
			c.JSON(http.StatusOK, book)
		})

		// Get recent trades for a symbol
		v1.GET("/trades/:symbol", func(c *gin.Context) {
			symbol := c.Param("symbol")
			trades, err := engine.GetRecentTrades(c.Request.Context(), symbol, 100)
			if err != nil {
				c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
				return
			}
			c.JSON(http.StatusOK, trades)
		})
	}

	return router
}

// OrderRequest represents an incoming order placement request
type OrderRequest struct {
	UserID      string `json:"user_id" binding:"required"`
	Symbol      string `json:"symbol" binding:"required"`
	Side        string `json:"side" binding:"required,oneof=BUY SELL"`
	OrderType   string `json:"order_type" binding:"required,oneof=MARKET LIMIT STOP STOP_LIMIT IOC FOK"`
	Quantity    string `json:"quantity" binding:"required"`
	Price       string `json:"price"`
	StopPrice   string `json:"stop_price"`
	TimeInForce string `json:"time_in_force"`
	ClientID    string `json:"client_order_id"`
}

// ToOrder converts the API request into a domain Order
func (r *OrderRequest) ToOrder() *matching.Order {
	return matching.NewOrderFromRequest(
		r.UserID, r.Symbol, r.Side, r.OrderType,
		r.Quantity, r.Price, r.StopPrice,
		r.TimeInForce, r.ClientID,
	)
}
