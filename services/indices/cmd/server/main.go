// Command server starts the NEXCOM Commodity Indices gRPC service.
// It exposes real-time commodity price indices via gRPC on port 50053.
package main

import (
	"fmt"
	"net"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	grpcserver "github.com/nexcom/indices/internal/grpc"
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
	// Configure structured logging
	zerolog.TimeFieldFormat = zerolog.TimeFormatUnix
	if os.Getenv("LOG_FORMAT") != "json" {
		log.Logger = log.Output(zerolog.ConsoleWriter{Out: os.Stderr, TimeFormat: time.RFC3339})
	}

	logLevel := os.Getenv("LOG_LEVEL")
	if logLevel == "" {
		logLevel = "info"
	}
	level, err := zerolog.ParseLevel(logLevel)
	if err != nil {
		level = zerolog.InfoLevel
	}
	zerolog.SetGlobalLevel(level)

	log.Info().
		Str("service", "nexcom-indices").
		Str("version", "1.0.0").
		Msg("Starting NEXCOM Commodity Indices Service")

	// Determine ports from environment
	grpcPort := getEnv("GRPC_PORT", defaultGRPCPort)
	metricsPort := getEnv("METRICS_PORT", defaultMetricsPort)

	// Create gRPC server
	grpcAddr := fmt.Sprintf(":%s", grpcPort)
	lis, err := net.Listen("tcp", grpcAddr)
	if err != nil {
		log.Fatal().Err(err).Str("addr", grpcAddr).Msg("Failed to listen")
	}

	// Configure gRPC server options
	opts := []grpc.ServerOption{
		grpc.MaxRecvMsgSize(10 * 1024 * 1024), // 10MB
		grpc.MaxSendMsgSize(10 * 1024 * 1024), // 10MB
	}

	grpcSrv := grpc.NewServer(opts...)

	// Register services
	indicesServer := grpcserver.NewIndicesServer()
	pb.RegisterCommodityIndicesServiceServer(grpcSrv, indicesServer)

	// Register health check
	healthServer := health.NewServer()
	healthpb.RegisterHealthServer(grpcSrv, healthServer)
	healthServer.SetServingStatus(serviceName, healthpb.HealthCheckResponse_SERVING)

	// Enable reflection for debugging with grpcurl
	reflection.Register(grpcSrv)

	// Start metrics server
	go func() {
		metricsAddr := fmt.Sprintf(":%s", metricsPort)
		mux := http.NewServeMux()
		mux.Handle("/metrics", promhttp.Handler())
		mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusOK)
			w.Write([]byte(`{"status":"ok","service":"nexcom-indices"}`))
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

	// Start gRPC server in background
	go func() {
		log.Info().
			Str("addr", grpcAddr).
			Str("service", serviceName).
			Msg("gRPC server listening")

		if err := grpcSrv.Serve(lis); err != nil {
			log.Fatal().Err(err).Msg("gRPC server failed")
		}
	}()

	// Graceful shutdown on signal
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	sig := <-quit

	log.Info().Str("signal", sig.String()).Msg("Shutting down gracefully...")

	// Mark as not serving
	healthServer.SetServingStatus(serviceName, healthpb.HealthCheckResponse_NOT_SERVING)

	// Graceful stop (waits for in-flight RPCs to complete)
	grpcSrv.GracefulStop()

	log.Info().Msg("NEXCOM Indices Service stopped")
}

func getEnv(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}
