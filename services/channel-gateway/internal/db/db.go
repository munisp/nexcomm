package db

import (
	"context"
	"os"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Connect opens a tuned PostgreSQL connection pool.
//
// Pool sizing is env-tunable via DB_MAX_CONNS (default 25) so the service can
// be right-sized against Postgres max_connections without a rebuild. Lifetimes
// keep connections fresh behind NAT/LB idle timeouts.
func Connect(url string) (*pgxpool.Pool, error) {
	cfg, err := pgxpool.ParseConfig(url)
	if err != nil {
		return nil, err
	}
	cfg.MaxConns = int32(envInt("DB_MAX_CONNS", 25))
	cfg.MinConns = 2
	cfg.MaxConnLifetime = 5 * time.Minute
	cfg.MaxConnIdleTime = 1 * time.Minute
	cfg.HealthCheckPeriod = 30 * time.Second
	return pgxpool.NewWithConfig(context.Background(), cfg)
}

func envInt(key string, fallback int) int {
	if v := os.Getenv(key); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			return n
		}
	}
	return fallback
}
