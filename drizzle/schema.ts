import {
  bigserial,
  boolean,
  customType,
  integer,
  json,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  real,
  serial,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/pg-core";

// ─── PostGIS custom geometry type ────────────────────────────────────────────
// Stores PostGIS geometry values; returns WKT string from DB.
export const geometry = customType<{ data: string; driverData: string; config: { type?: string; srid?: number } }>({
  dataType(config) {
    const t = (config as { type?: string; srid?: number } | undefined)?.type ?? "Geometry";
    const srid = (config as { type?: string; srid?: number } | undefined)?.srid ?? 4326;
    return `geometry(${t},${srid})`;
  },
});

// ============================================================
// Enums
// ============================================================
export const roleEnum = pgEnum("role", ["user", "admin", "farmer", "trader", "broker"]);
export const accountTypeEnum = pgEnum("account_type", ["FARMER", "TRADER", "PROCESSOR", "BROKER", "WAREHOUSE_OPERATOR", "MARKET_MAKER"]);
export const kycStatusEnum = pgEnum("kyc_status", ["PENDING", "VERIFIED", "REJECTED"]);
export const kycQueueStatusEnum = pgEnum("kyc_queue_status", ["PENDING", "UNDER_REVIEW", "APPROVED", "REJECTED"]);
export const alertConditionEnum = pgEnum("alert_condition", ["ABOVE", "BELOW", "CROSS_ABOVE", "CROSS_BELOW"]);
export const orderSideEnum = pgEnum("order_side", ["BUY", "SELL"]);
export const orderTypeEnum = pgEnum("order_type", ["LIMIT", "MARKET", "STOP_LIMIT"]);
export const orderStatusEnum = pgEnum("order_status", ["OPEN", "PARTIALLY_FILLED", "FILLED", "CANCELLED", "REJECTED", "EXPIRED"]);
export const assetClassEnum = pgEnum("asset_class", ["COMMODITY", "FOREX", "EQUITY", "DIGITAL_ASSET", "INDEX"]);
export const notificationTypeEnum = pgEnum("notification_type", ["TRADE", "SETTLEMENT", "KYC", "ALERT", "SYSTEM", "MARGIN_CALL", "LIQUIDATED", "SECURITY_ALERT"]);
export const stakeholderTypeEnum = pgEnum("stakeholder_type", ["FARMER", "TRADER", "BROKER", "WAREHOUSE_OPERATOR", "MARKET_MAKER", "ADMIN"]);

// ============================================================
// Users
// ============================================================
export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  openId: varchar("open_id", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("login_method", { length: 64 }),
  role: roleEnum("role").default("user").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  lastSignedIn: timestamp("last_signed_in").defaultNow().notNull(),
});
export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

// ============================================================
// Farmer / Trader Profiles (extended for onboarding)
// ============================================================
export const profiles = pgTable("profiles", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().unique(),
  accountType: accountTypeEnum("account_type").default("TRADER").notNull(),
  // Personal info
  firstName: varchar("first_name", { length: 64 }),
  lastName: varchar("last_name", { length: 64 }),
  phone: varchar("phone", { length: 20 }),
  nin: varchar("nin", { length: 20 }),
  bvn: varchar("bvn", { length: 20 }),
  address: text("address"),
  state: varchar("state", { length: 64 }),
  country: varchar("country", { length: 64 }).default("Nigeria"),
  // Business info
  companyName: varchar("company_name", { length: 256 }),
  rcNumber: varchar("rc_number", { length: 64 }),
  taxId: varchar("tax_id", { length: 64 }),
  // KYC
  kycStatus: kycStatusEnum("kyc_status").default("PENDING").notNull(),
  kycNotes: text("kyc_notes"),
  // Banking
  bankName: varchar("bank_name", { length: 128 }),
  bankAccount: varchar("bank_account", { length: 20 }),
  // Stakeholder type
  stakeholderType: stakeholderTypeEnum("stakeholder_type"),
  // Extra metadata (JSON blob for stakeholder-specific fields)
  metadata: json("metadata"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export type Profile = typeof profiles.$inferSelect;

// ============================================================
// Orders (commodity, forex, equities, digital assets)
// ============================================================
export const orders = pgTable("orders", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  userId: integer("user_id").notNull(),
  symbol: varchar("symbol", { length: 32 }).notNull(),
  assetClass: assetClassEnum("asset_class").default("COMMODITY").notNull(),
  side: orderSideEnum("side").notNull(),
  orderType: orderTypeEnum("order_type").notNull(),
  quantity: numeric("quantity", { precision: 18, scale: 6 }).notNull(),
  price: numeric("price", { precision: 18, scale: 6 }),
  stopPrice: numeric("stop_price", { precision: 18, scale: 6 }),
  filledQty: numeric("filled_qty", { precision: 18, scale: 6 }).default("0").notNull(),
  avgFillPrice: numeric("avg_fill_price", { precision: 18, scale: 6 }),
  status: orderStatusEnum("status").default("OPEN").notNull(),
  timeInForce: varchar("time_in_force", { length: 8 }).default("GTC").notNull(),
  clientOrderId: varchar("client_order_id", { length: 64 }),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  expiresAt: timestamp("expires_at"),
});
export type Order = typeof orders.$inferSelect;
export type InsertOrder = typeof orders.$inferInsert;

// ============================================================
// Order Amendments (audit trail for order modifications)
// ============================================================
export const orderAmendments = pgTable("order_amendments", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  orderId: integer("order_id").notNull(),
  userId: integer("user_id").notNull(),
  /** Snapshot of old values before the amendment */
  oldQty: numeric("old_qty", { precision: 18, scale: 6 }).notNull(),
  newQty: numeric("new_qty", { precision: 18, scale: 6 }).notNull(),
  oldPrice: numeric("old_price", { precision: 18, scale: 6 }),
  newPrice: numeric("new_price", { precision: 18, scale: 6 }),
  /** Free-text reason supplied by the trader (optional) */
  reason: text("reason"),
  /** True when this amendment was applied as part of a bulk amendMany operation */
  isBulk: boolean("is_bulk").default(false).notNull(),
  amendedAt: timestamp("amended_at").defaultNow().notNull(),
});
export type OrderAmendment = typeof orderAmendments.$inferSelect;
export type InsertOrderAmendment = typeof orderAmendments.$inferInsert;

// ============================================================
// Positions (current holdings per user per symbol)
// ============================================================
export const positions = pgTable("positions", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  symbol: varchar("symbol", { length: 32 }).notNull(),
  assetClass: assetClassEnum("asset_class").default("COMMODITY").notNull(),
  quantity: numeric("quantity", { precision: 18, scale: 6 }).default("0").notNull(),
  avgCost: numeric("avg_cost", { precision: 18, scale: 6 }).default("0").notNull(),
  realizedPnl: numeric("realized_pnl", { precision: 18, scale: 6 }).default("0").notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export type Position = typeof positions.$inferSelect;

// ============================================================
// Watchlist
// ============================================================
export const watchlist = pgTable("watchlist", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  symbol: varchar("symbol", { length: 32 }).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ============================================================
// Price Alerts
// ============================================================
export const priceAlerts = pgTable("price_alerts", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  symbol: varchar("symbol", { length: 32 }).notNull(),
  condition: alertConditionEnum("condition").notNull(),
  targetPrice: numeric("target_price", { precision: 18, scale: 6 }).notNull(),
  triggered: boolean("triggered").default(false).notNull(),
  notified: boolean("notified").default(false).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export type PriceAlert = typeof priceAlerts.$inferSelect;

// ============================================================
// Saved Orders (order templates)
// ============================================================
export const savedOrders = pgTable("saved_orders", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  name: varchar("name", { length: 128 }).notNull(),
  symbol: varchar("symbol", { length: 32 }).notNull(),
  side: orderSideEnum("side").notNull(),
  orderType: orderTypeEnum("order_type").notNull(),
  quantity: numeric("quantity", { precision: 18, scale: 6 }).notNull(),
  price: numeric("price", { precision: 18, scale: 6 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ============================================================
// Notifications
// ============================================================
export const notifications = pgTable("notifications", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  title: varchar("title", { length: 256 }).notNull(),
  message: text("message").notNull(),
  type: notificationTypeEnum("type").default("SYSTEM").notNull(),
  read: boolean("read").default(false).notNull(),
  metadata: json("metadata"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export type Notification = typeof notifications.$inferSelect;

// ============================================================
// Admin: KYC Queue (extended with documents and notes)
// ============================================================
export const kycQueue = pgTable("kyc_queue", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  status: kycQueueStatusEnum("status").default("PENDING").notNull(),
  reviewedBy: integer("reviewed_by"),
  reviewNotes: text("review_notes"),
  // Stores the full onboarding payload as JSON
  documents: json("documents"),
  submittedAt: timestamp("submitted_at").defaultNow().notNull(),
  reviewedAt: timestamp("reviewed_at"),
});
export type KycQueue = typeof kycQueue.$inferSelect;

// ============================================================
// Admin: Audit Log
// ============================================================
export const auditLog = pgTable("audit_log", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  userId: integer("user_id"),
  action: varchar("action", { length: 128 }).notNull(),
  resource: varchar("resource", { length: 128 }),
  resourceId: varchar("resource_id", { length: 64 }),
  details: json("details"),
  ipAddress: varchar("ip_address", { length: 45 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export type AuditLog = typeof auditLog.$inferSelect;

// ============================================================
// Warehouse Receipts (Electronic Warehouse Receipts)
// ============================================================
export const warehouseReceiptStatusEnum = pgEnum("warehouse_receipt_status", ["ACTIVE", "PLEDGED", "REDEEMED", "CANCELLED"]);

export const warehouseReceipts = pgTable("warehouse_receipts", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  receiptNumber: varchar("receipt_number", { length: 64 }).notNull().unique(),
  commodity: varchar("commodity", { length: 64 }).notNull(),
  grade: varchar("grade", { length: 32 }),
  quantity: numeric("quantity", { precision: 18, scale: 6 }).notNull(),
  unit: varchar("unit", { length: 16 }).notNull(),
  warehouseId: varchar("warehouse_id", { length: 64 }),
  warehouseName: varchar("warehouse_name", { length: 256 }),
  depositDate: timestamp("deposit_date").defaultNow().notNull(),
  expiryDate: timestamp("expiry_date"),
  status: warehouseReceiptStatusEnum("status").default("ACTIVE").notNull(),
  valueUsd: numeric("value_usd", { precision: 18, scale: 2 }),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export type WarehouseReceipt = typeof warehouseReceipts.$inferSelect;

// ============================================================
// Deposit Requests
// ============================================================
export const depositStatusEnum = pgEnum("deposit_status", ["PENDING", "RECEIVED", "GRADED", "STORED", "REJECTED"]);

export const depositRequests = pgTable("deposit_requests", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  commodity: varchar("commodity", { length: 64 }).notNull(),
  grade: varchar("grade", { length: 32 }),
  quantity: numeric("quantity", { precision: 18, scale: 6 }).notNull(),
  unit: varchar("unit", { length: 16 }).notNull(),
  warehouseId: varchar("warehouse_id", { length: 64 }),
  warehouseName: varchar("warehouse_name", { length: 256 }),
  expectedDate: timestamp("expected_date"),
  status: depositStatusEnum("status").default("PENDING").notNull(),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export type DepositRequest = typeof depositRequests.$inferSelect;

// ============================================================
// Delivery Orders
// ============================================================
export const deliveryStatusEnum = pgEnum("delivery_status", ["PENDING", "SCHEDULED", "IN_TRANSIT", "DELIVERED", "CANCELLED"]);

export const deliveryOrders = pgTable("delivery_orders", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  receiptId: integer("receipt_id"),
  commodity: varchar("commodity", { length: 64 }).notNull(),
  quantity: numeric("quantity", { precision: 18, scale: 6 }).notNull(),
  unit: varchar("unit", { length: 16 }).notNull(),
  deliveryAddress: text("delivery_address").notNull(),
  scheduledDate: timestamp("scheduled_date"),
  status: deliveryStatusEnum("status").default("PENDING").notNull(),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export type DeliveryOrder = typeof deliveryOrders.$inferSelect;

// ============================================================
// API Keys
// ============================================================
export const apiKeys = pgTable("api_keys", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  name: varchar("name", { length: 128 }).notNull(),
  keyHash: varchar("key_hash", { length: 256 }).notNull(),
  keyPrefix: varchar("key_prefix", { length: 16 }).notNull(),
  permissions: text("permissions").array().notNull().default([]),
  active: boolean("active").default(true).notNull(),
  lastUsedAt: timestamp("last_used_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  expiresAt: timestamp("expires_at"),
});
export type ApiKey = typeof apiKeys.$inferSelect;

// ============================================================
// Settlements (T+2 clearing for filled orders)
// ============================================================
import { bigint, uniqueIndex } from "drizzle-orm/pg-core";

export const settlementStatusEnum = pgEnum("settlement_status", ["PENDING", "MATCHED", "SETTLED", "FAILED", "DISPUTED"]);

export const settlements = pgTable("settlements", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  orderId: bigint("order_id", { mode: "number" }).notNull(),
  userId: integer("user_id").notNull(),
  symbol: varchar("symbol", { length: 32 }).notNull(),
  assetClass: assetClassEnum("asset_class").default("COMMODITY").notNull(),
  side: orderSideEnum("side").notNull(),
  quantity: numeric("quantity", { precision: 18, scale: 6 }).notNull(),
  price: numeric("price", { precision: 18, scale: 6 }).notNull(),
  grossAmount: numeric("gross_amount", { precision: 18, scale: 2 }).notNull(),
  fee: numeric("fee", { precision: 18, scale: 2 }).default("0").notNull(),
  netAmount: numeric("net_amount", { precision: 18, scale: 2 }).notNull(),
  currency: varchar("currency", { length: 8 }).default("NGN").notNull(),
  status: settlementStatusEnum("status").default("PENDING").notNull(),
  settlementDate: timestamp("settlement_date"),
  counterpartyId: integer("counterparty_id"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export type Settlement = typeof settlements.$inferSelect;

// ============================================================
// Portfolio Snapshots (daily equity curve for P&L chart)
// ============================================================
export const portfolioSnapshots = pgTable("portfolio_snapshots", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  snapshotDate: timestamp("snapshot_date").notNull(),
  totalValue: numeric("total_value", { precision: 18, scale: 2 }).default("0").notNull(),
  totalCost: numeric("total_cost", { precision: 18, scale: 2 }).default("0").notNull(),
  realizedPnl: numeric("realized_pnl", { precision: 18, scale: 2 }).default("0").notNull(),
  unrealizedPnl: numeric("unrealized_pnl", { precision: 18, scale: 2 }).default("0").notNull(),
  currency: varchar("currency", { length: 8 }).default("NGN").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export type PortfolioSnapshot = typeof portfolioSnapshots.$inferSelect;

// ============================================================
// User Preferences (currency, language, theme)
// ============================================================
export const userPreferences = pgTable("user_preferences", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().unique(),
  currency: varchar("currency", { length: 8 }).default("NGN").notNull(),
  language: varchar("language", { length: 16 }).default("en").notNull(),
  theme: varchar("theme", { length: 16 }).default("dark").notNull(),
  timezone: varchar("timezone", { length: 64 }).default("Africa/Lagos").notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  // Notification preferences
  notifTradeExecutions:  boolean("notif_trade_executions").default(true).notNull(),
  notifPriceAlerts:      boolean("notif_price_alerts").default(true).notNull(),
  notifEwrUpdates:       boolean("notif_ewr_updates").default(true).notNull(),
  notifDepositUpdates:   boolean("notif_deposit_updates").default(true).notNull(),
  notifDeliveryUpdates:  boolean("notif_delivery_updates").default(true).notNull(),
  notifSystemMessages:   boolean("notif_system_messages").default(false).notNull(),
  notifEmail:            boolean("notif_email").default(true).notNull(),
  notifSms:              boolean("notif_sms").default(false).notNull(),
  notifPush:             boolean("notif_push").default(true).notNull(),
});
export type UserPreferences = typeof userPreferences.$inferSelect;

// ============================================================
// Cooperative Bulk KYC Uploads
// ============================================================
export const bulkKycStatusEnum = pgEnum("bulk_kyc_status", [
  "PROCESSING", "COMPLETED", "FAILED", "PARTIAL",
]);

export const cooperativeBulkUploads = pgTable("cooperative_bulk_uploads", {
  id: serial("id").primaryKey(),
  uploadedBy: integer("uploaded_by").notNull(),
  fileName: varchar("file_name", { length: 256 }).notNull(),
  status: bulkKycStatusEnum("status").default("PROCESSING").notNull(),
  totalRows: integer("total_rows").notNull().default(0),
  processedRows: integer("processed_rows").notNull().default(0),
  successRows: integer("success_rows").notNull().default(0),
  failedRows: integer("failed_rows").notNull().default(0),
  errors: json("errors"),
  createdApplicationIds: json("created_application_ids"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  completedAt: timestamp("completed_at"),
});
export type CooperativeBulkUpload = typeof cooperativeBulkUploads.$inferSelect;

// ============================================================
// Margin Accounts & Collateral Ledger
// ============================================================
export const marginAccountStatusEnum = pgEnum("margin_account_status", [
  "ACTIVE", "SUSPENDED", "CLOSED",
]);
export const collateralTypeEnum = pgEnum("collateral_type", [
  "WAREHOUSE_RECEIPT", "CASH", "BOND", "EQUITY",
]);
export const collateralStatusEnum = pgEnum("collateral_status", [
  "ACTIVE", "RELEASED", "LIQUIDATED",
]);
export const collateralLedgerActionEnum = pgEnum("collateral_ledger_action", [
  "PLEDGE", "RELEASE", "LIQUIDATE", "REVALUE",
]);

export const marginAccounts = pgTable("margin_accounts", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().unique(),
  status: marginAccountStatusEnum("status").default("ACTIVE").notNull(),
  cashBalance: numeric("cash_balance", { precision: 18, scale: 2 }).default("0").notNull(),
  totalCollateralValue: numeric("total_collateral_value", { precision: 18, scale: 2 }).default("0").notNull(),
  usedMargin: numeric("used_margin", { precision: 18, scale: 2 }).default("0").notNull(),
  availableMargin: numeric("available_margin", { precision: 18, scale: 2 }).default("0").notNull(),
  marginCallLevel: numeric("margin_call_level", { precision: 5, scale: 2 }).default("30").notNull(),
  currency: varchar("currency", { length: 8 }).default("NGN").notNull(),
  lastMarginCallAt: timestamp("last_margin_call_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export type MarginAccount = typeof marginAccounts.$inferSelect;

export const collateralItems = pgTable("collateral_items", {
  id: serial("id").primaryKey(),
  marginAccountId: integer("margin_account_id").notNull(),
  userId: integer("user_id").notNull(),
  collateralType: collateralTypeEnum("collateral_type").notNull(),
  referenceId: integer("reference_id"),
  description: text("description").notNull(),
  faceValue: numeric("face_value", { precision: 18, scale: 2 }).notNull(),
  currentValue: numeric("current_value", { precision: 18, scale: 2 }).notNull(),
  haircut: numeric("haircut", { precision: 5, scale: 2 }).default("20").notNull(),
  eligibleValue: numeric("eligible_value", { precision: 18, scale: 2 }).notNull(),
  status: collateralStatusEnum("status").default("ACTIVE").notNull(),
  pledgedAt: timestamp("pledged_at").defaultNow().notNull(),
  releasedAt: timestamp("released_at"),
  notes: text("notes"),
});
export type CollateralItem = typeof collateralItems.$inferSelect;

export const collateralLedger = pgTable("collateral_ledger", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  userId: integer("user_id").notNull(),
  collateralItemId: integer("collateral_item_id"),
  action: collateralLedgerActionEnum("action").notNull(),
  amount: numeric("amount", { precision: 18, scale: 2 }).notNull(),
  balanceBefore: numeric("balance_before", { precision: 18, scale: 2 }).notNull(),
  balanceAfter: numeric("balance_after", { precision: 18, scale: 2 }).notNull(),
  description: text("description").notNull(),
  performedBy: integer("performed_by"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export type CollateralLedgerEntry = typeof collateralLedger.$inferSelect;

// ============================================================
// Settlement Dispute Resolution
// ============================================================
export const disputeStatusEnum = pgEnum("dispute_status", [
  "OPEN", "UNDER_REVIEW", "RESOLVED_SETTLED", "RESOLVED_FAILED", "WITHDRAWN",
]);
export const disputeResolutionEnum = pgEnum("dispute_resolution", [
  "SETTLED", "FAILED", "WITHDRAWN",
]);

export const settlementDisputes = pgTable("settlement_disputes", {
  id: serial("id").primaryKey(),
  settlementId: bigint("settlement_id", { mode: "number" }).notNull(),
  raisedBy: integer("raised_by").notNull(),
  assignedTo: integer("assigned_to"),
  status: disputeStatusEnum("status").default("OPEN").notNull(),
  reason: text("reason").notNull(),
  evidence: text("evidence"),
  resolution: disputeResolutionEnum("resolution"),
  resolutionNotes: text("resolution_notes"),
  resolvedBy: integer("resolved_by"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  resolvedAt: timestamp("resolved_at"),
  slaDeadline: timestamp("sla_deadline"),
  slaBreached: boolean("sla_breached").default(false).notNull(),
});
export type SettlementDispute = typeof settlementDisputes.$inferSelect;

export const disputeAuditLog = pgTable("dispute_audit_log", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  disputeId: integer("dispute_id").notNull(),
  performedBy: integer("performed_by").notNull(),
  action: varchar("action", { length: 64 }).notNull(),
  fromStatus: disputeStatusEnum("from_status"),
  toStatus: disputeStatusEnum("to_status"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export type DisputeAuditEntry = typeof disputeAuditLog.$inferSelect;

// ============================================================
// Dispute Evidence Attachments
// ============================================================
export const disputeEvidence = pgTable("dispute_evidence", {
  id: serial("id").primaryKey(),
  disputeId: integer("dispute_id").notNull(),
  uploadedBy: integer("uploaded_by").notNull(),
  fileKey: varchar("file_key", { length: 512 }).notNull(),
  fileUrl: text("file_url").notNull(),
  fileName: varchar("file_name", { length: 256 }).notNull(),
  mimeType: varchar("mime_type", { length: 128 }).notNull(),
  fileSize: integer("file_size").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export type DisputeEvidence = typeof disputeEvidence.$inferSelect;

// ============================================================
// Security Events & Anomaly Detection
// (Deepfake/social-engineering defence layer — Phase 31)
// ============================================================
export const securityEventSeverityEnum = pgEnum("security_event_severity", [
  "LOW", "MEDIUM", "HIGH", "CRITICAL",
]);
export const securityEventTypeEnum = pgEnum("security_event_type", [
  "RATE_LIMIT_BREACH",
  "ANOMALOUS_ORDER",
  "LARGE_WITHDRAWAL",
  "REPEATED_AUTH_FAILURE",
  "ADMIN_BULK_ACTION",
  "SUSPICIOUS_IP",
  "UNUSUAL_TRADE_PATTERN",
  "ACCOUNT_TAKEOVER_ATTEMPT",
]);
export const securityEventStatusEnum = pgEnum("security_event_status", [
  "OPEN", "INVESTIGATING", "RESOLVED", "FALSE_POSITIVE",
]);

export const securityEvents = pgTable("security_events", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  userId: integer("user_id"),
  eventType: securityEventTypeEnum("event_type").notNull(),
  severity: securityEventSeverityEnum("severity").notNull(),
  status: securityEventStatusEnum("status").default("OPEN").notNull(),
  title: varchar("title", { length: 256 }).notNull(),
  description: text("description").notNull(),
  metadata: json("metadata"),
  ipAddress: varchar("ip_address", { length: 45 }),
  resolvedBy: integer("resolved_by"),
  resolvedAt: timestamp("resolved_at"),
  resolutionNotes: text("resolution_notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export type SecurityEvent = typeof securityEvents.$inferSelect;

// Rate-limiting: track per-user action counts within a rolling window
export const rateLimitCounters = pgTable("rate_limit_counters", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  userId: integer("user_id").notNull(),
  action: varchar("action", { length: 64 }).notNull(),
  windowStart: timestamp("window_start").notNull(),
  count: integer("count").notNull().default(1),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// ─── Phase 32: Deepfake Verification, Webhook Config, IP Allowlist ───────────

// Withdrawal verification challenges: typed name+date before large withdrawals
export const withdrawalVerificationStatusEnum = pgEnum("withdrawal_verification_status", [
  "PENDING", "PASSED", "FAILED", "EXPIRED",
]);
export const withdrawalVerifications = pgTable("withdrawal_verifications", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  userId: integer("user_id").notNull(),
  amount: numeric("amount", { precision: 18, scale: 2 }).notNull(),
  challengeText: varchar("challenge_text", { length: 512 }).notNull(),
  expectedAnswer: varchar("expected_answer", { length: 512 }).notNull(),
  status: withdrawalVerificationStatusEnum("status").default("PENDING").notNull(),
  attemptCount: integer("attempt_count").default(0).notNull(),
  verifiedAt: timestamp("verified_at"),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export type WithdrawalVerification = typeof withdrawalVerifications.$inferSelect;

// Security event webhooks: outbound HTTP POST for HIGH/CRITICAL events
export const webhookEventFilterEnum = pgEnum("webhook_event_filter", [
  "ALL", "HIGH_AND_CRITICAL", "CRITICAL_ONLY",
]);
export const webhookConfigs = pgTable("webhook_configs", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  name: varchar("name", { length: 128 }).notNull(),
  url: varchar("url", { length: 2048 }).notNull(),
  secret: varchar("secret", { length: 256 }),
  eventFilter: webhookEventFilterEnum("event_filter").default("HIGH_AND_CRITICAL").notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  lastTriggeredAt: timestamp("last_triggered_at"),
  lastStatusCode: integer("last_status_code"),
  failureCount: integer("failure_count").default(0).notNull(),
  createdBy: integer("created_by").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export type WebhookConfig = typeof webhookConfigs.$inferSelect;

// IP Allowlist: restrict admin actions to trusted IP ranges
export const ipAllowlistScopeEnum = pgEnum("ip_allowlist_scope", [
  "GLOBAL_ADMIN", "BULK_OPERATIONS", "LIQUIDATION_OVERRIDE", "WITHDRAWAL_APPROVAL",
]);
export const ipAllowlist = pgTable("ip_allowlist", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  cidr: varchar("cidr", { length: 50 }).notNull(),
  label: varchar("label", { length: 128 }).notNull(),
  scope: ipAllowlistScopeEnum("scope").default("GLOBAL_ADMIN").notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  createdBy: integer("created_by").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export type IpAllowlistEntry = typeof ipAllowlist.$inferSelect;

// Platform settings: configurable thresholds (e.g., withdrawal challenge threshold)
export const platformSettings = pgTable("platform_settings", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  key: varchar("key", { length: 128 }).notNull().unique(),
  value: text("value").notNull(),
  description: text("description"),
  updatedBy: integer("updated_by"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export type PlatformSetting = typeof platformSettings.$inferSelect;

// ─── Phase 33: TOTP 2FA, Device Sessions, Withdrawal Velocity ─────────────────

// TOTP secrets for admin 2FA
export const totpSecrets = pgTable("totp_secrets", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  userId: integer("user_id").notNull().unique(),
  secret: varchar("secret", { length: 64 }).notNull(),
  isEnabled: boolean("is_enabled").default(false).notNull(),
  confirmedAt: timestamp("confirmed_at"),
  backupCodes: text("backup_codes"), // JSON array of hashed backup codes
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export type TotpSecret = typeof totpSecrets.$inferSelect;

// Device sessions for fingerprinting
export const deviceSessions = pgTable("device_sessions", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  userId: integer("user_id").notNull(),
  fingerprint: varchar("fingerprint", { length: 128 }).notNull(),
  userAgent: text("user_agent"),
  ipAddress: varchar("ip_address", { length: 64 }),
  timezone: varchar("timezone", { length: 64 }),
  screenResolution: varchar("screen_resolution", { length: 32 }),
  isKnown: boolean("is_known").default(false).notNull(),
  isTrusted: boolean("is_trusted").default(false).notNull(),
  lastSeenAt: timestamp("last_seen_at").defaultNow().notNull(),
  firstSeenAt: timestamp("first_seen_at").defaultNow().notNull(),
  revokedAt: timestamp("revoked_at"),
});
export type DeviceSession = typeof deviceSessions.$inferSelect;

// Withdrawal velocity limit configuration
export const velocityLimitConfig = pgTable("velocity_limit_config", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  userId: integer("user_id"),
  windowHours: integer("window_hours").default(24).notNull(),
  maxAmount: numeric("max_amount", { precision: 20, scale: 2 }).notNull(),
  currency: varchar("currency", { length: 8 }).default("NGN").notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  createdBy: integer("created_by").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export type VelocityLimitConfig = typeof velocityLimitConfig.$inferSelect;

// Withdrawal velocity ledger (rolling window entries)
export const velocityLedger = pgTable("velocity_ledger", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  userId: integer("user_id").notNull(),
  amount: numeric("amount", { precision: 20, scale: 2 }).notNull(),
  currency: varchar("currency", { length: 8 }).default("NGN").notNull(),
  reference: varchar("reference", { length: 128 }),
  recordedAt: timestamp("recorded_at").defaultNow().notNull(),
});
export type VelocityLedgerEntry = typeof velocityLedger.$inferSelect;

// ─── Phase 34: AML Compliance Reporting ──────────────────────────────────────
// AML detection rules (configurable thresholds)
export const amlRules = pgTable("aml_rules", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  name: varchar("name", { length: 128 }).notNull(),
  ruleType: varchar("rule_type", { length: 64 }).notNull(), // LARGE_TRANSACTION, RAPID_MOVEMENT, STRUCTURING, UNUSUAL_PATTERN, SANCTIONS_MATCH
  thresholdAmount: numeric("threshold_amount", { precision: 20, scale: 2 }),
  thresholdCount: integer("threshold_count"),
  windowHours: integer("window_hours").default(24),
  currency: varchar("currency", { length: 8 }).default("NGN"),
  severity: varchar("severity", { length: 16 }).default("MEDIUM").notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  description: text("description"),
  createdBy: integer("created_by").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export type AmlRule = typeof amlRules.$inferSelect;

// AML transaction flags (suspicious activity alerts)
export const amlFlags = pgTable("aml_flags", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  userId: integer("user_id").notNull(),
  ruleId: bigint("rule_id", { mode: "number" }),
  transactionRef: varchar("transaction_ref", { length: 128 }),
  transactionType: varchar("transaction_type", { length: 64 }).notNull(),
  amount: numeric("amount", { precision: 20, scale: 2 }),
  currency: varchar("currency", { length: 8 }).default("NGN"),
  flagReason: text("flag_reason").notNull(),
  severity: varchar("severity", { length: 16 }).default("MEDIUM").notNull(),
  status: varchar("status", { length: 32 }).default("PENDING").notNull(),
  reviewedBy: integer("reviewed_by"),
  reviewedAt: timestamp("reviewed_at"),
  reviewNotes: text("review_notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export type AmlFlag = typeof amlFlags.$inferSelect;

// Suspicious Activity Reports (SAR)
export const sarReports = pgTable("sar_reports", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  flagId: bigint("flag_id", { mode: "number" }),
  userId: integer("user_id").notNull(),
  reportNumber: varchar("report_number", { length: 64 }).notNull().unique(),
  subjectName: varchar("subject_name", { length: 256 }),
  subjectId: varchar("subject_id", { length: 128 }),
  activityType: varchar("activity_type", { length: 128 }).notNull(),
  activityDescription: text("activity_description").notNull(),
  totalAmount: numeric("total_amount", { precision: 20, scale: 2 }),
  currency: varchar("currency", { length: 8 }).default("NGN"),
  activityStartDate: timestamp("activity_start_date"),
  activityEndDate: timestamp("activity_end_date"),
  filedBy: integer("filed_by").notNull(),
  filedAt: timestamp("filed_at").defaultNow().notNull(),
  status: varchar("status", { length: 32 }).default("DRAFT").notNull(),
  regulatoryRef: varchar("regulatory_ref", { length: 128 }),
  exportedAt: timestamp("exported_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export type SarReport = typeof sarReports.$inferSelect;

// Compliance report exports
export const complianceExports = pgTable("compliance_exports", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  exportType: varchar("export_type", { length: 32 }).notNull(),
  format: varchar("format", { length: 8 }).notNull(),
  dateFrom: timestamp("date_from"),
  dateTo: timestamp("date_to"),
  filters: text("filters"),
  recordCount: integer("record_count").default(0),
  fileUrl: text("file_url"),
  fileKey: text("file_key"),
  generatedBy: integer("generated_by").notNull(),
  generatedAt: timestamp("generated_at").defaultNow().notNull(),
  status: varchar("status", { length: 16 }).default("PENDING").notNull(),
});
export type ComplianceExport = typeof complianceExports.$inferSelect;

// ─── Phase 35: Settlement Engine ─────────────────────────────────────────────
export const settlementCycles = pgTable("settlement_cycles", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  cycleDate: timestamp("cycle_date").notNull(),
  settlementType: varchar("settlement_type", { length: 8 }).default("T+1").notNull(),
  assetClass: varchar("asset_class", { length: 32 }).default("COMMODITY").notNull(),
  status: varchar("status", { length: 32 }).default("OPEN").notNull(),
  totalTrades: integer("total_trades").default(0),
  matchedTrades: integer("matched_trades").default(0),
  failedTrades: integer("failed_trades").default(0),
  grossValue: numeric("gross_value", { precision: 24, scale: 2 }).default("0"),
  netValue: numeric("net_value", { precision: 24, scale: 2 }).default("0"),
  currency: varchar("currency", { length: 8 }).default("NGN"),
  createdBy: integer("created_by").notNull(),
  openedAt: timestamp("opened_at").defaultNow().notNull(),
  matchedAt: timestamp("matched_at"),
  settledAt: timestamp("settled_at"),
  closedAt: timestamp("closed_at"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export type SettlementCycle = typeof settlementCycles.$inferSelect;

export const settlementPositions = pgTable("settlement_positions", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  cycleId: bigint("cycle_id", { mode: "number" }).notNull(),
  userId: integer("user_id").notNull(),
  instrument: varchar("instrument", { length: 64 }).notNull(),
  grossBuyQty: numeric("gross_buy_qty", { precision: 20, scale: 6 }).default("0"),
  grossSellQty: numeric("gross_sell_qty", { precision: 20, scale: 6 }).default("0"),
  netQty: numeric("net_qty", { precision: 20, scale: 6 }).default("0"),
  grossBuyValue: numeric("gross_buy_value", { precision: 20, scale: 2 }).default("0"),
  grossSellValue: numeric("gross_sell_value", { precision: 20, scale: 2 }).default("0"),
  netCashObligation: numeric("net_cash_obligation", { precision: 20, scale: 2 }).default("0"),
  currency: varchar("currency", { length: 8 }).default("NGN"),
  status: varchar("status", { length: 32 }).default("PENDING").notNull(),
  confirmedAt: timestamp("confirmed_at"),
  settledAt: timestamp("settled_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export type SettlementPosition = typeof settlementPositions.$inferSelect;

export const settlementInstructions = pgTable("settlement_instructions", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  cycleId: bigint("cycle_id", { mode: "number" }).notNull(),
  buyerUserId: integer("buyer_user_id").notNull(),
  sellerUserId: integer("seller_user_id").notNull(),
  orderId: bigint("order_id", { mode: "number" }),
  instrument: varchar("instrument", { length: 64 }).notNull(),
  quantity: numeric("quantity", { precision: 20, scale: 6 }).notNull(),
  price: numeric("price", { precision: 20, scale: 6 }).notNull(),
  totalValue: numeric("total_value", { precision: 20, scale: 2 }).notNull(),
  currency: varchar("currency", { length: 8 }).default("NGN"),
  instructionType: varchar("instruction_type", { length: 16 }).default("DVP").notNull(),
  status: varchar("status", { length: 32 }).default("PENDING").notNull(),
  failureReason: text("failure_reason"),
  confirmedAt: timestamp("confirmed_at"),
  settledAt: timestamp("settled_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export type SettlementInstruction = typeof settlementInstructions.$inferSelect;

export const settlementFails = pgTable("settlement_fails", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  instructionId: bigint("instruction_id", { mode: "number" }).notNull(),
  cycleId: bigint("cycle_id", { mode: "number" }).notNull(),
  failType: varchar("fail_type", { length: 32 }).notNull(),
  failedPartyUserId: integer("failed_party_user_id").notNull(),
  penaltyAmount: numeric("penalty_amount", { precision: 20, scale: 2 }).default("0"),
  currency: varchar("currency", { length: 8 }).default("NGN"),
  status: varchar("status", { length: 32 }).default("OPEN").notNull(),
  escalatedTo: varchar("escalated_to", { length: 128 }),
  escalatedAt: timestamp("escalated_at"),
  resolvedAt: timestamp("resolved_at"),
  resolutionNotes: text("resolution_notes"),
  reviewedBy: integer("reviewed_by"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export type SettlementFail = typeof settlementFails.$inferSelect;

// ─── Phase 36: Regulatory Reporting ─────────────────────────────────────────
export const regulatoryReports = pgTable("regulatory_reports", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  reportType: varchar("report_type", { length: 64 }).notNull(), // POSITION_REPORT, TRADE_CONFIRMATION, EOD_SUMMARY, CAMA_FILING, SEC_FILING, CBN_FILING
  reportDate: timestamp("report_date").notNull(),
  periodStart: timestamp("period_start").notNull(),
  periodEnd: timestamp("period_end").notNull(),
  assetClass: varchar("asset_class", { length: 32 }), // null = all
  format: varchar("format", { length: 8 }).default("CSV").notNull(), // CSV, JSON
  status: varchar("status", { length: 32 }).default("PENDING").notNull(), // PENDING, GENERATING, READY, FAILED
  rowCount: integer("row_count").default(0),
  fileSize: integer("file_size").default(0), // bytes
  content: text("content"), // generated CSV/JSON content stored inline
  errorMessage: text("error_message"),
  generatedBy: integer("generated_by").notNull(), // admin user id
  scheduleId: bigint("schedule_id", { mode: "number" }), // null = manual
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export type RegulatoryReport = typeof regulatoryReports.$inferSelect;

export const regulatoryReportSchedules = pgTable("regulatory_report_schedules", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  reportType: varchar("report_type", { length: 64 }).notNull(),
  assetClass: varchar("asset_class", { length: 32 }),
  format: varchar("format", { length: 8 }).default("CSV").notNull(),
  frequency: varchar("frequency", { length: 32 }).notNull(), // DAILY, WEEKLY, MONTHLY, QUARTERLY
  dayOfWeek: integer("day_of_week"), // 0=Sun..6=Sat for WEEKLY
  dayOfMonth: integer("day_of_month"), // 1-31 for MONTHLY/QUARTERLY
  timeUtc: varchar("time_utc", { length: 8 }).default("15:00").notNull(), // HH:MM UTC
  isActive: boolean("is_active").default(true).notNull(),
  lastRunAt: timestamp("last_run_at"),
  nextRunAt: timestamp("next_run_at"),
  createdBy: integer("created_by").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export type RegulatoryReportSchedule = typeof regulatoryReportSchedules.$inferSelect;

// ─── Phase 37: Market Maker Obligations Engine ───────────────────────────────
export const marketMakerProfiles = pgTable("market_maker_profiles", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  userId: integer("user_id").notNull().unique(),
  firmName: varchar("firm_name", { length: 128 }).notNull(),
  licenseNumber: varchar("license_number", { length: 64 }),
  assetClasses: text("asset_classes").notNull(), // JSON array: ["COMMODITY","EQUITY","FOREX","BOND"]
  instruments: text("instruments").notNull(), // JSON array of symbols
  status: varchar("status", { length: 32 }).default("ACTIVE").notNull(), // ACTIVE, SUSPENDED, REVOKED
  approvedBy: integer("approved_by"),
  approvedAt: timestamp("approved_at"),
  suspendedAt: timestamp("suspended_at"),
  suspensionReason: text("suspension_reason"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export type MarketMakerProfile = typeof marketMakerProfiles.$inferSelect;

export const marketMakerObligations = pgTable("market_maker_obligations", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  marketMakerId: bigint("market_maker_id", { mode: "number" }).notNull(), // FK -> market_maker_profiles.id
  instrument: varchar("instrument", { length: 32 }).notNull(),
  assetClass: varchar("asset_class", { length: 32 }).notNull(),
  minBidSize: numeric("min_bid_size", { precision: 20, scale: 8 }).notNull(),
  minAskSize: numeric("min_ask_size", { precision: 20, scale: 8 }).notNull(),
  maxSpreadBps: integer("max_spread_bps").notNull(), // max bid-ask spread in basis points
  minUptimePct: numeric("min_uptime_pct", { precision: 5, scale: 2 }).default("90.00").notNull(), // % of trading hours
  penaltyPerBreachNgn: numeric("penalty_per_breach_ngn", { precision: 20, scale: 2 }).default("50000.00").notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  effectiveFrom: timestamp("effective_from").notNull(),
  effectiveTo: timestamp("effective_to"),
  createdBy: integer("created_by").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export type MarketMakerObligation = typeof marketMakerObligations.$inferSelect;

export const marketMakerQuoteSnapshots = pgTable("market_maker_quote_snapshots", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  marketMakerId: bigint("market_maker_id", { mode: "number" }).notNull(),
  obligationId: bigint("obligation_id", { mode: "number" }).notNull(),
  instrument: varchar("instrument", { length: 32 }).notNull(),
  snapshotAt: timestamp("snapshot_at").defaultNow().notNull(),
  bidPrice: numeric("bid_price", { precision: 20, scale: 8 }),
  askPrice: numeric("ask_price", { precision: 20, scale: 8 }),
  bidSize: numeric("bid_size", { precision: 20, scale: 8 }),
  askSize: numeric("ask_size", { precision: 20, scale: 8 }),
  spreadBps: integer("spread_bps"),
  isCompliant: boolean("is_compliant").notNull(),
  breachType: varchar("breach_type", { length: 64 }), // SPREAD_TOO_WIDE, SIZE_TOO_SMALL, ABSENT, null=compliant
  tradingSessionDate: varchar("trading_session_date", { length: 16 }).notNull(), // YYYY-MM-DD
});
export type MarketMakerQuoteSnapshot = typeof marketMakerQuoteSnapshots.$inferSelect;

export const marketMakerPerformanceReports = pgTable("market_maker_performance_reports", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  marketMakerId: bigint("market_maker_id", { mode: "number" }).notNull(),
  obligationId: bigint("obligation_id", { mode: "number" }).notNull(),
  instrument: varchar("instrument", { length: 32 }).notNull(),
  reportDate: varchar("report_date", { length: 16 }).notNull(), // YYYY-MM-DD
  totalSnapshots: integer("total_snapshots").default(0).notNull(),
  compliantSnapshots: integer("compliant_snapshots").default(0).notNull(),
  uptimePct: numeric("uptime_pct", { precision: 5, scale: 2 }).default("0").notNull(),
  avgSpreadBps: integer("avg_spread_bps").default(0),
  maxSpreadBps: integer("max_spread_bps").default(0),
  spreadBreaches: integer("spread_breaches").default(0).notNull(),
  sizeBreaches: integer("size_breaches").default(0).notNull(),
  absenceBreaches: integer("absence_breaches").default(0).notNull(),
  totalBreaches: integer("total_breaches").default(0).notNull(),
  penaltyAmount: numeric("penalty_amount", { precision: 20, scale: 2 }).default("0").notNull(),
  penaltyStatus: varchar("penalty_status", { length: 32 }).default("PENDING").notNull(), // PENDING, INVOICED, PAID, WAIVED
  generatedAt: timestamp("generated_at").defaultNow().notNull(),
  reviewedBy: integer("reviewed_by"),
  reviewedAt: timestamp("reviewed_at"),
  notes: text("notes"),
});
export type MarketMakerPerformanceReport = typeof marketMakerPerformanceReports.$inferSelect;

// ─── Phase 38: Clearing House & Margin Call Engine ───────────────────────────
export const clearingAccountStatusEnum = pgEnum("clearing_account_status", ["ACTIVE", "SUSPENDED", "CLOSED"]);
export const marginCallStatusEnum = pgEnum("margin_call_status", ["OPEN", "PARTIALLY_MET", "MET", "DEFAULTED", "CANCELLED"]);
export const marginCallEventTypeEnum = pgEnum("margin_call_event_type", ["ISSUED", "DEPOSIT_RECEIVED", "PARTIALLY_MET", "MET", "DEFAULTED", "CANCELLED", "GRACE_EXTENDED"]);
export const autoLiquidationStatusEnum = pgEnum("auto_liquidation_status", ["PENDING", "EXECUTING", "COMPLETED", "FAILED", "CANCELLED"]);

export const clearingAccounts = pgTable("clearing_accounts", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  userId: integer("user_id").notNull().unique(),
  accountRef: varchar("account_ref", { length: 32 }).notNull().unique(),
  status: clearingAccountStatusEnum("status").default("ACTIVE").notNull(),
  initialMarginPct: numeric("initial_margin_pct", { precision: 6, scale: 4 }).default("0.10").notNull(),
  maintenanceMarginPct: numeric("maintenance_margin_pct", { precision: 6, scale: 4 }).default("0.07").notNull(),
  portfolioValue: numeric("portfolio_value", { precision: 20, scale: 2 }).default("0").notNull(),
  cashBalance: numeric("cash_balance", { precision: 20, scale: 2 }).default("0").notNull(),
  totalMarginRequired: numeric("total_margin_required", { precision: 20, scale: 2 }).default("0").notNull(),
  totalMarginPosted: numeric("total_margin_posted", { precision: 20, scale: 2 }).default("0").notNull(),
  equityRatio: numeric("equity_ratio", { precision: 8, scale: 6 }).default("1").notNull(),
  lastValuationAt: timestamp("last_valuation_at").defaultNow().notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  notes: text("notes"),
});
export type ClearingAccount = typeof clearingAccounts.$inferSelect;

export const marginCalls = pgTable("margin_calls", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  clearingAccountId: bigint("clearing_account_id", { mode: "number" }).notNull(),
  userId: integer("user_id").notNull(),
  callRef: varchar("call_ref", { length: 32 }).notNull().unique(),
  status: marginCallStatusEnum("status").default("OPEN").notNull(),
  equityRatioAtCall: numeric("equity_ratio_at_call", { precision: 8, scale: 6 }).notNull(),
  portfolioValueAtCall: numeric("portfolio_value_at_call", { precision: 20, scale: 2 }).notNull(),
  marginDeficit: numeric("margin_deficit", { precision: 20, scale: 2 }).notNull(),
  amountRequired: numeric("amount_required", { precision: 20, scale: 2 }).notNull(),
  amountReceived: numeric("amount_received", { precision: 20, scale: 2 }).default("0").notNull(),
  issuedAt: timestamp("issued_at").defaultNow().notNull(),
  dueAt: timestamp("due_at").notNull(),
  resolvedAt: timestamp("resolved_at"),
  autoLiquidationTriggeredAt: timestamp("auto_liquidation_triggered_at"),
  issuedBy: integer("issued_by"),
  notes: text("notes"),
});
export type MarginCall = typeof marginCalls.$inferSelect;

export const marginCallEvents = pgTable("margin_call_events", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  marginCallId: bigint("margin_call_id", { mode: "number" }).notNull(),
  eventType: marginCallEventTypeEnum("event_type").notNull(),
  amount: numeric("amount", { precision: 20, scale: 2 }),
  equityRatioAfter: numeric("equity_ratio_after", { precision: 8, scale: 6 }),
  performedBy: integer("performed_by"),
  occurredAt: timestamp("occurred_at").defaultNow().notNull(),
  notes: text("notes"),
});
export type MarginCallEvent = typeof marginCallEvents.$inferSelect;

export const autoLiquidationOrders = pgTable("auto_liquidation_orders", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  marginCallId: bigint("margin_call_id", { mode: "number" }).notNull(),
  clearingAccountId: bigint("clearing_account_id", { mode: "number" }).notNull(),
  userId: integer("user_id").notNull(),
  status: autoLiquidationStatusEnum("status").default("PENDING").notNull(),
  instrument: varchar("instrument", { length: 64 }).notNull(),
  quantity: numeric("quantity", { precision: 20, scale: 8 }).notNull(),
  estimatedValue: numeric("estimated_value", { precision: 20, scale: 2 }).notNull(),
  actualProceeds: numeric("actual_proceeds", { precision: 20, scale: 2 }),
  initiatedAt: timestamp("initiated_at").defaultNow().notNull(),
  completedAt: timestamp("completed_at"),
  initiatedBy: integer("initiated_by"),
  failureReason: text("failure_reason"),
  notes: text("notes"),
});
export type AutoLiquidationOrder = typeof autoLiquidationOrders.$inferSelect;

// ─── Phase 39: Investor Relations Portal ─────────────────────────────────────

export const irEventTypeEnum = pgEnum("ir_event_type", [
  "EARNINGS_RELEASE", "DIVIDEND_ANNOUNCEMENT", "AGM", "EGM",
  "RIGHTS_ISSUE", "BONUS_ISSUE", "STOCK_SPLIT", "MERGER_ACQUISITION",
  "REGULATORY_FILING", "INVESTOR_PRESENTATION", "ROADSHOW", "OTHER",
]);

export const irDocumentTypeEnum = pgEnum("ir_document_type", [
  "ANNUAL_REPORT", "INTERIM_REPORT", "QUARTERLY_REPORT",
  "PROSPECTUS", "CIRCULAR", "PRESS_RELEASE", "PRESENTATION",
  "FINANCIAL_STATEMENT", "REGULATORY_FILING", "OTHER",
]);

export const irEvents = pgTable("ir_events", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  companySymbol: varchar("company_symbol", { length: 16 }).notNull(),
  companyName: varchar("company_name", { length: 128 }).notNull(),
  eventType: irEventTypeEnum("event_type").notNull(),
  title: varchar("title", { length: 256 }).notNull(),
  description: text("description"),
  eventDate: timestamp("event_date").notNull(),
  isAllDay: boolean("is_all_day").default(true).notNull(),
  venue: varchar("venue", { length: 256 }),
  webcastUrl: varchar("webcast_url", { length: 512 }),
  // For dividend events
  dividendPerShare: numeric("dividend_per_share", { precision: 20, scale: 6 }),
  dividendCurrency: varchar("dividend_currency", { length: 8 }),
  exDividendDate: timestamp("ex_dividend_date"),
  recordDate: timestamp("record_date"),
  paymentDate: timestamp("payment_date"),
  // For earnings events
  epsActual: numeric("eps_actual", { precision: 20, scale: 6 }),
  epsEstimate: numeric("eps_estimate", { precision: 20, scale: 6 }),
  revenueActual: numeric("revenue_actual", { precision: 20, scale: 2 }),
  revenueEstimate: numeric("revenue_estimate", { precision: 20, scale: 2 }),
  isPublished: boolean("is_published").default(false).notNull(),
  publishedAt: timestamp("published_at"),
  createdBy: integer("created_by").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export type IrEvent = typeof irEvents.$inferSelect;

export const irDocuments = pgTable("ir_documents", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  companySymbol: varchar("company_symbol", { length: 16 }).notNull(),
  companyName: varchar("company_name", { length: 128 }).notNull(),
  documentType: irDocumentTypeEnum("document_type").notNull(),
  title: varchar("title", { length: 256 }).notNull(),
  description: text("description"),
  fiscalYear: integer("fiscal_year"),
  fiscalPeriod: varchar("fiscal_period", { length: 16 }), // Q1, Q2, Q3, Q4, H1, H2, FY
  fileUrl: varchar("file_url", { length: 512 }).notNull(),
  fileKey: varchar("file_key", { length: 512 }).notNull(),
  fileSizeBytes: integer("file_size_bytes"),
  mimeType: varchar("mime_type", { length: 64 }).default("application/pdf").notNull(),
  downloadCount: integer("download_count").default(0).notNull(),
  isPublished: boolean("is_published").default(false).notNull(),
  publishedAt: timestamp("published_at"),
  createdBy: integer("created_by").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export type IrDocument = typeof irDocuments.$inferSelect;

export const shareholderRegistry = pgTable("shareholder_registry", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  companySymbol: varchar("company_symbol", { length: 16 }).notNull(),
  userId: integer("user_id").notNull(),
  shareholderName: varchar("shareholder_name", { length: 128 }).notNull(),
  shareholderType: varchar("shareholder_type", { length: 32 }).default("INDIVIDUAL").notNull(), // INDIVIDUAL, INSTITUTIONAL, INSIDER, GOVERNMENT
  sharesHeld: numeric("shares_held", { precision: 20, scale: 0 }).notNull(),
  totalShares: numeric("total_shares", { precision: 20, scale: 0 }).notNull(),
  holdingPct: numeric("holding_pct", { precision: 10, scale: 6 }).notNull(),
  acquisitionDate: timestamp("acquisition_date"),
  lastUpdatedAt: timestamp("last_updated_at").defaultNow().notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export type ShareholderRecord = typeof shareholderRegistry.$inferSelect;

export const irSubscriptions = pgTable("ir_subscriptions", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  userId: integer("user_id").notNull(),
  companySymbol: varchar("company_symbol", { length: 16 }).notNull(),
  notifyEarnings: boolean("notify_earnings").default(true).notNull(),
  notifyDividends: boolean("notify_dividends").default(true).notNull(),
  notifyDocuments: boolean("notify_documents").default(true).notNull(),
  notifyEvents: boolean("notify_events").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export type IrSubscription = typeof irSubscriptions.$inferSelect;

// ============================================================
// Phase 40: Trade Surveillance & Circuit Breakers
// ============================================================

export const circuitBreakerRules = pgTable("circuit_breaker_rules", {
  id: serial("id").primaryKey(),
  instrument: varchar("instrument", { length: 32 }).notNull(), // e.g. "MAIZE-NG" or "*" for all
  assetClass: varchar("asset_class", { length: 32 }).default("COMMODITY").notNull(),
  triggerPct: numeric("trigger_pct", { precision: 8, scale: 4 }).notNull(), // e.g. 5.00 = 5%
  windowMinutes: integer("window_minutes").notNull(), // price move window
  haltDurationMinutes: integer("halt_duration_minutes").notNull(), // how long to halt trading
  isActive: boolean("is_active").default(true).notNull(),
  notes: text("notes"),
  createdBy: integer("created_by").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export type CircuitBreakerRule = typeof circuitBreakerRules.$inferSelect;

export const circuitBreakerEvents = pgTable("circuit_breaker_events", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  ruleId: integer("rule_id"),
  instrument: varchar("instrument", { length: 32 }).notNull(),
  assetClass: varchar("asset_class", { length: 32 }).notNull(),
  triggerPct: numeric("trigger_pct", { precision: 8, scale: 4 }).notNull(),
  priceBefore: numeric("price_before", { precision: 20, scale: 8 }).notNull(),
  priceAfter: numeric("price_after", { precision: 20, scale: 8 }).notNull(),
  actualMovePct: numeric("actual_move_pct", { precision: 8, scale: 4 }).notNull(),
  haltedAt: timestamp("halted_at").defaultNow().notNull(),
  haltUntil: timestamp("halt_until").notNull(),
  liftedAt: timestamp("lifted_at"),
  liftedBy: integer("lifted_by"),
  status: varchar("status", { length: 16 }).default("ACTIVE").notNull(), // ACTIVE, LIFTED, EXPIRED
  notes: text("notes"),
});
export type CircuitBreakerEvent = typeof circuitBreakerEvents.$inferSelect;

export const washTradeFlags = pgTable("wash_trade_flags", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  userId: integer("user_id").notNull(),
  instrument: varchar("instrument", { length: 32 }).notNull(),
  assetClass: varchar("asset_class", { length: 32 }).notNull(),
  buyOrderId: bigint("buy_order_id", { mode: "number" }),
  sellOrderId: bigint("sell_order_id", { mode: "number" }),
  buyPrice: numeric("buy_price", { precision: 20, scale: 8 }),
  sellPrice: numeric("sell_price", { precision: 20, scale: 8 }),
  quantity: numeric("quantity", { precision: 20, scale: 8 }),
  windowMinutes: integer("window_minutes").notNull(),
  detectedAt: timestamp("detected_at").defaultNow().notNull(),
  status: varchar("status", { length: 16 }).default("PENDING").notNull(), // PENDING, CONFIRMED, DISMISSED
  reviewedBy: integer("reviewed_by"),
  reviewedAt: timestamp("reviewed_at"),
  reviewNotes: text("review_notes"),
  penaltyApplied: boolean("penalty_applied").default(false).notNull(),
});
export type WashTradeFlag = typeof washTradeFlags.$inferSelect;

// ============================================================
// Phase 41: Derivatives & Futures Trading
// ============================================================

export const futuresContracts = pgTable("futures_contracts", {
  id: serial("id").primaryKey(),
  symbol: varchar("symbol", { length: 32 }).notNull().unique(),
  underlyingAsset: varchar("underlying_asset", { length: 64 }).notNull(),
  assetClass: varchar("asset_class", { length: 32 }).notNull().default("COMMODITY"),
  contractSize: numeric("contract_size", { precision: 18, scale: 6 }).notNull(), // e.g. 1000 kg
  tickSize: numeric("tick_size", { precision: 18, scale: 8 }).notNull(),          // min price move
  currency: varchar("currency", { length: 8 }).notNull().default("NGN"),
  expiryDate: timestamp("expiry_date").notNull(),
  settlementDate: timestamp("settlement_date").notNull(),
  initialMarginPct: numeric("initial_margin_pct", { precision: 8, scale: 4 }).notNull().default("0.10"),
  maintenanceMarginPct: numeric("maintenance_margin_pct", { precision: 8, scale: 4 }).notNull().default("0.07"),
  lastSettlementPrice: numeric("last_settlement_price", { precision: 20, scale: 8 }),
  lastMarkPrice: numeric("last_mark_price", { precision: 20, scale: 8 }),
  status: varchar("status", { length: 16 }).notNull().default("ACTIVE"), // ACTIVE, EXPIRED, SETTLED
  createdBy: integer("created_by"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export type FuturesContract = typeof futuresContracts.$inferSelect;

export const futuresPositions = pgTable("futures_positions", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  userId: integer("user_id").notNull(),
  contractId: integer("contract_id").notNull(),
  side: varchar("side", { length: 8 }).notNull(), // LONG, SHORT
  quantity: numeric("quantity", { precision: 18, scale: 6 }).notNull(),
  entryPrice: numeric("entry_price", { precision: 20, scale: 8 }).notNull(),
  currentMarkPrice: numeric("current_mark_price", { precision: 20, scale: 8 }),
  unrealizedPnl: numeric("unrealized_pnl", { precision: 20, scale: 8 }).default("0").notNull(),
  realizedPnl: numeric("realized_pnl", { precision: 20, scale: 8 }).default("0").notNull(),
  marginPosted: numeric("margin_posted", { precision: 20, scale: 8 }).notNull(),
  liquidationPrice: numeric("liquidation_price", { precision: 20, scale: 8 }),
  status: varchar("status", { length: 16 }).notNull().default("OPEN"), // OPEN, CLOSED, LIQUIDATED
  openedAt: timestamp("opened_at").defaultNow().notNull(),
  closedAt: timestamp("closed_at"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export type FuturesPosition = typeof futuresPositions.$inferSelect;

export const futuresSettlements = pgTable("futures_settlements", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  contractId: integer("contract_id").notNull(),
  settlementType: varchar("settlement_type", { length: 16 }).notNull(), // DAILY_MTM, FINAL
  settlementPrice: numeric("settlement_price", { precision: 20, scale: 8 }).notNull(),
  totalLongPnl: numeric("total_long_pnl", { precision: 20, scale: 8 }).default("0").notNull(),
  totalShortPnl: numeric("total_short_pnl", { precision: 20, scale: 8 }).default("0").notNull(),
  positionsSettled: integer("positions_settled").default(0).notNull(),
  settledBy: integer("settled_by"),
  settledAt: timestamp("settled_at").defaultNow().notNull(),
  notes: text("notes"),
});
export type FuturesSettlement = typeof futuresSettlements.$inferSelect;

export const openInterestSnapshots = pgTable("open_interest_snapshots", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  contractId: integer("contract_id").notNull(),
  snapshotDate: timestamp("snapshot_date").defaultNow().notNull(),
  totalLongQty: numeric("total_long_qty", { precision: 18, scale: 6 }).default("0").notNull(),
  totalShortQty: numeric("total_short_qty", { precision: 18, scale: 6 }).default("0").notNull(),
  openInterest: numeric("open_interest", { precision: 18, scale: 6 }).default("0").notNull(),
  dailyVolume: numeric("daily_volume", { precision: 18, scale: 6 }).default("0").notNull(),
  settlementPrice: numeric("settlement_price", { precision: 20, scale: 8 }),
});
export type OpenInterestSnapshot = typeof openInterestSnapshots.$inferSelect;

// ============================================================
// Phase 42: Options Trading
// ============================================================
export const optionTypeEnum = pgEnum("option_type", ["CALL", "PUT"]);
export const optionStatusEnum = pgEnum("option_status", ["ACTIVE", "EXPIRED", "SETTLED"]);
export const optionPositionStatusEnum = pgEnum("option_position_status", ["OPEN", "EXERCISED", "EXPIRED", "CLOSED"]);

export const optionsContracts = pgTable("options_contracts", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  symbol: varchar("symbol", { length: 50 }).notNull().unique(),
  underlyingContractId: integer("underlying_contract_id"), // references futuresContracts
  optionType: optionTypeEnum("option_type").notNull(),
  strikePrice: numeric("strike_price", { precision: 20, scale: 8 }).notNull(),
  expiryDate: timestamp("expiry_date").notNull(),
  contractSize: numeric("contract_size", { precision: 18, scale: 6 }).default("1").notNull(),
  // Black-Scholes inputs
  riskFreeRate: numeric("risk_free_rate", { precision: 10, scale: 6 }).default("0.05").notNull(), // annualised
  impliedVolatility: numeric("implied_volatility", { precision: 10, scale: 6 }).default("0.20").notNull(), // annualised
  // Market data
  lastPrice: numeric("last_price", { precision: 20, scale: 8 }),
  openInterest: integer("open_interest").default(0).notNull(),
  status: optionStatusEnum("status").default("ACTIVE").notNull(),
  createdBy: integer("created_by"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export type OptionsContract = typeof optionsContracts.$inferSelect;

export const optionsPositions = pgTable("options_positions", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  userId: integer("user_id").notNull(),
  contractId: integer("contract_id").notNull(), // references optionsContracts
  optionType: optionTypeEnum("option_type").notNull(),
  quantity: numeric("quantity", { precision: 18, scale: 6 }).notNull(),
  premiumPaid: numeric("premium_paid", { precision: 20, scale: 8 }).notNull(), // per unit
  totalCost: numeric("total_cost", { precision: 20, scale: 8 }).notNull(),
  strikePrice: numeric("strike_price", { precision: 20, scale: 8 }).notNull(),
  expiryDate: timestamp("expiry_date").notNull(),
  status: optionPositionStatusEnum("status").default("OPEN").notNull(),
  exercisedAt: timestamp("exercised_at"),
  settlementPnl: numeric("settlement_pnl", { precision: 20, scale: 8 }),
  openedAt: timestamp("opened_at").defaultNow().notNull(),
  closedAt: timestamp("closed_at"),
});
export type OptionsPosition = typeof optionsPositions.$inferSelect;

// ─── Phase 43: Portfolio Equity Curve Snapshots ──────────────────────────────
export const portfolioEquitySnapshots = pgTable("portfolio_equity_snapshots", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  userId: integer("user_id").notNull(),
  snapshotDate: timestamp("snapshot_date").notNull(),
  spotPnl: numeric("spot_pnl", { precision: 20, scale: 8 }).default("0").notNull(),
  futuresPnl: numeric("futures_pnl", { precision: 20, scale: 8 }).default("0").notNull(),
  optionsPnl: numeric("options_pnl", { precision: 20, scale: 8 }).default("0").notNull(),
  cashBalance: numeric("cash_balance", { precision: 20, scale: 8 }).default("0").notNull(),
  totalEquity: numeric("total_equity", { precision: 20, scale: 8 }).default("0").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export type PortfolioEquitySnapshot = typeof portfolioEquitySnapshots.$inferSelect;

// ─── Farmer Onboarding ────────────────────────────────────────────────────────
export const farmerKycStatusEnum = pgEnum("farmer_kyc_status", ["PENDING", "SUBMITTED", "UNDER_REVIEW", "APPROVED", "REJECTED"]);
export const soilTypeEnum = pgEnum("soil_type", ["LOAMY", "CLAY", "SANDY", "SILT", "PEAT", "CHALK", "OTHER"]);
export const cropStatusEnum = pgEnum("crop_status_v2", ["ACTIVE", "SOLD", "EXPIRED", "WITHDRAWN"]);

export const farmerProfiles = pgTable("farmer_profiles", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  userId: integer("user_id").notNull().unique(),
  fullName: varchar("full_name", { length: 200 }).notNull(),
  phone: varchar("phone", { length: 20 }).notNull(),
  nin: varchar("nin", { length: 30 }),
  bvn: varchar("bvn", { length: 30 }),
  state: varchar("state", { length: 100 }).notNull(),
  lga: varchar("lga", { length: 100 }).notNull(),
  kycStatus: farmerKycStatusEnum("kyc_status").default("PENDING").notNull(),
  kycDocuments: text("kyc_documents"), // JSON array of document URLs
  kycReviewedAt: timestamp("kyc_reviewed_at"),
  kycReviewedBy: integer("kyc_reviewed_by"),
  kycNotes: text("kyc_notes"),
  // Bank / payment settlement details
  bankName: varchar("bank_name", { length: 100 }),
  bankAccountNumber: varchar("bank_account_number", { length: 30 }),
  bankAccountName: varchar("bank_account_name", { length: 200 }),
  mobileMoneyProvider: varchar("mobile_money_provider", { length: 50 }),
  mobileMoneyNumber: varchar("mobile_money_number", { length: 20 }),
  // Onboarding progress tracking
  onboardingStep: integer("onboarding_step").default(1).notNull(),
  onboardingCompletedAt: timestamp("onboarding_completed_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export type FarmerProfile = typeof farmerProfiles.$inferSelect;

// ─── Farmer Onboarding Drafts (offline-first PWA support) ────────────────────
export const farmerOnboardingDrafts = pgTable("farmer_onboarding_drafts", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  userId: integer("user_id").notNull().unique(),
  step: integer("step").default(1).notNull(),
  payload: jsonb("payload").$type<Record<string, unknown>>().default({}).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export type FarmerOnboardingDraft = typeof farmerOnboardingDrafts.$inferSelect;

export const farmProfiles = pgTable("farm_profiles", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  userId: integer("user_id").notNull(),
  farmName: varchar("farm_name", { length: 200 }).notNull(),
  sizeHectares: numeric("size_hectares", { precision: 10, scale: 2 }).notNull(),
  latitude: numeric("latitude", { precision: 10, scale: 7 }),
  longitude: numeric("longitude", { precision: 10, scale: 7 }),
  state: varchar("state", { length: 100 }).notNull(),
  lga: varchar("lga", { length: 100 }).notNull(),
  soilType: soilTypeEnum("soil_type").default("LOAMY").notNull(),
  description: text("description"),
  // GeoJSON polygon boundary drawn by farmer (FeatureCollection with one Polygon feature)
  boundary: jsonb("boundary"),
  // PostGIS geometry columns (WGS-84 SRID 4326)
  centroid: geometry("centroid", { type: "Point", srid: 4326 }),
  geom: geometry("geom", { type: "Polygon", srid: 4326 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export type FarmProfile = typeof farmProfiles.$inferSelect;

export const cropListings = pgTable("crop_listings", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  userId: integer("user_id").notNull(),
  farmId: integer("farm_id").notNull(),
  cropType: varchar("crop_type", { length: 100 }).notNull(),
  variety: varchar("variety", { length: 100 }),
  quantityKg: numeric("quantity_kg", { precision: 14, scale: 2 }).notNull(),
  askingPricePerKg: numeric("asking_price_per_kg", { precision: 14, scale: 4 }).notNull(),
  currency: varchar("currency", { length: 10 }).default("NGN").notNull(),
  expectedHarvestDate: timestamp("expected_harvest_date").notNull(),
  description: text("description"),
  status: cropStatusEnum("status").default("ACTIVE").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export type CropListing = typeof cropListings.$inferSelect;

// ─── Listing Messages (farmer-to-buyer in-app chat) ──────────────────────────
export const listingMessages = pgTable("listing_messages", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  listingId: integer("listing_id").notNull(),
  senderId: integer("sender_id").notNull(),
  recipientId: integer("recipient_id").notNull(),
  message: text("message").notNull(),
  isRead: boolean("is_read").default(false).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export type ListingMessage = typeof listingMessages.$inferSelect;

// ─── Farmer Earnings (settled crop sale records) ─────────────────────────────
export const farmerEarnings = pgTable("farmer_earnings", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  userId: integer("user_id").notNull(),
  listingId: integer("listing_id"),
  cropType: varchar("crop_type", { length: 100 }).notNull(),
  quantityKg: numeric("quantity_kg", { precision: 14, scale: 2 }).notNull(),
  pricePerKg: numeric("price_per_kg", { precision: 14, scale: 4 }).notNull(),
  totalAmount: numeric("total_amount", { precision: 18, scale: 2 }).notNull(),
  currency: varchar("currency", { length: 10 }).default("NGN").notNull(),
  buyerName: varchar("buyer_name", { length: 200 }),
  settledAt: timestamp("settled_at").defaultNow().notNull(),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export type FarmerEarning = typeof farmerEarnings.$inferSelect;

// ─── Trader Profiles ──────────────────────────────────────────────────────────
export const traderKycStatusEnum = pgEnum("trader_kyc_status", ["PENDING", "UNDER_REVIEW", "APPROVED", "REJECTED"]);
export const traderAccountStatusEnum = pgEnum("trader_account_status", ["INACTIVE", "ACTIVE", "SUSPENDED"]);
export const traderRiskProfileEnum = pgEnum("trader_risk_profile", ["CONSERVATIVE", "MODERATE", "AGGRESSIVE"]);
export const traderExperienceEnum = pgEnum("trader_experience", ["BEGINNER", "INTERMEDIATE", "EXPERIENCED", "PROFESSIONAL"]);

export const traderProfiles = pgTable("trader_profiles", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  userId: integer("user_id").notNull().unique(),
  fullName: varchar("full_name", { length: 200 }).notNull(),
  phone: varchar("phone", { length: 30 }).notNull(),
  nin: varchar("nin", { length: 50 }),
  bvn: varchar("bvn", { length: 50 }),
  email: varchar("email", { length: 200 }),
  address: text("address"),
  state: varchar("state", { length: 100 }),
  lga: varchar("lga", { length: 100 }),
  tradingExperience: traderExperienceEnum("trading_experience").default("BEGINNER").notNull(),
  preferredMarkets: text("preferred_markets").array(),
  capitalRange: varchar("capital_range", { length: 50 }),
  riskProfile: traderRiskProfileEnum("risk_profile").default("MODERATE").notNull(),
  idDocumentUrl: text("id_document_url"),
  proofOfAddressUrl: text("proof_of_address_url"),
  bankStatementUrl: text("bank_statement_url"),
  bankName: varchar("bank_name", { length: 200 }),
  accountNumber: varchar("account_number", { length: 30 }),
  kycStatus: traderKycStatusEnum("kyc_status").default("PENDING").notNull(),
  kycNotes: text("kyc_notes"),
  accountStatus: traderAccountStatusEnum("account_status").default("INACTIVE").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export type TraderProfile = typeof traderProfiles.$inferSelect;

// ─── Broker Profiles ──────────────────────────────────────────────────────────
export const brokerKycStatusEnum = pgEnum("broker_kyc_status", ["PENDING", "UNDER_REVIEW", "APPROVED", "REJECTED"]);
export const brokerAccountStatusEnum = pgEnum("broker_account_status", ["INACTIVE", "ACTIVE", "SUSPENDED"]);

export const brokerProfiles = pgTable("broker_profiles", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  userId: integer("user_id").notNull().unique(),
  firmName: varchar("firm_name", { length: 200 }).notNull(),
  rcNumber: varchar("rc_number", { length: 50 }),
  secLicenseNumber: varchar("sec_license_number", { length: 100 }),
  cbnLicenseNumber: varchar("cbn_license_number", { length: 100 }),
  regulatoryBody: varchar("regulatory_body", { length: 100 }),
  contactPhone: varchar("contact_phone", { length: 30 }),
  contactEmail: varchar("contact_email", { length: 200 }),
  firmAddress: text("firm_address"),
  state: varchar("state", { length: 100 }),
  yearsInOperation: integer("years_in_operation"),
  clientBookSize: varchar("client_book_size", { length: 50 }),
  commissionRate: numeric("commission_rate", { precision: 6, scale: 4 }),
  secCertificateUrl: text("sec_certificate_url"),
  cbnApprovalUrl: text("cbn_approval_url"),
  cacDocUrl: text("cac_doc_url"),
  kycStatus: brokerKycStatusEnum("kyc_status").default("PENDING").notNull(),
  kycNotes: text("kyc_notes"),
  accountStatus: brokerAccountStatusEnum("account_status").default("INACTIVE").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export type BrokerProfile = typeof brokerProfiles.$inferSelect;

// ─── Warehouse Operator Profiles ──────────────────────────────────────────────
export const warehouseOpKycStatusEnum = pgEnum("warehouse_op_kyc_status", ["PENDING", "UNDER_REVIEW", "APPROVED", "REJECTED"]);
export const warehouseOpAccountStatusEnum = pgEnum("warehouse_op_account_status", ["INACTIVE", "ACTIVE", "SUSPENDED"]);

export const warehouseOperatorProfiles = pgTable("warehouse_operator_profiles", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  userId: integer("user_id").notNull().unique(),
  facilityName: varchar("facility_name", { length: 200 }).notNull(),
  facilityAddress: text("facility_address").notNull(),
  state: varchar("state", { length: 100 }).notNull(),
  lga: varchar("lga", { length: 100 }),
  gpsLat: numeric("gps_lat", { precision: 10, scale: 7 }),
  gpsLng: numeric("gps_lng", { precision: 10, scale: 7 }),
  storageCapacityMt: numeric("storage_capacity_mt", { precision: 12, scale: 2 }),
  commoditiesHandled: text("commodities_handled").array(),
  nwrCertNumber: varchar("nwr_cert_number", { length: 100 }),
  nwrCertDocUrl: text("nwr_cert_doc_url"),
  facilityInspectionUrl: text("facility_inspection_url"),
  insuranceDocUrl: text("insurance_doc_url"),
  gradingStaffCount: integer("grading_staff_count"),
  operatingHours: varchar("operating_hours", { length: 100 }),
  acceptedGrades: text("accepted_grades").array(),
  kycStatus: warehouseOpKycStatusEnum("kyc_status").default("PENDING").notNull(),
  kycNotes: text("kyc_notes"),
  accountStatus: warehouseOpAccountStatusEnum("account_status").default("INACTIVE").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export type WarehouseOperatorProfile = typeof warehouseOperatorProfiles.$inferSelect;

// ─── Market Maker Onboarding Profiles ─────────────────────────────────────────
export const mmOnboardingKycStatusEnum = pgEnum("mm_onboarding_kyc_status", ["PENDING", "UNDER_REVIEW", "APPROVED", "REJECTED"]);
export const mmOnboardingAccountStatusEnum = pgEnum("mm_onboarding_account_status", ["INACTIVE", "ACTIVE", "SUSPENDED"]);

export const marketMakerOnboardingProfiles = pgTable("market_maker_onboarding_profiles", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  userId: integer("user_id").notNull().unique(),
  firmName: varchar("firm_name", { length: 200 }).notNull(),
  tradingDesk: varchar("trading_desk", { length: 200 }),
  contactPhone: varchar("contact_phone", { length: 30 }),
  contactEmail: varchar("contact_email", { length: 200 }),
  yearsOfOperation: integer("years_of_operation"),
  regulatoryRegistrations: text("regulatory_registrations"),
  instrumentObligations: text("instrument_obligations").array(),
  minQuoteSizeLots: numeric("min_quote_size_lots", { precision: 12, scale: 2 }),
  maxSpreadBps: numeric("max_spread_bps", { precision: 8, scale: 2 }),
  capitalCommitmentNgn: numeric("capital_commitment_ngn", { precision: 18, scale: 2 }),
  performanceBondNgn: numeric("performance_bond_ngn", { precision: 18, scale: 2 }),
  firmRegistrationUrl: text("firm_registration_url"),
  tradingLicenseUrl: text("trading_license_url"),
  capitalAdequacyUrl: text("capital_adequacy_url"),
  kycStatus: mmOnboardingKycStatusEnum("kyc_status").default("PENDING").notNull(),
  kycNotes: text("kyc_notes"),
  accountStatus: mmOnboardingAccountStatusEnum("account_status").default("INACTIVE").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export type MarketMakerOnboardingProfile = typeof marketMakerOnboardingProfiles.$inferSelect;

// ============================================================
// KYC Audit Log
// ============================================================
export const kycAuditDecisionEnum = pgEnum("kyc_audit_decision", ["APPROVED", "REJECTED", "RESET", "UNDER_REVIEW"]);
export const kycAuditStakeholderEnum = pgEnum("kyc_audit_stakeholder", ["FARMER", "TRADER", "BROKER", "WAREHOUSE_OPERATOR", "MARKET_MAKER"]);

export const kycAuditLog = pgTable("kyc_audit_log", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  stakeholderType: kycAuditStakeholderEnum("stakeholder_type").notNull(),
  profileId: integer("profile_id").notNull(),
  reviewerId: integer("reviewer_id").notNull(),
  reviewerName: text("reviewer_name"),
  decision: kycAuditDecisionEnum("decision").notNull(),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export type KycAuditLog = typeof kycAuditLog.$inferSelect;
export type InsertKycAuditLog = typeof kycAuditLog.$inferInsert;

// ============================================================
// KYC Document Analysis Results (PaddleOCR + VLM + Docling microservice)
// ============================================================
export const kycRiskLevelEnum = pgEnum("kyc_risk_level", ["LOW", "MEDIUM", "HIGH", "CRITICAL", "UNKNOWN"]);

export const kycAnalysisResults = pgTable("kyc_analysis_results", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  userId: integer("user_id").notNull(),
  stakeholderType: text("stakeholder_type").notNull(),
  documentUrl: text("document_url").notNull(),
  selfieUrl: text("selfie_url"),
  isPdf: boolean("is_pdf").default(false),
  ocrExtractedFields: text("ocr_extracted_fields"),
  ocrAvgConfidence: real("ocr_avg_confidence"),
  ocrLineCount: integer("ocr_line_count"),
  documentAuthenticityScore: real("document_authenticity_score"),
  documentType: text("document_type"),
  documentRiskFlags: text("document_risk_flags"),
  selfieOverallScore: real("selfie_overall_score"),
  selfielivenessAssessment: text("selfie_liveness_assessment"),
  passiveLivenessScore: real("passive_liveness_score"),
  passiveLivenessFlags: text("passive_liveness_flags"),
  overallScore: real("overall_score"),
  overallRiskLevel: kycRiskLevelEnum("overall_risk_level").default("UNKNOWN"),
  allRiskFlags: text("all_risk_flags"),
  recommendation: text("recommendation"),
  analysedAt: timestamp("analysed_at").defaultNow().notNull(),
  serviceVersion: text("service_version").default("1.0.0"),
});

export type KycAnalysisResult = typeof kycAnalysisResults.$inferSelect;
export type InsertKycAnalysisResult = typeof kycAnalysisResults.$inferInsert;

// ─── Bulk Listing Dual-Authorisation ──────────────────────────────────────────
export const bulkListingApprovalStatusEnum = pgEnum("bulk_listing_approval_status", [
  "PENDING",
  "COUNTERSIGNED",
  "REJECTED",
  "EXPIRED",
]);

export const bulkListingApprovals = pgTable("bulk_listing_approvals", {
  id: serial("id").primaryKey(),
  uploadId: integer("upload_id").notNull(),
  cooperativeUserId: integer("cooperative_user_id").notNull(),
  counterSignerId: integer("counter_signer_id"),
  status: bulkListingApprovalStatusEnum("status").default("PENDING").notNull(),
  memberCount: integer("member_count").notNull().default(0),
  cropType: text("crop_type").notNull(),
  totalQuantityKg: integer("total_quantity_kg").notNull().default(0),
  pricePerKg: integer("price_per_kg").notNull().default(0),
  harvestDate: timestamp("harvest_date"),
  description: text("description"),
  initiatorNotes: text("initiator_notes"),
  counterSignerNotes: text("counter_signer_notes"),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export type BulkListingApproval = typeof bulkListingApprovals.$inferSelect;
export type InsertBulkListingApproval = typeof bulkListingApprovals.$inferInsert;

// ─── Periodic Re-KYC Flags ────────────────────────────────────────────────────
export const reKycStakeholderTypeEnum = pgEnum("re_kyc_stakeholder_type", [
  "FARMER", "TRADER", "BROKER", "WAREHOUSE_OPERATOR", "MARKET_MAKER",
]);

export const reKycFlags = pgTable("re_kyc_flags", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  stakeholderType: reKycStakeholderTypeEnum("stakeholder_type").notNull(),
  profileId: integer("profile_id").notNull(),
  reason: text("reason").notNull(),
  kycApprovedAt: timestamp("kyc_approved_at"),
  notifiedAt: timestamp("notified_at"),
  resolvedAt: timestamp("resolved_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export type ReKycFlag = typeof reKycFlags.$inferSelect;
export type InsertReKycFlag = typeof reKycFlags.$inferInsert;

// ─── Live Price Feed ──────────────────────────────────────────────────────────
export const livePrices = pgTable("live_prices", {
  id: serial("id").primaryKey(),
  symbol: varchar("symbol", { length: 64 }).notNull().unique(),
  name: varchar("name", { length: 128 }).notNull(),
  price: numeric("price", { precision: 18, scale: 6 }).notNull(),
  previousClose: numeric("previous_close", { precision: 18, scale: 6 }),
  change: numeric("change_amount", { precision: 18, scale: 6 }),
  changePct: numeric("change_pct", { precision: 10, scale: 4 }),
  high: numeric("high", { precision: 18, scale: 6 }),
  low: numeric("low", { precision: 18, scale: 6 }),
  currency: varchar("currency", { length: 8 }).notNull().default("USD"),
  source: varchar("source", { length: 32 }).notNull().default("yahoo"),
  yahooSymbol: varchar("yahoo_symbol", { length: 32 }),
  assetClass: varchar("asset_class", { length: 32 }).notNull().default("COMMODITY"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export type LivePrice = typeof livePrices.$inferSelect;
export type InsertLivePrice = typeof livePrices.$inferInsert;

// ─── Broker / Market Maker Performance Metrics ───────────────────────────────
export const participantPerformanceMetrics = pgTable("participant_performance_metrics", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  participantType: varchar("participant_type", { length: 32 }).notNull(),
  periodYear: integer("period_year").notNull(),
  periodMonth: integer("period_month").notNull(),
  tradeCount: integer("trade_count").notNull().default(0),
  volumeUsd: numeric("volume_usd", { precision: 20, scale: 2 }).notNull().default("0"),
  clientCount: integer("client_count").notNull().default(0),
  avgSpread: numeric("avg_spread", { precision: 10, scale: 4 }),
  uptimePct: numeric("uptime_pct", { precision: 5, scale: 2 }),
  rating: numeric("rating", { precision: 3, scale: 2 }),
  complianceScore: integer("compliance_score").default(100),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export type ParticipantPerformanceMetric = typeof participantPerformanceMetrics.$inferSelect;
export type InsertParticipantPerformanceMetric = typeof participantPerformanceMetrics.$inferInsert;

// ─── Corporate Actions ────────────────────────────────────────────────────────
export const corporateActionTypeEnum = pgEnum("corporate_action_type", [
  "DIVIDEND", "STOCK_SPLIT", "RIGHTS_ISSUE", "BONUS_ISSUE", "MERGER", "DELISTING", "IPO",
]);
export const corporateActionStatusEnum = pgEnum("corporate_action_status", [
  "DRAFT", "PENDING_APPROVAL", "APPROVED", "REJECTED", "CANCELLED", "COMPLETED",
]);
export const corporateActions = pgTable("corporate_actions", {
  id: serial("id").primaryKey(),
  actionType: corporateActionTypeEnum("action_type").notNull(),
  status: corporateActionStatusEnum("status").notNull().default("DRAFT"),
  symbol: varchar("symbol", { length: 64 }).notNull(),
  title: varchar("title", { length: 256 }).notNull(),
  description: text("description"),
  exDate: timestamp("ex_date"),
  recordDate: timestamp("record_date"),
  paymentDate: timestamp("payment_date"),
  announcementDate: timestamp("announcement_date"),
  dividendAmount: numeric("dividend_amount", { precision: 18, scale: 6 }),
  dividendCurrency: varchar("dividend_currency", { length: 8 }),
  splitRatioFrom: integer("split_ratio_from"),
  splitRatioTo: integer("split_ratio_to"),
  rightsPrice: numeric("rights_price", { precision: 18, scale: 6 }),
  rightsRatio: varchar("rights_ratio", { length: 32 }),
  ipoPrice: numeric("ipo_price", { precision: 18, scale: 6 }),
  ipoShares: bigint("ipo_shares", { mode: "number" }),
  submittedBy: integer("submitted_by").notNull(),
  reviewedBy: integer("reviewed_by"),
  reviewNotes: text("review_notes"),
  submittedAt: timestamp("submitted_at").defaultNow().notNull(),
  reviewedAt: timestamp("reviewed_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export type CorporateAction = typeof corporateActions.$inferSelect;
export type InsertCorporateAction = typeof corporateActions.$inferInsert;

// ─── Matching Engine: Trade Fills ─────────────────────────────────────────────
// Records every individual fill event produced by the matching engine.
// A single order can generate multiple fills (partial fills against different
// resting orders). The fills table is the canonical audit trail for all matched trades.
export const tradeFills = pgTable("trade_fills", {
  id:                bigserial("id", { mode: "number" }).primaryKey(),
  aggressorOrderId:  bigint("aggressor_order_id", { mode: "number" }).notNull(),
  restingOrderId:    bigint("resting_order_id", { mode: "number" }).notNull(),
  symbol:            varchar("symbol", { length: 32 }).notNull(),
  assetClass:        varchar("asset_class", { length: 32 }).notNull(),
  buyerUserId:       integer("buyer_user_id").notNull(),
  sellerUserId:      integer("seller_user_id").notNull(),
  filledQty:         numeric("filled_qty", { precision: 18, scale: 6 }).notNull(),
  fillPrice:         numeric("fill_price", { precision: 18, scale: 6 }).notNull(),
  grossValue:        numeric("gross_value", { precision: 18, scale: 6 }).notNull(),
  buyerFee:          numeric("buyer_fee", { precision: 18, scale: 6 }).notNull().default("0"),
  sellerFee:         numeric("seller_fee", { precision: 18, scale: 6 }).notNull().default("0"),
  settlementId:      bigint("settlement_id", { mode: "number" }),
  sequenceNo:        bigint("sequence_no", { mode: "number" }).notNull().default(0),
  createdAt:         timestamp("created_at").defaultNow().notNull(),
});
export type TradeFill = typeof tradeFills.$inferSelect;
export type InsertTradeFill = typeof tradeFills.$inferInsert;

// ─── Matching Engine: Persistent Order Book Levels ───────────────────────────
export const orderBookLevels = pgTable("order_book_levels", {
  id:          serial("id").primaryKey(),
  symbol:      varchar("symbol", { length: 32 }).notNull(),
  side:        varchar("side", { length: 4 }).notNull(),
  price:       numeric("price", { precision: 18, scale: 6 }).notNull(),
  quantity:    numeric("quantity", { precision: 18, scale: 6 }).notNull(),
  orderCount:  integer("order_count").notNull().default(1),
  updatedAt:   timestamp("updated_at").defaultNow().notNull(),
});
export type OrderBookLevel = typeof orderBookLevels.$inferSelect;
export type InsertOrderBookLevel = typeof orderBookLevels.$inferInsert;

// ─── Pre-Trade Risk Check Log ─────────────────────────────────────────────────
export const preTradRiskChecks = pgTable("pre_trade_risk_checks", {
  id:               serial("id").primaryKey(),
  orderId:          bigint("order_id", { mode: "number" }).notNull(),
  userId:           integer("user_id").notNull(),
  symbol:           varchar("symbol", { length: 32 }).notNull(),
  checkType:        varchar("check_type", { length: 32 }).notNull(),
  passed:           boolean("passed").notNull(),
  requiredMargin:   numeric("required_margin", { precision: 18, scale: 6 }),
  availableMargin:  numeric("available_margin", { precision: 18, scale: 6 }),
  currentPosition:  numeric("current_position", { precision: 18, scale: 6 }),
  positionLimit:    numeric("position_limit", { precision: 18, scale: 6 }),
  rejectReason:     text("reject_reason"),
  createdAt:        timestamp("created_at").defaultNow().notNull(),
});
export type PreTradeRiskCheck = typeof preTradRiskChecks.$inferSelect;

export const dfspTierEnum = pgEnum("dfsp_tier", ["STANDARD", "PREMIUM", "INSTITUTIONAL", "CORRESPONDENT"]);

// ─── Mojaloop DFSP Integration ────────────────────────────────────────────────
// Tables for Mojaloop interoperable payment settlement.
// NEXCOM acts as a DFSP (Digital Financial Service Provider) on the Mojaloop hub.
// Supports FSPIOP API v1.1 for cross-DFSP transfers (USD, EUR, GBP, NGN, KES, GHS, ZAR).

export const mojaloopTransferStatusEnum = pgEnum("mojaloop_transfer_status", [
  "PENDING", "RESERVED", "COMMITTED", "ABORTED", "EXPIRED",
]);

export const mojaloopQuoteStatusEnum = pgEnum("mojaloop_quote_status", [
  "PENDING", "ACCEPTED", "REJECTED", "EXPIRED",
]);

// Mojaloop parties — registered DFSPs and their account holders
export const mojaloopParties = pgTable("mojaloop_parties", {
  id:                serial("id").primaryKey(),
  partyIdType:       varchar("party_id_type", { length: 32 }).notNull(),
  partyIdentifier:   varchar("party_identifier", { length: 128 }).notNull(),
  fspId:             varchar("fsp_id", { length: 64 }).notNull(),
  firstName:         varchar("first_name", { length: 128 }),
  lastName:          varchar("last_name", { length: 128 }),
  dateOfBirth:       varchar("date_of_birth", { length: 16 }),
  merchantClassCode: varchar("merchant_class_code", { length: 16 }),
  currency:          varchar("currency", { length: 8 }).notNull().default("USD"),
  supportedCurrencies: json("supported_currencies").$type<string[]>().default([]),
  isActive:          boolean("is_active").notNull().default(true),
  createdAt:         timestamp("created_at").defaultNow().notNull(),
  updatedAt:         timestamp("updated_at").defaultNow().notNull(),
});
export type MojaloopParty = typeof mojaloopParties.$inferSelect;
export type InsertMojaloopParty = typeof mojaloopParties.$inferInsert;

// Mojaloop quotes — pre-transfer fee and terms negotiation
export const mojaloopQuotes = pgTable("mojaloop_quotes", {
  id:                  serial("id").primaryKey(),
  quoteId:             varchar("quote_id", { length: 64 }).notNull().unique(),
  transactionId:       varchar("transaction_id", { length: 64 }).notNull(),
  payerFspId:          varchar("payer_fsp_id", { length: 64 }).notNull(),
  payeeFspId:          varchar("payee_fsp_id", { length: 64 }).notNull(),
  payerIdentifier:     varchar("payer_identifier", { length: 128 }).notNull(),
  payeeIdentifier:     varchar("payee_identifier", { length: 128 }).notNull(),
  amountType:          varchar("amount_type", { length: 16 }).notNull().default("SEND"),
  amount:              numeric("amount", { precision: 18, scale: 6 }).notNull(),
  currency:            varchar("currency", { length: 8 }).notNull(),
  feeAmount:           numeric("fee_amount", { precision: 18, scale: 6 }).default("0"),
  feeCurrency:         varchar("fee_currency", { length: 8 }),
  transferAmount:      numeric("transfer_amount", { precision: 18, scale: 6 }),
  ilpPacket:           text("ilp_packet"),
  condition:           varchar("condition", { length: 256 }),
  expiration:          timestamp("expiration"),
  status:              mojaloopQuoteStatusEnum("status").notNull().default("PENDING"),
  rejectReason:        text("reject_reason"),
  nexcomSettlementId:  integer("nexcom_settlement_id"),
  createdAt:           timestamp("created_at").defaultNow().notNull(),
  updatedAt:           timestamp("updated_at").defaultNow().notNull(),
});
export type MojaloopQuote = typeof mojaloopQuotes.$inferSelect;
export type InsertMojaloopQuote = typeof mojaloopQuotes.$inferInsert;

// Mojaloop transfers — actual FSPIOP transfer lifecycle
export const mojaloopTransfers = pgTable("mojaloop_transfers", {
  id:                  serial("id").primaryKey(),
  transferId:          varchar("transfer_id", { length: 64 }).notNull().unique(),
  quoteId:             varchar("quote_id", { length: 64 }),
  payerFspId:          varchar("payer_fsp_id", { length: 64 }).notNull(),
  payeeFspId:          varchar("payee_fsp_id", { length: 64 }).notNull(),
  payerIdentifier:     varchar("payer_identifier", { length: 128 }).notNull(),
  payeeIdentifier:     varchar("payee_identifier", { length: 128 }).notNull(),
  amount:              numeric("amount", { precision: 18, scale: 6 }).notNull(),
  currency:            varchar("currency", { length: 8 }).notNull(),
  ilpPacket:           text("ilp_packet"),
  condition:           varchar("condition", { length: 256 }),
  fulfilment:          varchar("fulfilment", { length: 256 }),
  expiration:          timestamp("expiration"),
  status:              mojaloopTransferStatusEnum("status").notNull().default("PENDING"),
  errorCode:           varchar("error_code", { length: 8 }),
  errorDescription:    text("error_description"),
  nexcomSettlementId:  integer("nexcom_settlement_id"),
  nexcomOrderId:       integer("nexcom_order_id"),
  reservedAt:          timestamp("reserved_at"),
  committedAt:         timestamp("committed_at"),
  abortedAt:           timestamp("aborted_at"),
  createdAt:           timestamp("created_at").defaultNow().notNull(),
  updatedAt:           timestamp("updated_at").defaultNow().notNull(),
});
export type MojaloopTransfer = typeof mojaloopTransfers.$inferSelect;
export type InsertMojaloopTransfer = typeof mojaloopTransfers.$inferInsert;

// Mojaloop callbacks — inbound FSPIOP callback events from the hub
export const mojaloopCallbacks = pgTable("mojaloop_callbacks", {
  id:            serial("id").primaryKey(),
  callbackType:  varchar("callback_type", { length: 64 }).notNull(),
  resourceId:    varchar("resource_id", { length: 64 }).notNull(),
  sourceFspId:   varchar("source_fsp_id", { length: 64 }),
  payload:       json("payload").notNull(),
  httpStatus:    integer("http_status").notNull().default(200),
  processed:     boolean("processed").notNull().default(false),
  processedAt:   timestamp("processed_at"),
  errorMessage:  text("error_message"),
  createdAt:     timestamp("created_at").defaultNow().notNull(),
});
export type MojaloopCallback = typeof mojaloopCallbacks.$inferSelect;
export type InsertMojaloopCallback = typeof mojaloopCallbacks.$inferInsert;

// Mojaloop DFSP registry — known DFSPs connected to the hub
export const mojaloopDfsps = pgTable("mojaloop_dfsps", {
  id:          serial("id").primaryKey(),
  fspId:       varchar("fsp_id", { length: 64 }).notNull().unique(),
  name:        varchar("name", { length: 128 }).notNull(),
  country:     varchar("country", { length: 4 }),
  currencies:  json("currencies").$type<string[]>().default([]),
  isActive:    boolean("is_active").notNull().default(true),
  endpointUrl: varchar("endpoint_url", { length: 256 }),
  callbackUrl: varchar("callback_url", { length: 256 }),
  tier:        dfspTierEnum("tier").default("STANDARD"),
  status:      varchar("status", { length: 32 }).default("ACTIVE"),
  currency:    varchar("currency", { length: 8 }).default("NGN"),
  createdAt:   timestamp("created_at").defaultNow().notNull(),
  updatedAt:   timestamp("updated_at").defaultNow().notNull(),
});
export type MojaloopDfsp = typeof mojaloopDfsps.$inferSelect;
export type InsertMojaloopDfsp = typeof mojaloopDfsps.$inferInsert;

// Mojaloop Dead-Letter Queue — failed settlement reconciliation events awaiting retry
export const mojaloopDeadLetter = pgTable("mojaloop_dead_letter", {
  id:               serial("id").primaryKey(),
  transferId:       varchar("transfer_id", { length: 64 }).notNull(),
  payerFspId:       varchar("payer_fsp_id", { length: 64 }).notNull(),
  payeeFspId:       varchar("payee_fsp_id", { length: 64 }).notNull(),
  payerIdentifier:  varchar("payer_identifier", { length: 128 }).notNull(),
  payeeIdentifier:  varchar("payee_identifier", { length: 128 }).notNull(),
  amount:           numeric("amount", { precision: 18, scale: 6 }).notNull(),
  currency:         varchar("currency", { length: 8 }).notNull(),
  status:           varchar("status", { length: 32 }).notNull().default("FAILED"),
  errorMessage:     text("error_message"),
  retryCount:       integer("retry_count").notNull().default(0),
  lastRetryAt:      timestamp("last_retry_at"),
  resolved:         boolean("resolved").notNull().default(false),
  resolvedAt:       timestamp("resolved_at"),
  resolvedBy:       varchar("resolved_by", { length: 128 }),
  rawPayload:       json("raw_payload"),
  createdAt:        timestamp("created_at").defaultNow().notNull(),
  updatedAt:        timestamp("updated_at").defaultNow().notNull(),
});
export type MojaloopDeadLetterEntry = typeof mojaloopDeadLetter.$inferSelect;
export type InsertMojaloopDeadLetterEntry = typeof mojaloopDeadLetter.$inferInsert;

// ─── DFSP Tier Management ─────────────────────────────────────────────────────
// Tiers define fee schedules and transfer limits for DFSPs.
// Each DFSP is assigned a tier; fee calculation uses the tier's schedule.

export const dfspTiers = pgTable("dfsp_tiers", {
  id:                  serial("id").primaryKey(),
  name:                dfspTierEnum("name").notNull().unique(),
  displayName:         varchar("display_name", { length: 64 }).notNull(),
  description:         text("description"),
  dailyLimitAmount:    numeric("daily_limit_amount", { precision: 18, scale: 2 }).notNull().default("1000000"),
  dailyLimitCurrency:  varchar("daily_limit_currency", { length: 8 }).notNull().default("NGN"),
  minTransferAmount:   numeric("min_transfer_amount", { precision: 18, scale: 2 }).notNull().default("100"),
  maxTransferAmount:   numeric("max_transfer_amount", { precision: 18, scale: 2 }).notNull().default("5000000"),
  allowedCurrencies:   varchar("allowed_currencies", { length: 256 }).notNull().default("NGN"),
  settlementWindowHrs: integer("settlement_window_hrs").notNull().default(24),
  isActive:            boolean("is_active").notNull().default(true),
  createdAt:           timestamp("created_at").defaultNow().notNull(),
  updatedAt:           timestamp("updated_at").defaultNow().notNull(),
});
export type DfspTier = typeof dfspTiers.$inferSelect;
export type InsertDfspTier = typeof dfspTiers.$inferInsert;

// Fee schedules: flat fee + percentage per tier + currency combination
export const mojaloopFeeSchedules = pgTable("mojaloop_fee_schedules", {
  id:            serial("id").primaryKey(),
  tierName:      dfspTierEnum("tier_name").notNull(),
  currency:      varchar("currency", { length: 8 }).notNull(),
  flatFee:       numeric("flat_fee", { precision: 18, scale: 6 }).notNull().default("0"),
  percentageFee: numeric("percentage_fee", { precision: 8, scale: 4 }).notNull().default("0"),
  minFee:        numeric("min_fee", { precision: 18, scale: 6 }).notNull().default("0"),
  maxFee:        numeric("max_fee", { precision: 18, scale: 6 }),
  effectiveFrom: timestamp("effective_from").defaultNow().notNull(),
  effectiveTo:   timestamp("effective_to"),
  isActive:      boolean("is_active").notNull().default(true),
  createdAt:     timestamp("created_at").defaultNow().notNull(),
  updatedAt:     timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  tierCurrencyIdx: uniqueIndex("fee_schedule_tier_currency_idx").on(t.tierName, t.currency),
}));
export type MojaloopFeeSchedule = typeof mojaloopFeeSchedules.$inferSelect;
export type InsertMojaloopFeeSchedule = typeof mojaloopFeeSchedules.$inferInsert;

// ─── DFSP KYC / AML Records ───────────────────────────────────────────────────
// Stores KYC/AML compliance data submitted during DFSP onboarding.
// Compliance officers review and approve/reject applications from the admin panel.
export const dfspKycStatusEnum = pgEnum("dfsp_kyc_status", ["PENDING", "APPROVED", "REJECTED", "EDD_REQUIRED"]);

export const dfspKycRecords = pgTable("dfsp_kyc_records", {
  id:                        serial("id").primaryKey(),
  fspId:                     varchar("fsp_id", { length: 64 }).notNull().unique(),
  // Legal entity
  legalEntityName:           varchar("legal_entity_name", { length: 256 }).notNull(),
  registrationNumber:        varchar("registration_number", { length: 128 }).notNull(),
  taxId:                     varchar("tax_id", { length: 64 }),
  regulatoryBody:            varchar("regulatory_body", { length: 128 }).notNull(),
  licenseNumber:             varchar("license_number", { length: 128 }).notNull(),
  // AML risk
  amlRiskLevel:              varchar("aml_risk_level", { length: 16 }).notNull().default("LOW"),
  pepExposure:               boolean("pep_exposure").notNull().default(false),
  sanctionsScreeningPassed:  boolean("sanctions_screening_passed").notNull().default(false),
  beneficialOwners:          text("beneficial_owners").notNull(),
  // Compliance officer
  complianceOfficerName:     varchar("compliance_officer_name", { length: 256 }).notNull(),
  complianceOfficerEmail:    varchar("compliance_officer_email", { length: 256 }).notNull(),
  // Documents & acknowledgements
  documentsProvided:         json("documents_provided").$type<string[]>().notNull().default([]),
  acknowledgedAmlPolicy:     boolean("acknowledged_aml_policy").notNull().default(false),
  acknowledgedDataProcessing: boolean("acknowledged_data_processing").notNull().default(false),
  // Review workflow
  status:                    dfspKycStatusEnum("status").notNull().default("PENDING"),
  reviewedBy:                varchar("reviewed_by", { length: 128 }),
  reviewedAt:                timestamp("reviewed_at"),
  reviewNotes:               text("review_notes"),
  createdAt:                 timestamp("created_at").defaultNow().notNull(),
  updatedAt:                 timestamp("updated_at").defaultNow().notNull(),
});
export type DfspKycRecord = typeof dfspKycRecords.$inferSelect;
export type InsertDfspKycRecord = typeof dfspKycRecords.$inferInsert;

// ─── Phase 40: FIDO2 / WebAuthn Passkeys & MFA ────────────────────────────────

export const mfaMethodEnum = pgEnum("mfa_method", [
  "totp",
  "webauthn",
  "sms",
  "email_otp",
]);

// Stores registered FIDO2/WebAuthn authenticators (passkeys) per user.
export const webauthnCredentials = pgTable("webauthn_credentials", {
  id:             bigserial("id", { mode: "number" }).primaryKey(),
  userId:         integer("user_id").notNull(),
  credentialId:   text("credential_id").notNull().unique(),
  publicKey:      text("public_key").notNull(),
  signCount:      integer("sign_count").notNull().default(0),
  deviceName:     varchar("device_name", { length: 128 }).notNull().default("Passkey"),
  aaguid:         varchar("aaguid", { length: 36 }),
  uvCapable:      boolean("uv_capable").notNull().default(false),
  residentKey:    boolean("resident_key").notNull().default(false),
  transports:     text("transports"),
  lastUsedAt:     timestamp("last_used_at"),
  createdAt:      timestamp("created_at").defaultNow().notNull(),
});
export type WebauthnCredential = typeof webauthnCredentials.$inferSelect;
export type InsertWebauthnCredential = typeof webauthnCredentials.$inferInsert;

// Ephemeral challenge records for WebAuthn registration and authentication.
export const webauthnChallenges = pgTable("webauthn_challenges", {
  id:        bigserial("id", { mode: "number" }).primaryKey(),
  userId:    integer("user_id"),
  challenge: text("challenge").notNull(),
  type:      varchar("type", { length: 16 }).notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export type WebauthnChallenge = typeof webauthnChallenges.$inferSelect;

// Per-user MFA policy.
export const userMfaSettings = pgTable("user_mfa_settings", {
  id:              bigserial("id", { mode: "number" }).primaryKey(),
  userId:          integer("user_id").notNull().unique(),
  mfaRequired:     boolean("mfa_required").notNull().default(false),
  primaryMethod:   mfaMethodEnum("primary_method"),
  totpEnabled:     boolean("totp_enabled").notNull().default(false),
  webauthnEnabled: boolean("webauthn_enabled").notNull().default(false),
  smsEnabled:      boolean("sms_enabled").notNull().default(false),
  emailOtpEnabled: boolean("email_otp_enabled").notNull().default(false),
  phoneNumber:     varchar("phone_number", { length: 20 }),
  updatedAt:       timestamp("updated_at").defaultNow().notNull(),
});
export type UserMfaSettings = typeof userMfaSettings.$inferSelect;

// Short-lived OTP codes for SMS and email-based MFA.
export const mfaOtpCodes = pgTable("mfa_otp_codes", {
  id:        bigserial("id", { mode: "number" }).primaryKey(),
  userId:    integer("user_id").notNull(),
  method:    mfaMethodEnum("method").notNull(),
  codeHash:  varchar("code_hash", { length: 64 }).notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  usedAt:    timestamp("used_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export type MfaOtpCode = typeof mfaOtpCodes.$inferSelect;

// ─── Broker Clients ────────────────────────────────────────────────────────────
export const brokerClientStatusEnum = pgEnum("broker_client_status", ["ACTIVE", "INACTIVE", "SUSPENDED"]);

export const brokerClients = pgTable("broker_clients", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  brokerProfileId: integer("broker_profile_id").notNull(),
  clientUserId: integer("client_user_id").notNull(),
  clientName: varchar("client_name", { length: 200 }),
  clientEmail: varchar("client_email", { length: 200 }),
  clientPhone: varchar("client_phone", { length: 30 }),
  accountType: varchar("account_type", { length: 50 }).default("INDIVIDUAL"),
  status: brokerClientStatusEnum("status").default("ACTIVE").notNull(),
  onboardedAt: timestamp("onboarded_at").defaultNow().notNull(),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export type BrokerClient = typeof brokerClients.$inferSelect;

// ─── Broker Commissions ────────────────────────────────────────────────────────
export const brokerCommissionStatusEnum = pgEnum("broker_commission_status", ["PENDING", "PAID", "CANCELLED"]);

export const brokerCommissions = pgTable("broker_commissions", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  brokerProfileId: integer("broker_profile_id").notNull(),
  clientUserId: integer("client_user_id"),
  orderId: bigint("order_id", { mode: "number" }),
  fillId: bigint("fill_id", { mode: "number" }),
  symbol: varchar("symbol", { length: 32 }).notNull(),
  side: varchar("side", { length: 4 }).notNull(),
  filledQty: numeric("filled_qty", { precision: 18, scale: 6 }).notNull(),
  fillPrice: numeric("fill_price", { precision: 18, scale: 6 }).notNull(),
  tradeValue: numeric("trade_value", { precision: 18, scale: 6 }).notNull(),
  commissionRate: numeric("commission_rate", { precision: 6, scale: 4 }).notNull(),
  commissionAmount: numeric("commission_amount", { precision: 18, scale: 6 }).notNull(),
  currency: varchar("currency", { length: 10 }).default("NGN").notNull(),
  status: brokerCommissionStatusEnum("status").default("PENDING").notNull(),
  paidAt: timestamp("paid_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export type BrokerCommission = typeof brokerCommissions.$inferSelect;

// ─── Push Notification Subscriptions ──────────────────────────────────────────
// Stores Web Push API PushSubscription objects so the server can push
// price alerts, trade fills, and system notifications to subscribed devices.
export const pushSubscriptions = pgTable("push_subscriptions", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  userId: integer("user_id").notNull(),
  // The endpoint URL provided by the browser's push service
  endpoint: text("endpoint").notNull().unique(),
  // VAPID keys — p256dh and auth are base64url-encoded strings from the browser
  p256dh: text("p256dh").notNull(),
  auth: text("auth").notNull(),
  // Notification topic preferences
  enablePriceAlerts: boolean("enable_price_alerts").default(true).notNull(),
  enableTradeFills: boolean("enable_trade_fills").default(true).notNull(),
  enableSystemAlerts: boolean("enable_system_alerts").default(false).notNull(),
  // Device info (optional, for display in settings)
  userAgent: text("user_agent"),
  deviceLabel: varchar("device_label", { length: 100 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export type PushSubscriptionRow = typeof pushSubscriptions.$inferSelect;

// ─── Warehouse Messages ────────────────────────────────────────────────────────
// Stores in-app messages sent by users to warehouse operators.
// Replaces the mailto: fallback with a persistent, auditable on-platform channel.
export const warehouseMessageStatusEnum = pgEnum("warehouse_message_status", [
  "SENT", "READ", "REPLIED", "CLOSED",
]);

export const warehouseMessages = pgTable("warehouse_messages", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  userId: integer("user_id").notNull(),
  warehouseId: varchar("warehouse_id", { length: 50 }).notNull(),
  warehouseName: varchar("warehouse_name", { length: 200 }).notNull(),
  subject: varchar("subject", { length: 300 }).notNull(),
  body: text("body").notNull(),
  status: warehouseMessageStatusEnum("status").default("SENT").notNull(),
  replyBody: text("reply_body"),
  repliedAt: timestamp("replied_at"),
  readAt: timestamp("read_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export type WarehouseMessage = typeof warehouseMessages.$inferSelect;


// ═══════════════════════════════════════════════════════════════════════════════
// PHASE 1 — FIXED INCOME BOARD
// ═══════════════════════════════════════════════════════════════════════════════

export const fixedIncomeTypeEnum = pgEnum("fixed_income_type", [
  "TREASURY_BILL", "TREASURY_BOND", "CORPORATE_BOND", "ABCP", "SUKUK",
  "COMMERCIAL_PAPER", "AGRI_BOND", "GREEN_BOND",
]);

export const fixedIncomeStatusEnum = pgEnum("fixed_income_status", [
  "ACTIVE", "MATURED", "DEFAULTED", "CALLED", "SUSPENDED",
]);

export const fixedIncomeInstruments = pgTable("fixed_income_instruments", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  isin: varchar("isin", { length: 20 }).unique(),
  ticker: varchar("ticker", { length: 20 }).notNull(),
  name: varchar("name", { length: 300 }).notNull(),
  issuerName: varchar("issuer_name", { length: 200 }).notNull(),
  type: fixedIncomeTypeEnum("type").notNull(),
  status: fixedIncomeStatusEnum("status").default("ACTIVE").notNull(),
  faceValueNgn: numeric("face_value_ngn", { precision: 18, scale: 2 }).notNull(),
  couponRatePct: numeric("coupon_rate_pct", { precision: 8, scale: 4 }),
  yieldPct: numeric("yield_pct", { precision: 8, scale: 4 }),
  maturityDate: timestamp("maturity_date").notNull(),
  issueDate: timestamp("issue_date").notNull(),
  totalIssuanceNgn: numeric("total_issuance_ngn", { precision: 22, scale: 2 }),
  outstandingNgn: numeric("outstanding_ngn", { precision: 22, scale: 2 }),
  creditRating: varchar("credit_rating", { length: 10 }),
  ratingAgency: varchar("rating_agency", { length: 50 }),
  collateralDescription: text("collateral_description"),
  prospectusUrl: text("prospectus_url"),
  lastPriceNgn: numeric("last_price_ngn", { precision: 18, scale: 4 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export type FixedIncomeInstrument = typeof fixedIncomeInstruments.$inferSelect;

export const fixedIncomeTrades = pgTable("fixed_income_trades", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  instrumentId: integer("instrument_id").notNull(),
  buyerUserId: integer("buyer_user_id").notNull(),
  sellerUserId: integer("seller_user_id"),
  faceValueNgn: numeric("face_value_ngn", { precision: 18, scale: 2 }).notNull(),
  priceNgn: numeric("price_ngn", { precision: 18, scale: 4 }).notNull(),
  yieldPct: numeric("yield_pct", { precision: 8, scale: 4 }),
  settlementDate: timestamp("settlement_date"),
  tradeDate: timestamp("trade_date").defaultNow().notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export type FixedIncomeTrade = typeof fixedIncomeTrades.$inferSelect;

// ─── NEXCOM Commodity Index (NCI) ─────────────────────────────────────────────

export const commodityIndexes = pgTable("commodity_indexes", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  ticker: varchar("ticker", { length: 20 }).notNull().unique(),
  name: varchar("name", { length: 200 }).notNull(),
  description: text("description"),
  baseValue: numeric("base_value", { precision: 10, scale: 4 }).default("1000"),
  currentValue: numeric("current_value", { precision: 10, scale: 4 }),
  changePercent: numeric("change_percent", { precision: 8, scale: 4 }),
  components: jsonb("components"), // [{symbol, weight, lastPrice}]
  calculationMethod: varchar("calculation_method", { length: 50 }).default("PRICE_WEIGHTED"),
  rebalanceFrequency: varchar("rebalance_frequency", { length: 20 }).default("MONTHLY"),
  lastCalculatedAt: timestamp("last_calculated_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export type CommodityIndex = typeof commodityIndexes.$inferSelect;

export const commodityIndexHistory = pgTable("commodity_index_history", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  indexId: integer("index_id").notNull(),
  value: numeric("value", { precision: 10, scale: 4 }).notNull(),
  changePercent: numeric("change_percent", { precision: 8, scale: 4 }),
  volume: numeric("volume", { precision: 22, scale: 2 }),
  recordedAt: timestamp("recorded_at").defaultNow().notNull(),
});

// ═══════════════════════════════════════════════════════════════════════════════
// PHASE 2 — WORKBENCH AGRI-SME SAAS
// ═══════════════════════════════════════════════════════════════════════════════

export const workbenchFarmStatusEnum = pgEnum("workbench_farm_status", [
  "ACTIVE", "FALLOW", "HARVESTED", "ABANDONED",
]);

export const workbenchFarms = pgTable("workbench_farms", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  userId: integer("user_id").notNull(),
  farmName: varchar("farm_name", { length: 200 }).notNull(),
  locationState: varchar("location_state", { length: 100 }),
  locationLga: varchar("location_lga", { length: 100 }),
  locationAddress: text("location_address"),
  coordinates: geometry("coordinates", { type: "Point", srid: 4326 }),
  totalHectares: numeric("total_hectares", { precision: 10, scale: 2 }),
  soilType: varchar("soil_type", { length: 50 }),
  irrigationType: varchar("irrigation_type", { length: 50 }),
  status: workbenchFarmStatusEnum("status").default("ACTIVE").notNull(),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export type WorkbenchFarm = typeof workbenchFarms.$inferSelect;

export const workbenchCropSeasonEnum = pgEnum("workbench_crop_season", [
  "WET_SEASON", "DRY_SEASON", "YEAR_ROUND",
]);

export const workbenchCropPlans = pgTable("workbench_crop_plans", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  farmId: integer("farm_id").notNull(),
  userId: integer("user_id").notNull(),
  cropSymbol: varchar("crop_symbol", { length: 20 }).notNull(),
  cropName: varchar("crop_name", { length: 100 }).notNull(),
  season: workbenchCropSeasonEnum("season").notNull(),
  plantingDate: timestamp("planting_date"),
  expectedHarvestDate: timestamp("expected_harvest_date"),
  actualHarvestDate: timestamp("actual_harvest_date"),
  plannedHectares: numeric("planned_hectares", { precision: 10, scale: 2 }),
  actualHectares: numeric("actual_hectares", { precision: 10, scale: 2 }),
  expectedYieldMt: numeric("expected_yield_mt", { precision: 10, scale: 3 }),
  actualYieldMt: numeric("actual_yield_mt", { precision: 10, scale: 3 }),
  inputCostNgn: numeric("input_cost_ngn", { precision: 18, scale: 2 }),
  revenueNgn: numeric("revenue_ngn", { precision: 18, scale: 2 }),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export type WorkbenchCropPlan = typeof workbenchCropPlans.$inferSelect;

export const workbenchSoilTests = pgTable("workbench_soil_tests", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  farmId: integer("farm_id").notNull(),
  userId: integer("user_id").notNull(),
  testDate: timestamp("test_date").defaultNow().notNull(),
  phLevel: numeric("ph_level", { precision: 4, scale: 2 }),
  nitrogenPpm: numeric("nitrogen_ppm", { precision: 8, scale: 2 }),
  phosphorusPpm: numeric("phosphorus_ppm", { precision: 8, scale: 2 }),
  potassiumPpm: numeric("potassium_ppm", { precision: 8, scale: 2 }),
  organicMatterPct: numeric("organic_matter_pct", { precision: 5, scale: 2 }),
  recommendations: text("recommendations"),
  labName: varchar("lab_name", { length: 200 }),
  reportUrl: text("report_url"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export type WorkbenchSoilTest = typeof workbenchSoilTests.$inferSelect;

// ─── Bank Financing API ───────────────────────────────────────────────────────

export const bankFinancingStatusEnum = pgEnum("bank_financing_status", [
  "DRAFT", "SUBMITTED", "UNDER_REVIEW", "APPROVED", "REJECTED",
  "DISBURSED", "REPAYING", "CLOSED", "DEFAULTED",
]);

export const bankFinancingApplications = pgTable("bank_financing_applications", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  userId: integer("user_id").notNull(),
  bankName: varchar("bank_name", { length: 200 }).notNull(),
  bankCode: varchar("bank_code", { length: 20 }),
  loanPurpose: varchar("loan_purpose", { length: 100 }).notNull(),
  requestedAmountNgn: numeric("requested_amount_ngn", { precision: 18, scale: 2 }).notNull(),
  approvedAmountNgn: numeric("approved_amount_ngn", { precision: 18, scale: 2 }),
  interestRatePct: numeric("interest_rate_pct", { precision: 6, scale: 3 }),
  tenorMonths: integer("tenor_months"),
  collateralEwrId: integer("collateral_ewr_id"),
  collateralValueNgn: numeric("collateral_value_ngn", { precision: 18, scale: 2 }),
  status: bankFinancingStatusEnum("status").default("DRAFT").notNull(),
  rejectionReason: text("rejection_reason"),
  disbursedAt: timestamp("disbursed_at"),
  repaymentDueDate: timestamp("repayment_due_date"),
  externalReferenceId: varchar("external_reference_id", { length: 100 }),
  documents: jsonb("documents"), // [{name, url, type}]
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export type BankFinancingApplication = typeof bankFinancingApplications.$inferSelect;

// ═══════════════════════════════════════════════════════════════════════════════
// PHASE 3 — ABCP CAPITAL MARKETS
// ═══════════════════════════════════════════════════════════════════════════════

export const abcpStatusEnum = pgEnum("abcp_status", [
  "STRUCTURING", "SEC_REVIEW", "APPROVED", "ISSUED", "TRADING",
  "MATURED", "DEFAULTED", "CANCELLED",
]);

export const abcpPrograms = pgTable("abcp_programs", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  programName: varchar("program_name", { length: 300 }).notNull(),
  isin: varchar("isin", { length: 20 }).unique(),
  sponsorName: varchar("sponsor_name", { length: 200 }).notNull(),
  sponsorUserId: integer("sponsor_user_id"),
  arrangerName: varchar("arranger_name", { length: 200 }),
  programSizeNgn: numeric("program_size_ngn", { precision: 22, scale: 2 }).notNull(),
  outstandingNgn: numeric("outstanding_ngn", { precision: 22, scale: 2 }).default("0"),
  collateralType: varchar("collateral_type", { length: 100 }).notNull(), // e.g. "WAREHOUSE_RECEIPTS"
  collateralValueNgn: numeric("collateral_value_ngn", { precision: 22, scale: 2 }),
  coverageRatioPct: numeric("coverage_ratio_pct", { precision: 6, scale: 2 }),
  yieldPct: numeric("yield_pct", { precision: 8, scale: 4 }),
  tenorDays: integer("tenor_days").notNull(),
  issueDate: timestamp("issue_date"),
  maturityDate: timestamp("maturity_date"),
  creditRating: varchar("credit_rating", { length: 10 }),
  ratingAgency: varchar("rating_agency", { length: 50 }),
  status: abcpStatusEnum("status").default("STRUCTURING").notNull(),
  secApprovalRef: varchar("sec_approval_ref", { length: 100 }),
  prospectusUrl: text("prospectus_url"),
  underlyingEwrIds: jsonb("underlying_ewr_ids"), // array of EWR IDs
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export type AbcpProgram = typeof abcpPrograms.$inferSelect;

// ─── Crop Production Reports ──────────────────────────────────────────────────

export const cropReportTypeEnum = pgEnum("crop_report_type", [
  "PLANTING_PROGRESS", "CROP_CONDITIONS", "YIELD_FORECAST",
  "HARVEST_PROGRESS", "STORAGE_STOCKS", "PRICE_OUTLOOK",
]);

export const cropProductionReports = pgTable("crop_production_reports", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  reportType: cropReportTypeEnum("report_type").notNull(),
  cropSymbol: varchar("crop_symbol", { length: 20 }).notNull(),
  cropName: varchar("crop_name", { length: 100 }).notNull(),
  reportingPeriod: varchar("reporting_period", { length: 50 }).notNull(), // e.g. "2025-Q3"
  coverageRegion: varchar("coverage_region", { length: 100 }).default("NIGERIA"),
  productionMt: numeric("production_mt", { precision: 14, scale: 2 }),
  yieldMtPerHa: numeric("yield_mt_per_ha", { precision: 8, scale: 4 }),
  areaHarvestedHa: numeric("area_harvested_ha", { precision: 14, scale: 2 }),
  stocksMt: numeric("stocks_mt", { precision: 14, scale: 2 }),
  exportsMt: numeric("exports_mt", { precision: 14, scale: 2 }),
  importsMt: numeric("imports_mt", { precision: 14, scale: 2 }),
  priceNgnPerMt: numeric("price_ngn_per_mt", { precision: 12, scale: 2 }),
  priceChangePercent: numeric("price_change_percent", { precision: 8, scale: 4 }),
  outlookSummary: text("outlook_summary"),
  spatialDataUrl: text("spatial_data_url"), // GeoJSON from Sedona
  publishedAt: timestamp("published_at").defaultNow().notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export type CropProductionReport = typeof cropProductionReports.$inferSelect;

// ═══════════════════════════════════════════════════════════════════════════════
// PHASE 4 — INPUT FINANCING ENGINE
// ═══════════════════════════════════════════════════════════════════════════════

export const inputFinancingStatusEnum = pgEnum("input_financing_status", [
  "APPLIED", "APPROVED", "DISBURSED", "IN_USE", "REPAYING",
  "REPAID", "DEFAULTED", "WRITTEN_OFF",
]);

export const inputTypes = pgEnum("input_type", [
  "SEEDS", "FERTILIZER", "PESTICIDE", "HERBICIDE", "EQUIPMENT",
  "IRRIGATION", "STORAGE", "CASH",
]);

export const inputFinancingLoans = pgTable("input_financing_loans", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  farmerId: integer("farmer_id").notNull(),
  agentId: integer("agent_id"), // field agent who originated
  cropPlanId: integer("crop_plan_id"),
  inputType: inputTypes("input_type").notNull(),
  inputDescription: text("input_description").notNull(),
  requestedValueNgn: numeric("requested_value_ngn", { precision: 18, scale: 2 }).notNull(),
  approvedValueNgn: numeric("approved_value_ngn", { precision: 18, scale: 2 }),
  disbursedValueNgn: numeric("disbursed_value_ngn", { precision: 18, scale: 2 }),
  repaidValueNgn: numeric("repaid_value_ngn", { precision: 18, scale: 2 }).default("0"),
  interestRatePct: numeric("interest_rate_pct", { precision: 6, scale: 3 }).default("8.5"),
  tenorMonths: integer("tenor_months").default(6),
  status: inputFinancingStatusEnum("status").default("APPLIED").notNull(),
  collateralEwrId: integer("collateral_ewr_id"),
  repaymentMethod: varchar("repayment_method", { length: 50 }).default("HARVEST_DEDUCTION"),
  disbursedAt: timestamp("disbursed_at"),
  repaymentDueDate: timestamp("repayment_due_date"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export type InputFinancingLoan = typeof inputFinancingLoans.$inferSelect;

export const inputFinancingRepayments = pgTable("input_financing_repayments", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  loanId: integer("loan_id").notNull(),
  amountNgn: numeric("amount_ngn", { precision: 18, scale: 2 }).notNull(),
  method: varchar("method", { length: 50 }).notNull(), // CASH, HARVEST_DEDUCTION, EWR_PLEDGE
  reference: varchar("reference", { length: 100 }),
  paidAt: timestamp("paid_at").defaultNow().notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ═══════════════════════════════════════════════════════════════════════════════
// PHASE 4 — FIELD AGENT NETWORK
// ═══════════════════════════════════════════════════════════════════════════════

export const fieldAgentStatusEnum = pgEnum("field_agent_status", [
  "PENDING", "ACTIVE", "SUSPENDED", "TERMINATED",
]);

export const fieldAgents = pgTable("field_agents", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  userId: integer("user_id").notNull().unique(),
  agentCode: varchar("agent_code", { length: 20 }).notNull().unique(),
  fullName: varchar("full_name", { length: 200 }).notNull(),
  phone: varchar("phone", { length: 20 }).notNull(),
  stateOfOperation: varchar("state_of_operation", { length: 100 }),
  lgaOfOperation: varchar("lga_of_operation", { length: 100 }),
  totalFarmersOnboarded: integer("total_farmers_onboarded").default(0),
  totalLoansOriginated: integer("total_loans_originated").default(0),
  totalLoansValueNgn: numeric("total_loans_value_ngn", { precision: 22, scale: 2 }).default("0"),
  commissionEarnedNgn: numeric("commission_earned_ngn", { precision: 18, scale: 2 }).default("0"),
  status: fieldAgentStatusEnum("status").default("PENDING").notNull(),
  supervisorId: integer("supervisor_id"),
  profilePhotoUrl: text("profile_photo_url"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export type FieldAgent = typeof fieldAgents.$inferSelect;

export const fieldVisitTypeEnum = pgEnum("field_visit_type", [
  "ONBOARDING", "CROP_INSPECTION", "LOAN_ASSESSMENT",
  "HARVEST_VERIFICATION", "REPAYMENT_COLLECTION", "FOLLOW_UP",
]);

export const fieldVisitStatusEnum = pgEnum("field_visit_status", [
  "SCHEDULED", "IN_PROGRESS", "COMPLETED", "CANCELLED", "NO_SHOW",
]);

export const fieldVisits = pgTable("field_visits", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  agentId: integer("agent_id").notNull(),
  farmerId: integer("farmer_id").notNull(),
  farmId: integer("farm_id"),
  visitType: fieldVisitTypeEnum("visit_type").notNull(),
  status: fieldVisitStatusEnum("status").default("SCHEDULED").notNull(),
  scheduledAt: timestamp("scheduled_at").notNull(),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  gpsLatitude: numeric("gps_latitude", { precision: 10, scale: 7 }),
  gpsLongitude: numeric("gps_longitude", { precision: 10, scale: 7 }),
  observations: text("observations"),
  photoUrls: jsonb("photo_urls"), // array of S3 URLs
  cropCondition: varchar("crop_condition", { length: 20 }), // GOOD, FAIR, POOR
  estimatedYieldMt: numeric("estimated_yield_mt", { precision: 10, scale: 3 }),
  loanRecommendationNgn: numeric("loan_recommendation_ngn", { precision: 18, scale: 2 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export type FieldVisit = typeof fieldVisits.$inferSelect;
