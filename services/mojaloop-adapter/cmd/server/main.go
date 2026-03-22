// Command server is the NEXCOM Mojaloop DFSP adapter — a high-performance
// Go service that implements the FSPIOP API v1.1 for the NEXCOM Exchange.
package main

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/prometheus/client_golang/prometheus/promhttp"
	"github.com/nexcom/mojaloop-adapter/internal/config"
	"github.com/nexcom/mojaloop-adapter/internal/db"
	"github.com/nexcom/mojaloop-adapter/internal/handlers"
	"github.com/nexcom/mojaloop-adapter/internal/kafka"
)

func main() {
	// ── Logger ────────────────────────────────────────────────────────────────
	logLevel := slog.LevelInfo
	if os.Getenv("LOG_LEVEL") == "debug" {
		logLevel = slog.LevelDebug
	}
	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: logLevel}))
	slog.SetDefault(logger)

	// ── Config ────────────────────────────────────────────────────────────────
	cfg, err := config.Load()
	if err != nil {
		logger.Error("failed to load config", "err", err)
		os.Exit(1)
	}
	logger.Info("NEXCOM Mojaloop DFSP Adapter starting",
		"dfspId", cfg.DfspID,
		"port", cfg.Port,
		"hubURL", cfg.MojaloopHubURL,
		"kafkaBrokers", cfg.KafkaBrokers,
	)

	// ── Database ──────────────────────────────────────────────────────────────
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	store, err := db.New(ctx, cfg.DatabaseURL, cfg.MaxDBConns)
	cancel()
	if err != nil {
		logger.Error("failed to connect to database", "err", err)
		os.Exit(1)
	}
	defer store.Close()
	logger.Info("PostgreSQL connection pool established", "maxConns", cfg.MaxDBConns)

	// ── Kafka Producer ────────────────────────────────────────────────────────
	producer := kafka.NewProducer(cfg.KafkaBrokers, logger)
	logger.Info("Kafka producer initialised", "brokers", cfg.KafkaBrokers)

	// ── Handlers ──────────────────────────────────────────────────────────────
	h := handlers.New(
		store,
		cfg.DfspID,
		cfg.CallbackURL,
		cfg.MojaloopHubURL,
		cfg.MojaloopALSURL,
		cfg.PortalURL,
		producer,
		logger,
	)

	// ── Router ────────────────────────────────────────────────────────────────
	mux := http.NewServeMux()

	// Observability
	mux.HandleFunc("GET /health", h.Health)
	mux.HandleFunc("GET /ready", h.Health)
	mux.HandleFunc("GET /stats", h.Stats)
	mux.Handle("GET /metrics", promhttp.Handler())

	// FSPIOP Participants (DFSP registry)
	mux.HandleFunc("POST /participants", h.PostParticipants)
	mux.HandleFunc("GET /participants", h.GetParticipants)
	mux.HandleFunc("POST /participants/{fspId}/endpoints", h.PostParticipantEndpoints)

	// FSPIOP Parties (Account Lookup)
	mux.HandleFunc("GET /parties/{partyIdType}/{partyIdentifier}", h.GetParty)

	// FSPIOP Quotes
	mux.HandleFunc("POST /quotes", h.PostQuotes)
	mux.HandleFunc("GET /quotes", h.GetQuotes)

	// FSPIOP Transfers
	mux.HandleFunc("POST /transfers", h.PostTransfers)
	mux.HandleFunc("GET /transfers", h.GetTransfers)
	mux.HandleFunc("GET /transfers/{transferId}", h.GetTransferByID)

	// Inbound FSPIOP Callbacks (from Mojaloop hub or other DFSPs)
	mux.HandleFunc("PUT /callbacks/transfers/{transferId}", h.PutTransferCallback)
	mux.HandleFunc("PUT /callbacks/transfers/{transferId}/error", h.PutTransferErrorCallback)
	mux.HandleFunc("PUT /callbacks/quotes/{quoteId}", h.PutQuoteCallback)

	// ── HTTP Server ───────────────────────────────────────────────────────────
	srv := &http.Server{
		Addr:         fmt.Sprintf(":%d", cfg.Port),
		Handler:      loggingMiddleware(corsMiddleware(mux), logger),
		ReadTimeout:  time.Duration(cfg.ReadTimeoutSec) * time.Second,
		WriteTimeout: time.Duration(cfg.WriteTimeoutSec) * time.Second,
		IdleTimeout:  120 * time.Second,
	}

	// ── Graceful shutdown ─────────────────────────────────────────────────────
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)

	go func() {
		logger.Info("HTTP server listening", "addr", srv.Addr)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			logger.Error("server error", "err", err)
			os.Exit(1)
		}
	}()

	<-quit
	logger.Info("shutting down gracefully...")

	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer shutdownCancel()
	if err := srv.Shutdown(shutdownCtx); err != nil {
		logger.Error("shutdown error", "err", err)
	}
	logger.Info("server stopped")
}

// ─── Middleware ───────────────────────────────────────────────────────────────

// loggingMiddleware logs every request with method, path, status, and duration.
func loggingMiddleware(next http.Handler, logger *slog.Logger) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		rw := &responseWriter{ResponseWriter: w, status: http.StatusOK}
		next.ServeHTTP(rw, r)
		logger.Info("request",
			"method", r.Method,
			"path", r.URL.Path,
			"status", rw.status,
			"duration_ms", time.Since(start).Milliseconds(),
			"remote", r.RemoteAddr,
		)
	})
}

// corsMiddleware adds CORS headers for the NEXCOM portal frontend.
func corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, FSPIOP-Source, FSPIOP-Destination, FSPIOP-Signature, Authorization")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// responseWriter wraps http.ResponseWriter to capture the status code.
type responseWriter struct {
	http.ResponseWriter
	status int
}

func (rw *responseWriter) WriteHeader(code int) {
	rw.status = code
	rw.ResponseWriter.WriteHeader(code)
}
