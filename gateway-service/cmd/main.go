package main

import (
	"context"
	"log"
	"net/http"
	_ "net/http/pprof" // pprof admin endpoints; served only when GO_PPROF=1
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/munisp/NGApp/services/gateway/internal/api"
	"github.com/munisp/NGApp/services/gateway/internal/config"
	"github.com/munisp/NGApp/services/gateway/internal/dapr"
	"github.com/munisp/NGApp/services/gateway/internal/fluvio"
	kafkaclient "github.com/munisp/NGApp/services/gateway/internal/kafka"
	"github.com/munisp/NGApp/services/gateway/internal/keycloak"
	"github.com/munisp/NGApp/services/gateway/internal/permify"
	redisclient "github.com/munisp/NGApp/services/gateway/internal/redis"
	"github.com/munisp/NGApp/services/gateway/internal/temporal"
	"github.com/munisp/NGApp/services/gateway/internal/tigerbeetle"
)

func main() {
	cfg := config.Load()

	// Initialize middleware clients
	kafkaClient := kafkaclient.NewClient(cfg.KafkaBrokers)
	redisClient := redisclient.NewClient(cfg.RedisURL)
	tigerBeetleClient := tigerbeetle.NewClient(cfg.TigerBeetleAddresses)
	// Temporal activities get real dependencies (TigerBeetle ledger, kyc-service)
	// so margin/settlement/KYC activities execute real operations or fail closed.
	temporalClient := temporal.NewClient(cfg.TemporalHost,
		temporal.NewActivities(tigerBeetleClient, cfg.KYCServiceURL))
	daprClient := dapr.NewClient(cfg.DaprHTTPPort, cfg.DaprGRPCPort)
	fluvioClient := fluvio.NewClient(cfg.FluvioEndpoint)
	keycloakClient := keycloak.NewClient(cfg.KeycloakURL, cfg.KeycloakRealm, cfg.KeycloakClientID)
	permifyClient := permify.NewAuthenticatedClient(cfg.PermifyEndpoint, cfg.PermifyTenantID, cfg.PermifyAuthToken)

	// Create API server with all dependencies
	server := api.NewServer(
		cfg,
		kafkaClient,
		redisClient,
		temporalClient,
		tigerBeetleClient,
		daprClient,
		fluvioClient,
		keycloakClient,
		permifyClient,
	)

	// Setup routes
	router := server.SetupRoutes()

	// WriteTimeout stays at 30s: /api/v1/stream/* SSE endpoints rely on
	// per-write keepalive events under that ceiling; do not lower it further.
	httpServer := &http.Server{
		Addr:              ":" + cfg.Port,
		Handler:           router,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       15 * time.Second,
		WriteTimeout:      30 * time.Second,
		IdleTimeout:       60 * time.Second,
		MaxHeaderBytes:    1 << 16,
	}

	// Optional pprof admin server (GO_PPROF=1 only; loopback by default).
	if os.Getenv("GO_PPROF") == "1" {
		pprofAddr := os.Getenv("PPROF_ADDR")
		if pprofAddr == "" {
			pprofAddr = "127.0.0.1:6060"
		}
		go func() {
			log.Printf("pprof admin server listening on %s", pprofAddr)
			// handlers registered on http.DefaultServeMux by the net/http/pprof import
			if err := http.ListenAndServe(pprofAddr, nil); err != nil {
				log.Printf("pprof server exited: %v", err)
			}
		}()
	}

	// Graceful shutdown
	go func() {
		log.Printf("NEXCOM Gateway starting on port %s", cfg.Port)
		if err := httpServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("Server failed: %v", err)
		}
	}()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	log.Println("Shutting down server...")
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	if err := httpServer.Shutdown(ctx); err != nil {
		log.Fatalf("Server forced to shutdown: %v", err)
	}

	// Cleanup
	kafkaClient.Close()
	redisClient.Close()
	temporalClient.Close()
	tigerBeetleClient.Close()
	daprClient.Close()
	fluvioClient.Close()

	log.Println("Server exited cleanly")
}
