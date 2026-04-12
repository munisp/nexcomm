export const ENV = {
  appId: process.env.VITE_APP_ID ?? "",
  cookieSecret: process.env.JWT_SECRET ?? "",
  databaseUrl: process.env.DATABASE_URL ?? "",
  oAuthServerUrl: process.env.OAUTH_SERVER_URL ?? "",
  ownerOpenId: process.env.OWNER_OPEN_ID ?? "",
  isProduction: process.env.NODE_ENV === "production",
  forgeApiUrl: process.env.BUILT_IN_FORGE_API_URL ?? "",
  forgeApiKey: process.env.BUILT_IN_FORGE_API_KEY ?? "",
  // Infrastructure connectivity — set these in production secrets
  kafkaBrokers: process.env.KAFKA_BROKERS ?? "localhost:9092",
  redisUrl: process.env.REDIS_URL ?? "redis://localhost:6379",
  // KEDA namespace — used when generating kubectl bootstrap instructions
  kedaNamespace: process.env.KEDA_NAMESPACE ?? "nexcom",
  // Microservice base URLs — override in production secrets
  coreBankingUrl: process.env.CORE_BANKING_URL ?? "",
  channelGatewayUrl: process.env.CHANNEL_GATEWAY_URL ?? "",
  botLogicUrl: process.env.BOT_LOGIC_URL ?? "",
  ussdEngineUrl: process.env.USSD_ENGINE_URL ?? "",
  indicesServiceUrl: process.env.INDICES_SERVICE_URL ?? "",

  // Channel gateway secrets — set in production Secrets panel
  africastalkingApiKey: process.env.AFRICASTALKING_API_KEY ?? "",
  africastalkingUsername: process.env.AFRICASTALKING_USERNAME ?? "sandbox",
  whatsappAccessToken: process.env.WHATSAPP_ACCESS_TOKEN ?? "",
  whatsappPhoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID ?? "",
  whatsappVerifyToken: process.env.WHATSAPP_VERIFY_TOKEN ?? "nexcom-wa-verify",
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN ?? "",
  // Email delivery — set SENDGRID_API_KEY or SMTP_HOST in production
  sendgridApiKey: process.env.SENDGRID_API_KEY ?? "",
  smtpHost: process.env.SMTP_HOST ?? "",
  smtpPort: parseInt(process.env.SMTP_PORT ?? "587", 10),
  smtpUser: process.env.SMTP_USER ?? "",
  smtpPass: process.env.SMTP_PASS ?? "",
  emailFrom: process.env.EMAIL_FROM ?? "noreply@nexcom.exchange",
  emailEnabled: process.env.EMAIL_ENABLED !== "false",
  // VAPID keys for web push — generate with: npx web-push generate-vapid-keys
  vapidPublicKey: process.env.VAPID_PUBLIC_KEY ?? "",
  vapidPrivateKey: process.env.VAPID_PRIVATE_KEY ?? "",
  vapidSubject: process.env.VAPID_SUBJECT ?? "mailto:admin@nexcom.exchange",
  // Internal service secret for cross-service calls
  internalSecret: process.env.INTERNAL_SECRET ?? process.env.JWT_SECRET ?? "nexcom-internal-2026",
  // PostgreSQL direct connection (optional, for read replicas)
  nexcomPgUrl: process.env.NEXCOM_PG_URL ?? "",
  nexcomPgReadUrl: process.env.NEXCOM_PG_READ_URL ?? "",
};