/**
 * shared/platformConstants.ts
 *
 * Platform-wide constants and default values for NEXCOM Exchange.
 * These are safe defaults — override via environment variables in production.
 */

// ─── Platform Identity ────────────────────────────────────────────────────────
export const PLATFORM_NAME = "NEXCOM Exchange";
export const PLATFORM_SHORT_NAME = "NEXCOM";
export const PLATFORM_DOMAIN = "nexcom.exchange";
export const PLATFORM_EMAIL = "support@nexcom.exchange";
export const PLATFORM_NOREPLY_EMAIL = "noreply@nexcom.exchange";
export const PLATFORM_ADMIN_EMAIL = "admin@nexcom.exchange";
export const PLATFORM_CURRENCY = "USD";
export const PLATFORM_LOCALE = "en-NG";
export const PLATFORM_TIMEZONE = "Africa/Lagos";

// ─── Trading Defaults ─────────────────────────────────────────────────────────
export const DEFAULT_ORDER_EXPIRY_DAYS = 30;
export const MIN_ORDER_QTY = 1;
export const MAX_ORDER_QTY = 1_000_000;
export const MIN_ORDER_VALUE_USD = 100;
export const MAX_ORDER_VALUE_USD = 50_000_000;
export const DEFAULT_TICK_SIZE = 0.01;
export const DEFAULT_LOT_SIZE = 1;
export const PRICE_PRECISION = 4;
export const QTY_PRECISION = 2;
export const MAX_OPEN_ORDERS_PER_USER = 50;
export const ORDER_BOOK_DEPTH = 20; // levels per side
export const MARKET_OPEN_HOUR_UTC = 7;   // 08:00 WAT
export const MARKET_CLOSE_HOUR_UTC = 15; // 16:00 WAT

// ─── KYC & Onboarding ─────────────────────────────────────────────────────────
export const KYC_DOCUMENT_MAX_SIZE_MB = 10;
export const KYC_DOCUMENT_ALLOWED_TYPES = ["image/jpeg", "image/png", "application/pdf"];
export const KYC_REVIEW_SLA_HOURS = 48;
export const KYC_RESUBMISSION_COOLDOWN_HOURS = 24;

// ─── Banking & Finance ────────────────────────────────────────────────────────
export const MIN_DEPOSIT_USD = 50;
export const MAX_DEPOSIT_USD = 500_000;
export const MIN_WITHDRAWAL_USD = 10;
export const MAX_WITHDRAWAL_USD = 100_000;
export const WITHDRAWAL_PROCESSING_DAYS = 2;
export const LOAN_MIN_AMOUNT_NGN = 50_000;
export const LOAN_MAX_AMOUNT_NGN = 50_000_000;
export const LOAN_MIN_TENOR_MONTHS = 1;
export const LOAN_MAX_TENOR_MONTHS = 36;
export const LOAN_DEFAULT_INTEREST_RATE_PCT = 18; // annual
export const LOAN_PROCESSING_FEE_PCT = 1.5;

// ─── Warehouse & Storage ──────────────────────────────────────────────────────
export const WR_MIN_QUANTITY_KG = 100;
export const WR_MAX_QUANTITY_KG = 10_000_000;
export const WR_DEFAULT_STORAGE_FEE_PCT_PER_MONTH = 0.5;
export const WR_DEFAULT_INSURANCE_FEE_PCT = 0.25;
export const WR_VALIDITY_DAYS = 180;

// ─── Broker & Commission ──────────────────────────────────────────────────────
export const BROKER_MIN_COMMISSION_PCT = 0.1;
export const BROKER_MAX_COMMISSION_PCT = 3.0;
export const BROKER_DEFAULT_COMMISSION_PCT = 0.5;
export const SUB_BROKER_COMMISSION_SPLIT_PCT = 40; // sub-broker gets 40% of broker commission

// ─── Notifications ────────────────────────────────────────────────────────────
export const PUSH_NOTIFICATION_TTL_SECONDS = 86400; // 24 hours
export const PRICE_ALERT_COOLDOWN_MINUTES = 15;
export const MAX_PRICE_ALERTS_PER_USER = 20;

// ─── API Rate Limits ──────────────────────────────────────────────────────────
export const API_RATE_LIMIT_PER_MINUTE = 120;
export const API_RATE_LIMIT_BURST = 20;
export const WS_MAX_SUBSCRIPTIONS_PER_CLIENT = 50;
export const WS_HEARTBEAT_INTERVAL_MS = 30_000;
export const WS_RECONNECT_DELAY_MS = 3_000;

// ─── Pagination ───────────────────────────────────────────────────────────────
export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

// ─── Session & Security ───────────────────────────────────────────────────────
export const SESSION_EXPIRY_DAYS = 30;
export const MAX_ACTIVE_SESSIONS = 10;
export const TOTP_WINDOW = 1; // ±1 time step tolerance
export const TOTP_BACKUP_CODES_COUNT = 8;
export const OTP_EXPIRY_MINUTES = 10;
export const MAX_LOGIN_ATTEMPTS = 5;
export const LOCKOUT_DURATION_MINUTES = 30;

// ─── Microservice Ports ───────────────────────────────────────────────────────
export const PORTS = {
  nexcomPortal: 3000,
  fixGateway: 8080,
  indicesService: 8081,
  channelGateway: 8082,
  botLogic: 8083,
  ussdEngine: 8084,
  coreBanking: 8090,
  analyticsEngine: 8006,
  aiMlService: 8007,
  matchingEngine: 8085,
  kycService: 8086,
  amlService: 8087,
  tigerBeetle: 3001,
  mojaloop: 3003,
  temporal: 7233,
  permify: 3478,
} as const;

// ─── Kafka Topics ─────────────────────────────────────────────────────────────
export const KAFKA_TOPICS = {
  orderPlaced: "nexcom.order.placed",
  orderMatched: "nexcom.order.matched",
  orderCancelled: "nexcom.order.cancelled",
  orderFilled: "nexcom.order.filled",
  priceUpdate: "nexcom.price.update",
  kycSubmitted: "nexcom.kyc.submitted",
  kycApproved: "nexcom.kyc.approved",
  kycRejected: "nexcom.kyc.rejected",
  loanApplied: "nexcom.loan.applied",
  loanApproved: "nexcom.loan.approved",
  loanDisbursed: "nexcom.loan.disbursed",
  loanRepaid: "nexcom.loan.repaid",
  loanDefaulted: "nexcom.loan.defaulted",
  settlementInitiated: "nexcom.settlement.initiated",
  settlementCompleted: "nexcom.settlement.completed",
  amlAlert: "nexcom.aml.alert",
  warehouseReceiptCreated: "nexcom.wr.created",
  warehouseReceiptPledged: "nexcom.wr.pledged",
  ussdSession: "nexcom.ussd.session",
  whatsappMessage: "nexcom.whatsapp.message",
  telegramMessage: "nexcom.telegram.message",
  pushNotification: "nexcom.push.notification",
} as const;

// ─── Commodity Symbols ────────────────────────────────────────────────────────
export const COMMODITY_SYMBOLS = [
  "MAIZE", "SORGHUM", "MILLET", "WHEAT", "RICE", "BARLEY", "OAT",
  "SOYBEAN", "GROUNDNUT", "SESAME", "SUNFLOWER", "PALM_OIL", "COCONUT",
  "GINGER", "PEPPER", "TURMERIC", "CARDAMOM", "CLOVES", "CINNAMON",
  "COWPEA", "SOYBEAN_MEAL", "PIGEON_PEA", "LENTIL",
  "COCOA", "COFFEE", "TEA", "SUGAR", "COTTON",
  "CASSAVA", "YAM", "POTATO", "SWEET_POTATO",
  "TOMATO", "ONION", "BANANA", "MANGO", "PINEAPPLE",
  "CATTLE", "GOAT", "SHEEP", "POULTRY",
  "TILAPIA", "CATFISH", "SHRIMP",
  "TIMBER", "BAMBOO",
  "CRUDE_OIL", "NATURAL_GAS",
  "GOLD", "SILVER", "COPPER",
] as const;

export type CommoditySymbol = typeof COMMODITY_SYMBOLS[number];

// ─── Index Definitions ────────────────────────────────────────────────────────
export const INDICES = {
  NAXI: { name: "NEXCOM Agri Index", description: "Broad African agricultural commodity index", baseValue: 1000 },
  NGGI: { name: "NEXCOM Grains & Grasses Index", description: "Grains and cereal crops index", baseValue: 500 },
  AOXI: { name: "NEXCOM Oilseeds Index", description: "African oilseeds and vegetable oils index", baseValue: 750 },
  WACCI: { name: "West Africa Cash Crops Index", description: "West African cash crops (cocoa, coffee, cotton)", baseValue: 600 },
} as const;

// ─── Supported Currencies ─────────────────────────────────────────────────────
export const SUPPORTED_CURRENCIES = ["USD", "NGN", "GHS", "KES", "ZAR", "XOF", "XAF", "EGP"] as const;
export type SupportedCurrency = typeof SUPPORTED_CURRENCIES[number];

// ─── Supported Countries ──────────────────────────────────────────────────────
export const SUPPORTED_COUNTRIES = [
  { code: "NG", name: "Nigeria", currency: "NGN", dialCode: "+234" },
  { code: "GH", name: "Ghana", currency: "GHS", dialCode: "+233" },
  { code: "KE", name: "Kenya", currency: "KES", dialCode: "+254" },
  { code: "ZA", name: "South Africa", currency: "ZAR", dialCode: "+27" },
  { code: "SN", name: "Senegal", currency: "XOF", dialCode: "+221" },
  { code: "CI", name: "Côte d'Ivoire", currency: "XOF", dialCode: "+225" },
  { code: "CM", name: "Cameroon", currency: "XAF", dialCode: "+237" },
  { code: "EG", name: "Egypt", currency: "EGP", dialCode: "+20" },
  { code: "ET", name: "Ethiopia", currency: "ETB", dialCode: "+251" },
  { code: "TZ", name: "Tanzania", currency: "TZS", dialCode: "+255" },
  { code: "UG", name: "Uganda", currency: "UGX", dialCode: "+256" },
  { code: "RW", name: "Rwanda", currency: "RWF", dialCode: "+250" },
] as const;
