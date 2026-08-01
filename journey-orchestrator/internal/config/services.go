// Package config provides service URL configuration for all NEXCOM platform services.
// All URLs are read from environment variables with sensible Docker Compose defaults.
package config

import "os"

// Services holds the base URLs for every NEXCOM platform service.
type Services struct {
	// Core platform
	PortalURL      string // TypeScript tRPC backend (port 3000)
	GatewayURL     string // Go gateway / TigerBeetle proxy (port 8200)
	MatchingEngine string // Rust matching engine (port 8080)
	SettlementURL  string // Rust settlement engine (port 8005)
	TradingEngine  string // Go trading engine (port 8001)

	// Domain services
	KYCURL         string // Go KYC service (port 8003)
	RiskURL        string // Go risk management (port 8004)
	AnalyticsURL   string // Go analytics (port 8006)
	AiMlURL        string // Python AI/ML (port 8007)
	NotificationURL string // Go notification (port 8008)
	IngestionURL   string // Python ingestion engine (port 8009)
	BlockchainURL  string // Rust blockchain (port 8010)
	AnalyticsEngineURL string // Go analytics engine (port 8011)
	UserMgmtURL    string // Go user management (port 8012)
	CreditScoringURL string // Rust credit scoring (port 8089)
	USSDEngineURL  string // Rust USSD engine (port 8020)
	MiddlewareHubURL string // Go middleware hub (port 8013)

	// Infrastructure
	MojaloopURL    string // Mojaloop adapter (port 4001)
	FluvioURL      string // Fluvio HTTP proxy (port 8090)
	TemporalAddr   string // Temporal gRPC address
	TemporalNS     string // Temporal namespace
	KafkaBrokers   string // Kafka bootstrap servers
	RedisURL       string // Redis URL
	DatabaseURL    string // PostgreSQL URL
}

// Load reads all service URLs from environment variables.
func Load() *Services {
	return &Services{
		PortalURL:          getenv("PORTAL_URL", "http://portal:3000"),
		GatewayURL:         getenv("GATEWAY_URL", "http://gateway:8200"),
		MatchingEngine:     getenv("MATCHING_ENGINE_URL", "http://matching-engine:8080"),
		SettlementURL:      getenv("SETTLEMENT_ENGINE_URL", "http://settlement-engine:8005"),
		TradingEngine:      getenv("TRADING_ENGINE_URL", "http://trading-engine:8001"),
		KYCURL:             getenv("KYC_SERVICE_URL", "http://kyc-service:8003"),
		RiskURL:            getenv("RISK_SERVICE_URL", "http://risk-management:8004"),
		AnalyticsURL:       getenv("ANALYTICS_SERVICE_URL", "http://analytics:8006"),
		AiMlURL:            getenv("AI_ML_SERVICE_URL", "http://ai-ml:8007"),
		NotificationURL:    getenv("NOTIFICATION_SERVICE_URL", "http://notification:8008"),
		IngestionURL:       getenv("INGESTION_SERVICE_URL", "http://ingestion-engine:8009"),
		BlockchainURL:      getenv("BLOCKCHAIN_SERVICE_URL", "http://blockchain:8010"),
		AnalyticsEngineURL: getenv("ANALYTICS_ENGINE_URL", "http://analytics-engine:8011"),
		UserMgmtURL:        getenv("USER_MANAGEMENT_URL", "http://user-management:8012"),
		CreditScoringURL:   getenv("CREDIT_SCORING_URL", "http://credit-scoring:8089"),
		USSDEngineURL:      getenv("USSD_ENGINE_URL", "http://ussd-engine:8020"),
		MiddlewareHubURL:   getenv("MIDDLEWARE_HUB_URL", "http://middleware-hub:8013"),
		MojaloopURL:        getenv("MOJALOOP_HUB_URL", "http://mojaloop-adapter:4001"),
		FluvioURL:          getenv("FLUVIO_HTTP_URL", "http://fluvio-proxy:8090"),
		TemporalAddr:       getenv("TEMPORAL_ADDRESS", "temporal:7233"),
		TemporalNS:         getenv("TEMPORAL_NAMESPACE", "nexcom"),
		KafkaBrokers:       getenv("KAFKA_BROKERS", "kafka:9092"),
		RedisURL:           getenv("REDIS_URL", "redis://redis:6379"),
		DatabaseURL:        getenv("DATABASE_URL", "postgres://nexcom:nexcom@postgres:5432/nexcom"),
	}
}

func getenv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
