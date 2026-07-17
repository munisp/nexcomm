/**
 * NEXCOM Exchange — centralised environment configuration
 *
 * All Manus-proprietary env vars (VITE_APP_ID, OAUTH_SERVER_URL,
 * BUILT_IN_FORGE_API_URL, BUILT_IN_FORGE_API_KEY, OWNER_OPEN_ID) have been
 * removed and replaced with self-hosted equivalents.
 *
 * Required for production:
 *   JWT_SECRET, DATABASE_URL (or NEXCOM_PG_URL), KEYCLOAK_URL,
 *   KEYCLOAK_REALM, KEYCLOAK_CLIENT_ID, KEYCLOAK_CLIENT_SECRET,
 *   OPENAI_API_KEY (or LLM_API_KEY + LLM_BASE_URL for Ollama),
 *   S3_BUCKET, S3_ENDPOINT, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY
 */
export const ENV = {
  // ── Core ──────────────────────────────────────────────────────────────────
  cookieSecret: process.env.JWT_SECRET ?? "",
  databaseUrl: process.env.DATABASE_URL ?? "",
  isProduction: process.env.NODE_ENV === "production",

  // ── OIDC / Keycloak (replaces Manus OAuth) ────────────────────────────────
  keycloakUrl: process.env.KEYCLOAK_URL ?? "http://localhost:8080",
  keycloakRealm: process.env.KEYCLOAK_REALM ?? "nexcom",
  keycloakClientId: process.env.KEYCLOAK_CLIENT_ID ?? "nexcom-exchange",
  keycloakClientSecret: process.env.KEYCLOAK_CLIENT_SECRET ?? "",

  // ── LLM / AI (replaces Manus forge LLM proxy) ────────────────────────────
  // Set LLM_BASE_URL + LLM_API_KEY to use Ollama or any OpenAI-compatible API.
  // Leave LLM_BASE_URL empty to use OpenAI directly.
  openaiApiKey: process.env.OPENAI_API_KEY ?? process.env.LLM_API_KEY ?? "",
  llmBaseUrl: process.env.LLM_BASE_URL ?? "",
  llmDefaultModel: process.env.LLM_DEFAULT_MODEL ?? "gpt-4o-mini",
  imageModel: process.env.IMAGE_MODEL ?? "dall-e-3",

  // ── S3-compatible storage (replaces Manus forge storage proxy) ────────────
  // Works with AWS S3, MinIO, Cloudflare R2, Backblaze B2, etc.
  s3Bucket: process.env.S3_BUCKET ?? "nexcom",
  s3Endpoint: process.env.S3_ENDPOINT ?? "",
  s3PublicBaseUrl: process.env.S3_PUBLIC_BASE_URL ?? "",
  awsAccessKeyId: process.env.AWS_ACCESS_KEY_ID ?? "",
  awsSecretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? "",
  awsRegion: process.env.AWS_REGION ?? "us-east-1",

  // ── Owner notifications (replaces Manus WebDevService) ───────────────────
  ownerEmail: process.env.OWNER_EMAIL ?? process.env.EMAIL_FROM ?? "",

  // ── Google Maps (replaces Manus forge Maps proxy) ─────────────────────────
  googleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY ?? "",
  mapsProxyUrl: process.env.MAPS_PROXY_URL ?? "",

  // ── Infrastructure connectivity ───────────────────────────────────────────
  kafkaBrokers: process.env.KAFKA_BROKERS ?? "localhost:9092",
  redisUrl: process.env.REDIS_URL ?? "redis://localhost:6379",
  // KEDA namespace — used when generating kubectl bootstrap instructions
  kedaNamespace: process.env.KEDA_NAMESPACE ?? "nexcom",

  // ── Microservice base URLs — override in production secrets ───────────────
  coreBankingUrl: process.env.CORE_BANKING_URL ?? "http://localhost:8090",
  channelGatewayUrl: process.env.CHANNEL_GATEWAY_URL ?? "http://localhost:8091",
  botLogicUrl: process.env.BOT_LOGIC_URL ?? "http://localhost:8092",
  ussdEngineUrl: process.env.USSD_ENGINE_URL ?? "http://localhost:8093",
  indicesServiceUrl: process.env.INDICES_SERVICE_URL ?? "http://localhost:8094",
  aiMlServiceUrl: process.env.AIML_SERVICE_URL ?? "http://localhost:8001",
  analyticsEngineUrl: process.env.ANALYTICS_ENGINE_URL ?? "http://localhost:8002",
  kycServiceUrl: process.env.KYC_SERVICE_URL ?? "http://localhost:8003",
  tradingEngineUrl: process.env.TRADING_ENGINE_URL ?? "http://localhost:8004",
  riskServiceUrl: process.env.RISK_SERVICE_URL ?? "http://localhost:8005",
  mojaloopAdapterUrl: process.env.MOJALOOP_ADAPTER_URL ?? "http://localhost:8006",
  userManagementUrl: process.env.USER_MANAGEMENT_URL ?? "http://localhost:8007",
  ingestionEngineUrl: process.env.INGESTION_ENGINE_URL ?? "http://localhost:8008",
  notificationServiceUrl: process.env.NOTIFICATION_SERVICE_URL ?? "http://localhost:8009",
  opensearchUrl: process.env.OPENSEARCH_URL ?? "http://localhost:9200",
  gatewayServiceUrl: process.env.GATEWAY_SERVICE_URL ?? "http://localhost:9080",
  blockchainServiceUrl: process.env.BLOCKCHAIN_SERVICE_URL ?? "http://localhost:8010",
  fraudEngineUrl: process.env.FRAUD_ENGINE_URL ?? "http://localhost:8011",
  creditScoringUrl: process.env.CREDIT_SCORING_URL ?? "http://localhost:8012",

  // ── Workflow & ledger infrastructure ──────────────────────────────────────
  temporalUrl: process.env.TEMPORAL_URL ?? "http://localhost:7233",
  tigerBeetleUrl: process.env.TIGERBEETLE_URL ?? "http://localhost:3001",
  daprHttpUrl: process.env.DAPR_HTTP_URL ?? "http://localhost:3500",
  permifyUrl: process.env.PERMIFY_URL ?? "http://localhost:3476",

  // ── Channel gateway secrets ────────────────────────────────────────────────
  africastalkingApiKey: process.env.AFRICASTALKING_API_KEY ?? "",
  africastalkingUsername: process.env.AFRICASTALKING_USERNAME ?? "sandbox",
  whatsappAccessToken: process.env.WHATSAPP_ACCESS_TOKEN ?? "",
  whatsappPhoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID ?? "",
  whatsappVerifyToken: process.env.WHATSAPP_VERIFY_TOKEN ?? "nexcom-wa-verify",
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN ?? "",

  // ── Email delivery ────────────────────────────────────────────────────────
  sendgridApiKey: process.env.SENDGRID_API_KEY ?? "",
  smtpHost: process.env.SMTP_HOST ?? "",
  smtpPort: parseInt(process.env.SMTP_PORT ?? "587", 10),
  smtpUser: process.env.SMTP_USER ?? "",
  smtpPass: process.env.SMTP_PASS ?? "",
  emailFrom: process.env.EMAIL_FROM ?? "noreply@nexcom.exchange",
  emailEnabled: process.env.EMAIL_ENABLED !== "false",

  // ── VAPID keys for web push ────────────────────────────────────────────────
  vapidPublicKey: process.env.VAPID_PUBLIC_KEY ?? "",
  vapidPrivateKey: process.env.VAPID_PRIVATE_KEY ?? "",
  vapidSubject: process.env.VAPID_SUBJECT ?? "mailto:admin@nexcom.exchange",

  // ── Internal service secret ────────────────────────────────────────────────
  internalSecret: process.env.INTERNAL_SECRET ?? process.env.JWT_SECRET ?? "nexcom-internal-2026",

  // ── PostgreSQL direct connection (optional, for read replicas) ────────────
  nexcomPgUrl: process.env.NEXCOM_PG_URL ?? "",
  nexcomPgReadUrl: process.env.NEXCOM_PG_READ_URL ?? "",
};
