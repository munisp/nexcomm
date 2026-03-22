// Command server starts the NEXCOM Commodity Indices gRPC service.
// It exposes real-time commodity price indices via gRPC on port 50053,
// backed by TimescaleDB for historical data and Redis for live price cache.
package main

import (
	"context"
	"fmt"
	"net"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/nexcom/indices/internal/db"
	grpcserver "github.com/nexcom/indices/internal/grpc"
	"github.com/nexcom/indices/internal/models"
	pb "github.com/nexcom/indices/proto"
	"github.com/prometheus/client_golang/prometheus/promhttp"
	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"
	"google.golang.org/grpc"
	"google.golang.org/grpc/health"
	healthpb "google.golang.org/grpc/health/grpc_health_v1"
	"google.golang.org/grpc/reflection"
)

const (
	defaultGRPCPort    = "50053"
	defaultMetricsPort = "9093"
	serviceName        = "nexcom.indices.v1.CommodityIndicesService"
)

func main() {
	// ─── Logging ────────────────────────────────────────────────
	zerolog.TimeFieldFormat = zerolog.TimeFormatUnix
	if getEnv("LOG_FORMAT", "console") != "json" {
		log.Logger = log.Output(zerolog.ConsoleWriter{Out: os.Stderr, TimeFormat: time.RFC3339})
	}
	level, _ := zerolog.ParseLevel(getEnv("LOG_LEVEL", "info"))
	zerolog.SetGlobalLevel(level)

	log.Info().
		Str("service", "nexcom-indices").
		Str("version", "1.0.0").
		Msg("Starting NEXCOM Commodity Indices Service")

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// ─── TimescaleDB ─────────────────────────────────────────────
	var tsdb *db.TimescaleDB
	dbURL := getEnv("DATABASE_URL", "")
	if dbURL != "" {
		var err error
		tsdb, err = db.NewTimescaleDB(ctx, dbURL)
		if err != nil {
			log.Warn().Err(err).Msg("TimescaleDB unavailable — running with in-memory demo data")
		} else {
			defer tsdb.Close()
			log.Info().Msg("TimescaleDB connected")
		}
	} else {
		log.Warn().Msg("DATABASE_URL not set — running with in-memory demo data")
	}

	// ─── Price Feed (TimescaleDB ingestion loop) ──────────────────
	if tsdb != nil {
		feedCfg := db.PriceFeedConfig{
			PollInterval:      parseDuration(getEnv("FEED_POLL_INTERVAL", "5s")),
			IndexCalcInterval: parseDuration(getEnv("INDEX_CALC_INTERVAL", "30s")),
			RedisAddr:         getEnv("REDIS_ADDR", "localhost:6379"),
			RedisPassword:     getEnv("REDIS_PASSWORD", ""),
		}

		feed := db.NewPriceFeed(tsdb, feedCfg, models.PredefinedIndices)
		go feed.Start(ctx)
		log.Info().Msg("Price feed ingestion started")
	}

	// ─── gRPC Server ─────────────────────────────────────────────
	grpcPort := getEnv("GRPC_PORT", defaultGRPCPort)
	grpcAddr := fmt.Sprintf(":%s", grpcPort)

	lis, err := net.Listen("tcp", grpcAddr)
	if err != nil {
		log.Fatal().Err(err).Str("addr", grpcAddr).Msg("Failed to listen")
	}

	opts := []grpc.ServerOption{
		grpc.MaxRecvMsgSize(10 * 1024 * 1024),
		grpc.MaxSendMsgSize(10 * 1024 * 1024),
	}

	grpcSrv := grpc.NewServer(opts...)

	// Create the indices server — pass TimescaleDB if available
	indicesServer := grpcserver.NewIndicesServerWithDB(tsdb)
	pb.RegisterCommodityIndicesServiceServer(grpcSrv, indicesServer)

	// Health check
	healthServer := health.NewServer()
	healthpb.RegisterHealthServer(grpcSrv, healthServer)
	healthServer.SetServingStatus(serviceName, healthpb.HealthCheckResponse_SERVING)

	// gRPC reflection for grpcurl debugging
	reflection.Register(grpcSrv)

	// ─── Metrics / Health HTTP Server ────────────────────────────
	metricsPort := getEnv("METRICS_PORT", defaultMetricsPort)
	go func() {
		metricsAddr := fmt.Sprintf(":%s", metricsPort)
		mux := http.NewServeMux()
		mux.Handle("/metrics", promhttp.Handler())
		mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusOK)
			fmt.Fprintf(w, `{"status":"ok","service":"nexcom-indices","timescaledb":%v}`, tsdb != nil)
		})
		mux.HandleFunc("/ready", func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusOK)
			w.Write([]byte(`{"status":"ready"}`))
		})
		log.Info().Str("addr", metricsAddr).Msg("Metrics server starting")
		if err := http.ListenAndServe(metricsAddr, mux); err != nil {
			log.Error().Err(err).Msg("Metrics server error")
		}
	}()

	// ─── Start gRPC ──────────────────────────────────────────────
	go func() {
		log.Info().Str("addr", grpcAddr).Msg("gRPC server listening")
		if err := grpcSrv.Serve(lis); err != nil {
			log.Fatal().Err(err).Msg("gRPC server failed")
		}
	}()

	// ─── Graceful Shutdown ───────────────────────────────────────
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	sig := <-quit

	log.Info().Str("signal", sig.String()).Msg("Shutting down gracefully...")
	cancel() // stop price feed
	healthServer.SetServingStatus(serviceName, healthpb.HealthCheckResponse_NOT_SERVING)
	grpcSrv.GracefulStop()
	log.Info().Msg("NEXCOM Indices Service stopped")
}

func getEnv(key, defaultValue string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return defaultValue
}

func parseDuration(s string) time.Duration {
	d, err := time.ParseDuration(s)
	if err != nil {
		return 5 * time.Second
	}
	return d
}
