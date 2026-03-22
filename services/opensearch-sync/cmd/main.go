// cmd/main.go — OpenSearch Sync Service entrypoint.
// Connects to PostgreSQL and OpenSearch, then runs the continuous CDC sync loop.
package main

import (
	"context"
	"os"
	"os/signal"
	"strconv"
	"syscall"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/nexcom/opensearch-sync/internal/sync"
	opensearch "github.com/opensearch-project/opensearch-go/v4"
	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"
)

func main() {
	// ── Logging ────────────────────────────────────────────────────────────────
	zerolog.TimeFieldFormat = zerolog.TimeFormatUnix
	if os.Getenv("LOG_LEVEL") == "debug" {
		zerolog.SetGlobalLevel(zerolog.DebugLevel)
	} else {
		zerolog.SetGlobalLevel(zerolog.InfoLevel)
	}
	log.Logger = log.Output(zerolog.ConsoleWriter{Out: os.Stdout, TimeFormat: time.RFC3339})

	// ── Config ─────────────────────────────────────────────────────────────────
	pgURL := getEnv("POSTGRES_URL", "postgres://nexcom:nexcom_dev@localhost:5432/nexcom")
	osURL := getEnv("OPENSEARCH_URL", "http://localhost:9200")
	intervalSec := getEnvInt("SYNC_INTERVAL_SECONDS", 30)

	// ── PostgreSQL pool ────────────────────────────────────────────────────────
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	pgPool, err := pgxpool.New(ctx, pgURL)
	if err != nil {
		log.Fatal().Err(err).Msg("failed to connect to PostgreSQL")
	}
	defer pgPool.Close()

	if err := pgPool.Ping(ctx); err != nil {
		log.Fatal().Err(err).Msg("PostgreSQL ping failed")
	}
	log.Info().Str("url", maskPassword(pgURL)).Msg("[OpenSearchSync] PostgreSQL connected")

	// ── OpenSearch client ──────────────────────────────────────────────────────
	osClient, err := opensearch.NewClient(opensearch.Config{
		Addresses: []string{osURL},
	})
	if err != nil {
		log.Fatal().Err(err).Msg("failed to create OpenSearch client")
	}
	log.Info().Str("url", osURL).Msg("[OpenSearchSync] OpenSearch client ready")

	// ── Syncer ─────────────────────────────────────────────────────────────────
	syncer, err := sync.New(pgPool, osClient)
	if err != nil {
		log.Fatal().Err(err).Msg("failed to initialise syncer")
	}

	// ── Graceful shutdown ──────────────────────────────────────────────────────
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
	go func() {
		<-sigCh
		log.Info().Msg("[OpenSearchSync] Shutdown signal received")
		cancel()
	}()

	syncer.Run(ctx, intervalSec)
	log.Info().Msg("[OpenSearchSync] Exited cleanly")
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func getEnvInt(key string, fallback int) int {
	if v := os.Getenv(key); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			return n
		}
	}
	return fallback
}

// maskPassword replaces the password segment of a postgres DSN for safe logging.
func maskPassword(dsn string) string {
	// Naive mask: replace everything between :// and @ with ***
	if i := indexOf(dsn, "://"); i >= 0 {
		rest := dsn[i+3:]
		if j := indexOf(rest, "@"); j >= 0 {
			return dsn[:i+3] + "***@" + rest[j+1:]
		}
	}
	return dsn
}

func indexOf(s, sub string) int {
	for i := 0; i+len(sub) <= len(s); i++ {
		if s[i:i+len(sub)] == sub {
			return i
		}
	}
	return -1
}
