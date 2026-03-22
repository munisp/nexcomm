package config

import "os"

type Config struct {
	Port                 string
	Environment          string
	KafkaBrokers         string
	RedisURL             string
	TemporalHost         string
	TigerBeetleAddresses string
	DaprHTTPPort         string
	DaprGRPCPort         string
	FluvioEndpoint       string
	KeycloakURL          string
	KeycloakRealm        string
	KeycloakClientID     string
	PermifyEndpoint      string
	PostgresURL          string
	APISIXAdminURL       string
	APISIXAdminKey       string
	CORSOrigins          string
	MatchingEngineURL    string
	IngestionEngineURL   string
	BlockchainServiceURL string
	KYCServiceURL        string
	AnalyticsServiceURL  string
	AnalyticsEngineURL   string
	UserManagementURL    string
	AiMlServiceURL       string
	MojaloopAdapterURL   string
}

func Load() *Config {
	return &Config{
		Port:                 getEnv("PORT", "8000"),
		Environment:          getEnv("ENVIRONMENT", "development"),
		KafkaBrokers:         getEnv("KAFKA_BROKERS", "localhost:9092"),
		RedisURL:             getEnv("REDIS_URL", "localhost:6379"),
		TemporalHost:         getEnv("TEMPORAL_HOST", "localhost:7233"),
		TigerBeetleAddresses: getEnv("TIGERBEETLE_ADDRESSES", "localhost:3000"),
		DaprHTTPPort:         getEnv("DAPR_HTTP_PORT", "3500"),
		DaprGRPCPort:         getEnv("DAPR_GRPC_PORT", "50001"),
		FluvioEndpoint:       getEnv("FLUVIO_ENDPOINT", "localhost:9003"),
		KeycloakURL:          getEnv("KEYCLOAK_URL", "http://localhost:8080"),
		KeycloakRealm:        getEnv("KEYCLOAK_REALM", "nexcom"),
		KeycloakClientID:     getEnv("KEYCLOAK_CLIENT_ID", "nexcom-gateway"),
		PermifyEndpoint:      getEnv("PERMIFY_ENDPOINT", "localhost:3476"),
		PostgresURL:          getEnv("POSTGRES_URL", "postgres://nexcom:nexcom@localhost:5432/nexcom?sslmode=disable"),
		APISIXAdminURL:       getEnv("APISIX_ADMIN_URL", "http://localhost:9180"),
		APISIXAdminKey:       getEnv("APISIX_ADMIN_KEY", "nexcom-apisix-key"),
		CORSOrigins:          getEnv("CORS_ORIGINS", "http://localhost:3000,http://localhost:3001"),
		MatchingEngineURL:    getEnv("MATCHING_ENGINE_URL", "http://localhost:8080"),
		IngestionEngineURL:   getEnv("INGESTION_ENGINE_URL", "http://localhost:8005"),
		BlockchainServiceURL: getEnv("BLOCKCHAIN_SERVICE_URL", "http://localhost:8009"),
		KYCServiceURL:        getEnv("KYC_SERVICE_URL", "http://localhost:3002"),
		AnalyticsServiceURL:  getEnv("ANALYTICS_SERVICE_URL", "http://localhost:8004"),
		AnalyticsEngineURL:   getEnv("ANALYTICS_ENGINE_URL", "http://localhost:8011"),
		UserManagementURL:    getEnv("USER_MANAGEMENT_URL", "http://localhost:8012"),
		AiMlServiceURL:       getEnv("AIML_SERVICE_URL", "http://localhost:8007"),
		MojaloopAdapterURL:   getEnv("MOJALOOP_ADAPTER_URL", "http://localhost:4001"),
	}
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
