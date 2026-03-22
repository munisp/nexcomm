// Package config loads and validates environment configuration for the
// NEXCOM Mojaloop DFSP Adapter.
package config

import (
	"fmt"
	"os"
	"strconv"
)

// Config holds all runtime configuration for the adapter.
type Config struct {
	Port            int
	DfspID          string
	DatabaseURL     string
	MojaloopHubURL  string
	MojaloopALSURL  string
	CallbackURL     string
	LogLevel        string
	MaxDBConns      int32
	ReadTimeoutSec  int
	WriteTimeoutSec int
	KafkaBrokers    string
	PortalURL       string
}

// Load reads configuration from environment variables, applying defaults.
func Load() (*Config, error) {
	port, err := strconv.Atoi(getEnv("PORT", "4001"))
	if err != nil {
		return nil, fmt.Errorf("invalid PORT: %w", err)
	}

	maxConns, err := strconv.Atoi(getEnv("DB_MAX_CONNS", "20"))
	if err != nil {
		return nil, fmt.Errorf("invalid DB_MAX_CONNS: %w", err)
	}

	readTimeout, err := strconv.Atoi(getEnv("HTTP_READ_TIMEOUT", "30"))
	if err != nil {
		return nil, fmt.Errorf("invalid HTTP_READ_TIMEOUT: %w", err)
	}

	writeTimeout, err := strconv.Atoi(getEnv("HTTP_WRITE_TIMEOUT", "30"))
	if err != nil {
		return nil, fmt.Errorf("invalid HTTP_WRITE_TIMEOUT: %w", err)
	}

	dbURL := getEnv("DATABASE_URL", "postgresql://nexcom:nexcom_secure_2026@localhost:5432/nexcom")

	dfspID := getEnv("DFSP_ID", "nexcom-exchange")
	callbackBase := getEnv("CALLBACK_URL", fmt.Sprintf("http://mojaloop-adapter:%d/callbacks", port))

	return &Config{
		Port:            port,
		DfspID:          dfspID,
		DatabaseURL:     dbURL,
		MojaloopHubURL:  getEnv("MOJALOOP_HUB_URL", "http://central-ledger:3001"),
		MojaloopALSURL:  getEnv("MOJALOOP_ALS_URL", "http://account-lookup-service:4002"),
		CallbackURL:     callbackBase,
		LogLevel:        getEnv("LOG_LEVEL", "info"),
		MaxDBConns:      int32(maxConns),
		ReadTimeoutSec:  readTimeout,
		WriteTimeoutSec: writeTimeout,
		KafkaBrokers:    getEnv("KAFKA_BROKERS", "kafka:9092"),
		PortalURL:       getEnv("PORTAL_URL", "http://portal:3000"),
	}, nil
}

func getEnv(key, defaultVal string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return defaultVal
}
