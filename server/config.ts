/**
 * server/config.ts
 *
 * Centralised production configuration for NEXCOM Exchange server.
 * All values have safe defaults — override via environment variables.
 */
import { ENV } from "./_core/env";
import {
  DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, SESSION_EXPIRY_DAYS,
  MAX_ACTIVE_SESSIONS, TOTP_WINDOW, TOTP_BACKUP_CODES_COUNT,
  OTP_EXPIRY_MINUTES, MAX_LOGIN_ATTEMPTS, LOCKOUT_DURATION_MINUTES,
  PRICE_ALERT_COOLDOWN_MINUTES, MAX_PRICE_ALERTS_PER_USER,
  PUSH_NOTIFICATION_TTL_SECONDS, MARKET_OPEN_HOUR_UTC, MARKET_CLOSE_HOUR_UTC,
  LOAN_DEFAULT_INTEREST_RATE_PCT, LOAN_PROCESSING_FEE_PCT,
  BROKER_DEFAULT_COMMISSION_PCT, WR_DEFAULT_STORAGE_FEE_PCT_PER_MONTH,
  API_RATE_LIMIT_PER_MINUTE, WS_HEARTBEAT_INTERVAL_MS,
  KAFKA_TOPICS, PORTS,
} from "../shared/platformConstants";

export const config = {
  // ─── Server ───────────────────────────────────────────────────────────────
  port: parseInt(process.env.PORT ?? String(PORTS.nexcomPortal), 10),
  nodeEnv: process.env.NODE_ENV ?? "development",
  isProduction: process.env.NODE_ENV === "production",
  isTest: process.env.NODE_ENV === "test",

  // ─── Auth & Session ───────────────────────────────────────────────────────
  cookieSecret: ENV.cookieSecret || "nexcom-dev-secret-change-in-production",
  sessionExpiryDays: SESSION_EXPIRY_DAYS,
  maxActiveSessions: MAX_ACTIVE_SESSIONS,
  maxLoginAttempts: MAX_LOGIN_ATTEMPTS,
  lockoutDurationMinutes: LOCKOUT_DURATION_MINUTES,

  // ─── TOTP / 2FA ───────────────────────────────────────────────────────────
  totpWindow: TOTP_WINDOW,
  totpBackupCodesCount: TOTP_BACKUP_CODES_COUNT,
  otpExpiryMinutes: OTP_EXPIRY_MINUTES,
  totpIssuer: "NEXCOM Exchange",

  // ─── Pagination ───────────────────────────────────────────────────────────
  defaultPageSize: DEFAULT_PAGE_SIZE,
  maxPageSize: MAX_PAGE_SIZE,

  // ─── Notifications ────────────────────────────────────────────────────────
  pushTtlSeconds: PUSH_NOTIFICATION_TTL_SECONDS,
  priceAlertCooldownMinutes: PRICE_ALERT_COOLDOWN_MINUTES,
  maxPriceAlertsPerUser: MAX_PRICE_ALERTS_PER_USER,

  // ─── Market Hours ─────────────────────────────────────────────────────────
  marketOpenHourUtc: MARKET_OPEN_HOUR_UTC,
  marketCloseHourUtc: MARKET_CLOSE_HOUR_UTC,

  // ─── Finance Defaults ─────────────────────────────────────────────────────
  loanDefaultInterestRatePct: LOAN_DEFAULT_INTEREST_RATE_PCT,
  loanProcessingFeePct: LOAN_PROCESSING_FEE_PCT,
  brokerDefaultCommissionPct: BROKER_DEFAULT_COMMISSION_PCT,
  wrStorageFeePctPerMonth: WR_DEFAULT_STORAGE_FEE_PCT_PER_MONTH,

  // ─── Rate Limiting ────────────────────────────────────────────────────────
  apiRateLimitPerMinute: API_RATE_LIMIT_PER_MINUTE,
  wsHeartbeatIntervalMs: WS_HEARTBEAT_INTERVAL_MS,

  // ─── Kafka ────────────────────────────────────────────────────────────────
  kafkaBrokers: ENV.kafkaBrokers.split(","),
  kafkaTopics: KAFKA_TOPICS,

  // ─── Microservice URLs ────────────────────────────────────────────────────
  services: {
    coreBanking: ENV.coreBankingUrl || `http://localhost:${PORTS.coreBanking}`,
    channelGateway: ENV.channelGatewayUrl || `http://localhost:${PORTS.channelGateway}`,
    botLogic: ENV.botLogicUrl || `http://localhost:${PORTS.botLogic}`,
    ussdEngine: ENV.ussdEngineUrl || `http://localhost:${PORTS.ussdEngine}`,
    indicesService: ENV.indicesServiceUrl || `http://localhost:${PORTS.indicesService}`,
    analyticsEngine: `http://localhost:${PORTS.analyticsEngine}`,
    aiMlService: `http://localhost:${PORTS.aiMlService}`,
    matchingEngine: `http://localhost:${PORTS.matchingEngine}`,
    kycService: `http://localhost:${PORTS.kycService}`,
    amlService: `http://localhost:${PORTS.amlService}`,
  },

  // ─── Internal Auth ────────────────────────────────────────────────────────
  internalSecret: ENV.internalSecret,

  // ─── Email ────────────────────────────────────────────────────────────────
  email: {
    enabled: ENV.emailEnabled && process.env.NODE_ENV !== "test",
    from: ENV.emailFrom,
    sendgridApiKey: ENV.sendgridApiKey,
    smtpHost: ENV.smtpHost,
    smtpPort: ENV.smtpPort,
    smtpUser: ENV.smtpUser,
    smtpPass: ENV.smtpPass,
  },

  // ─── Channel Gateway ──────────────────────────────────────────────────────
  channels: {
    africastalkingApiKey: ENV.africastalkingApiKey,
    africastalkingUsername: ENV.africastalkingUsername,
    whatsappAccessToken: ENV.whatsappAccessToken,
    whatsappPhoneNumberId: ENV.whatsappPhoneNumberId,
    whatsappVerifyToken: ENV.whatsappVerifyToken,
    telegramBotToken: ENV.telegramBotToken,
  },

  // ─── Web Push ─────────────────────────────────────────────────────────────
  vapid: {
    publicKey: ENV.vapidPublicKey,
    privateKey: ENV.vapidPrivateKey,
    subject: ENV.vapidSubject,
  },
} as const;

export type Config = typeof config;
export default config;
