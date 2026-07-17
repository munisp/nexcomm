/**
 * NEXCOM Exchange — centralised environment configuration
 *
 * All values have sensible defaults for a Docker Compose deployment.
 * Override any value by setting the corresponding environment variable.
 *
 * Required for production (no safe default):
 *   JWT_SECRET, NEXCOM_PG_URL, KEYCLOAK_CLIENT_SECRET,
 *   OPENAI_API_KEY (or LLM_BASE_URL for Ollama),
 *   AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY
 */
export const ENV = {
  // ── Core ──────────────────────────────────────────────────────────────────
  cookieSecret: process.env.JWT_SECRET ?? "nexcom-dev-jwt-secret-change-in-production",
  databaseUrl: process.env.DATABASE_URL ?? "",
  isProduction: process.env.NODE_ENV === "production",

  // ── OIDC / Keycloak (replaces Manus OAuth) ────────────────────────────────
  // Default: Keycloak running as Docker Compose service "keycloak" on port 8080.
  keycloakUrl: process.env.KEYCLOAK_URL ?? "http://keycloak:8080",
  keycloakRealm: process.env.KEYCLOAK_REALM ?? "nexcom",
  keycloakClientId: process.env.KEYCLOAK_CLIENT_ID ?? "nexcom-exchange",
  keycloakClientSecret: process.env.KEYCLOAK_CLIENT_SECRET ?? "nexcom-exchange-secret",

  // ── LLM / AI (replaces Manus forge LLM proxy) ────────────────────────────
  // Default: Ollama running as Docker Compose service "ollama" on port 11434.
  // Set OPENAI_API_KEY to use OpenAI directly instead.
  openaiApiKey: process.env.OPENAI_API_KEY ?? process.env.LLM_API_KEY ?? "",
  llmBaseUrl: process.env.LLM_BASE_URL ?? "http://ollama:11434/v1",
  llmDefaultModel: process.env.LLM_DEFAULT_MODEL ?? "llama3.2",
  imageModel: process.env.IMAGE_MODEL ?? "dall-e-3",

  // ── S3-compatible storage (replaces Manus forge storage proxy) ────────────
  // Default: MinIO running as Docker Compose service "minio" on port 9000.
  // Works with AWS S3, MinIO, Cloudflare R2, Backblaze B2, etc.
  s3Bucket: process.env.S3_BUCKET ?? "nexcom-files",
  s3Endpoint: process.env.S3_ENDPOINT ?? "http://minio:9000",
  // Public URL used to construct download links.
  // In production, point this at your CDN or MinIO public endpoint.
  s3PublicBaseUrl: process.env.S3_PUBLIC_BASE_URL ?? "http://localhost:9000/nexcom-files",
  awsAccessKeyId: process.env.AWS_ACCESS_KEY_ID ?? "nexcom-minio",
  awsSecretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? "nexcom-minio-secret",
  awsRegion: process.env.AWS_REGION ?? "us-east-1",

  // ── Owner notifications (replaces Manus WebDevService) ───────────────────
  // The first user to log in with this email is automatically promoted to admin.
  ownerEmail: process.env.OWNER_EMAIL ?? process.env.EMAIL_FROM ?? "admin@nexcom.exchange",

  // ── Google Maps (replaces Manus forge Maps proxy) ─────────────────────────
  googleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY ?? "",
  mapsProxyUrl: process.env.MAPS_PROXY_URL ?? "",

  // ── Infrastructure connectivity ───────────────────────────────────────────
  kafkaBrokers: process.env.KAFKA_BROKERS ?? "kafka:9092",
  redisUrl: process.env.REDIS_URL ?? "redis://redis:6379",
  kedaNamespace: process.env.KEDA_NAMESPACE ?? "nexcom",

  // ── Microservice base URLs ─────────────────────────────────────────────────
  coreBankingUrl: process.env.CORE_BANKING_URL ?? "http://core-banking:8090",
  channelGatewayUrl: process.env.CHANNEL_GATEWAY_URL ?? "http://channel-gateway:8091",
  botLogicUrl: process.env.BOT_LOGIC_URL ?? "http://bot-logic:8092",
  ussdEngineUrl: process.env.USSD_ENGINE_URL ?? "http://ussd-engine:8093",
  indicesServiceUrl: process.env.INDICES_SERVICE_URL ?? "http://indices-service:8094",
  aiMlServiceUrl: process.env.AIML_SERVICE_URL ?? "http://aiml-service:8001",
  analyticsEngineUrl: process.env.ANALYTICS_ENGINE_URL ?? "http://analytics-engine:8002",
  kycServiceUrl: process.env.KYC_SERVICE_URL ?? "http://kyc-service:8003",
  tradingEngineUrl: process.env.TRADING_ENGINE_URL ?? "http://trading-engine:8004",
  riskServiceUrl: process.env.RISK_SERVICE_URL ?? "http://risk-service:8005",
  mojaloopAdapterUrl: process.env.MOJALOOP_ADAPTER_URL ?? "http://mojaloop-adapter:8006",
  userManagementUrl: process.env.USER_MANAGEMENT_URL ?? "http://user-management:8007",
  ingestionEngineUrl: process.env.INGESTION_ENGINE_URL ?? "http://ingestion-engine:8008",
  notificationServiceUrl: process.env.NOTIFICATION_SERVICE_URL ?? "http://notification-service:8009",
  opensearchUrl: process.env.OPENSEARCH_URL ?? "http://opensearch:9200",
  gatewayServiceUrl: process.env.GATEWAY_SERVICE_URL ?? "http://apisix:9080",
  blockchainServiceUrl: process.env.BLOCKCHAIN_SERVICE_URL ?? "http://blockchain-service:8010",
  fraudEngineUrl: process.env.FRAUD_ENGINE_URL ?? "http://fraud-engine:8011",
  creditScoringUrl: process.env.CREDIT_SCORING_URL ?? "http://credit-scoring:8012",

  // ── Workflow & ledger infrastructure ──────────────────────────────────────
  temporalUrl: process.env.TEMPORAL_URL ?? "http://temporal:7233",
  tigerBeetleUrl: process.env.TIGERBEETLE_URL ?? "http://tigerbeetle:3001",
  daprHttpUrl: process.env.DAPR_HTTP_URL ?? "http://localhost:3500",
  permifyUrl: process.env.PERMIFY_URL ?? "http://permify:3476",

  // ── Channel gateway secrets ────────────────────────────────────────────────
  africastalkingApiKey: process.env.AFRICASTALKING_API_KEY ?? "",
  africastalkingUsername: process.env.AFRICASTALKING_USERNAME ?? "sandbox",
  whatsappAccessToken: process.env.WHATSAPP_ACCESS_TOKEN ?? "",
  whatsappPhoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID ?? "",
  whatsappVerifyToken: process.env.WHATSAPP_VERIFY_TOKEN ?? "nexcom-wa-verify",
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN ?? "",

  // ── Email delivery ────────────────────────────────────────────────────────
  sendgridApiKey: process.env.SENDGRID_API_KEY ?? "",
  smtpHost: process.env.SMTP_HOST ?? "mailhog",
  smtpPort: parseInt(process.env.SMTP_PORT ?? "1025", 10),
  smtpUser: process.env.SMTP_USER ?? "",
  smtpPass: process.env.SMTP_PASS ?? "",
  emailFrom: process.env.EMAIL_FROM ?? "noreply@nexcom.exchange",
  emailEnabled: process.env.EMAIL_ENABLED !== "false",

  // ── VAPID keys for web push ────────────────────────────────────────────────
  vapidPublicKey: process.env.VAPID_PUBLIC_KEY ?? "",
  vapidPrivateKey: process.env.VAPID_PRIVATE_KEY ?? "",
  vapidSubject: process.env.VAPID_SUBJECT ?? "mailto:admin@nexcom.exchange",

  // ── Internal service secret ────────────────────────────────────────────────
  internalSecret: process.env.INTERNAL_SECRET ?? process.env.JWT_SECRET ?? "nexcom-internal-dev-2026",

  // ── PostgreSQL direct connection ───────────────────────────────────────────
  nexcomPgUrl: process.env.NEXCOM_PG_URL ?? "",
  nexcomPgReadUrl: process.env.NEXCOM_PG_READ_URL ?? "",
};
