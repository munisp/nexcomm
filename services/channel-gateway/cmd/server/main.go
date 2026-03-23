/*
 * NEXCOM Exchange — Channel Gateway (Go)
 * =======================================
 * Handles inbound webhooks from WhatsApp Business API (Meta Cloud API)
 * and Telegram Bot API, then routes commands to the Python bot-logic service
 * via Redis pub/sub and emits events to Kafka.
 *
 * Ports:
 *   :8030 — HTTP server (WhatsApp webhook, Telegram webhook, health)
 *   :8031 — Prometheus metrics
 *
 * Routes:
 *   POST /webhook/whatsapp          — Meta Cloud API inbound messages
 *   GET  /webhook/whatsapp          — Meta webhook verification challenge
 *   POST /webhook/telegram          — Telegram Bot webhook
 *   POST /send/whatsapp             — Internal: send WhatsApp message
 *   POST /send/telegram             — Internal: send Telegram message
 *   GET  /health                    — Health check
 *   GET  /metrics                   — Prometheus metrics
 */

package main

import (
	"context"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/joho/godotenv"
	"go.uber.org/zap"

	"github.com/nexcom/channel-gateway/internal/db"
	"github.com/nexcom/channel-gateway/internal/kafka"
	"github.com/nexcom/channel-gateway/internal/middleware"
	"github.com/nexcom/channel-gateway/internal/telegram"
	"github.com/nexcom/channel-gateway/internal/whatsapp"
)

func main() {
	// Load .env if present
	_ = godotenv.Load()

	// Logger
	logger, _ := zap.NewProduction()
	defer logger.Sync()
	sugar := logger.Sugar()

	// Database
	dbURL := getEnv("DATABASE_URL", "postgresql://nexcom:nexcom_secure_2026@localhost:5432/nexcom")
	pool, err := db.Connect(dbURL)
	if err != nil {
		sugar.Fatalf("DB connect failed: %v", err)
	}
	defer pool.Close()

	// Kafka producer
	kafkaBrokers := getEnv("KAFKA_BROKERS", "localhost:9092")
	kp := kafka.NewProducer(kafkaBrokers, sugar)

	// WhatsApp handler
	waHandler := whatsapp.NewHandler(pool, kp, sugar, whatsapp.Config{
		VerifyToken:    getEnv("WHATSAPP_VERIFY_TOKEN", "nexcom-wa-verify"),
		AccessToken:    getEnv("WHATSAPP_ACCESS_TOKEN", ""),
		PhoneNumberID:  getEnv("WHATSAPP_PHONE_NUMBER_ID", ""),
		BusinessAcctID: getEnv("WHATSAPP_BUSINESS_ACCOUNT_ID", ""),
		BotLogicURL:    getEnv("BOT_LOGIC_URL", "http://localhost:8040"),
	})

	// Telegram handler
	tgHandler := telegram.NewHandler(pool, kp, sugar, telegram.Config{
		BotToken:    getEnv("TELEGRAM_BOT_TOKEN", ""),
		WebhookPath: getEnv("TELEGRAM_WEBHOOK_PATH", "/webhook/telegram"),
		BotLogicURL: getEnv("BOT_LOGIC_URL", "http://localhost:8040"),
	})

	// Gin router
	if os.Getenv("GIN_MODE") == "" {
		gin.SetMode(gin.ReleaseMode)
	}
	r := gin.New()
	r.Use(gin.Recovery())
	r.Use(middleware.Logger(sugar))
	r.Use(middleware.Metrics())

	// WhatsApp routes
	r.GET("/webhook/whatsapp", waHandler.VerifyWebhook)
	r.POST("/webhook/whatsapp", waHandler.HandleInbound)

	// Telegram route
	r.POST("/webhook/telegram", tgHandler.HandleUpdate)

	// Internal send endpoints (called by tRPC notification service)
	r.POST("/send/whatsapp", middleware.InternalAuth(), waHandler.SendMessage)
	r.POST("/send/telegram", middleware.InternalAuth(), tgHandler.SendMessage)
	// Aliases used by notification microservice
	r.POST("/internal/whatsapp/send", middleware.InternalAuth(), waHandler.SendMessage)
	r.POST("/internal/telegram/send", middleware.InternalAuth(), tgHandler.SendMessage)

	// Health + metrics
	r.GET("/health", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"status": "healthy", "service": "nexcom-channel-gateway"})
	})
	r.GET("/metrics", middleware.PrometheusHandler())

	port := getEnv("CHANNEL_GATEWAY_PORT", "8030")
	srv := &http.Server{
		Addr:         ":" + port,
		Handler:      r,
		ReadTimeout:  10 * time.Second,
		WriteTimeout: 15 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	// Start server
	go func() {
		sugar.Infof("NEXCOM Channel Gateway listening on :%s", port)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			sugar.Fatalf("Server error: %v", err)
		}
	}()

	// Graceful shutdown
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit
	sugar.Info("Shutting down channel gateway...")

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if err := srv.Shutdown(ctx); err != nil {
		sugar.Errorf("Shutdown error: %v", err)
	}
	sugar.Info("Channel gateway stopped")
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
