-- ============================================================
-- NEXCOM Exchange — Production Migration Script
-- Generated : 2026-06-16T22:42:32.674220+00:00
-- Generator : generate_migration.py (Python 3.11)
-- Target DB : PostgreSQL 16+ with PostGIS, uuid-ossp, pg_trgm
-- ============================================================
-- HOW TO APPLY
--   psql "$DATABASE_URL" -f production_migration.sql
--
-- ROLLBACK
--   A companion rollback script is generated alongside this file.
--   Apply it ONLY if you need to undo the migration:
--   psql "$DATABASE_URL" -f production_rollback.sql
--
-- SAFETY RULES
--   1. Run on a COPY of production first.
--   2. Take a full pg_dump backup before running.
--   3. Run inside a transaction: the script wraps everything in
--      BEGIN / COMMIT so a single failure rolls back all changes.
-- ============================================================

BEGIN;

-- Pre-flight: verify PostgreSQL version
DO $$
DECLARE
  v int;
BEGIN
  SELECT current_setting('server_version_num')::int INTO v;
  IF v < 160000 THEN
    RAISE EXCEPTION 'PostgreSQL 16+ required (found %)', current_setting('server_version');
  END IF;
END $$;

-- Required extensions
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS btree_gin;


-- ---- 0000_aspiring_robbie_robertson.sql ----
DO $$ BEGIN
  CREATE TYPE "public"."account_type" AS ENUM('FARMER', 'TRADER', 'PROCESSOR', 'BROKER');
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'type account_type already exists, skipping';
END $$;
DO $$ BEGIN
  CREATE TYPE "public"."alert_condition" AS ENUM('ABOVE', 'BELOW');
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'type alert_condition already exists, skipping';
END $$;
DO $$ BEGIN
  CREATE TYPE "public"."kyc_queue_status" AS ENUM('PENDING', 'UNDER_REVIEW', 'APPROVED', 'REJECTED');
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'type kyc_queue_status already exists, skipping';
END $$;
DO $$ BEGIN
  CREATE TYPE "public"."kyc_status" AS ENUM('PENDING', 'VERIFIED', 'REJECTED');
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'type kyc_status already exists, skipping';
END $$;
DO $$ BEGIN
  CREATE TYPE "public"."notification_type" AS ENUM('TRADE', 'SETTLEMENT', 'KYC', 'ALERT', 'SYSTEM');
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'type notification_type already exists, skipping';
END $$;
DO $$ BEGIN
  CREATE TYPE "public"."order_side" AS ENUM('BUY', 'SELL');
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'type order_side already exists, skipping';
END $$;
DO $$ BEGIN
  CREATE TYPE "public"."order_type" AS ENUM('LIMIT', 'MARKET', 'STOP_LIMIT');
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'type order_type already exists, skipping';
END $$;
DO $$ BEGIN
  CREATE TYPE "public"."role" AS ENUM('user', 'admin', 'farmer', 'trader', 'broker');
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'type role already exists, skipping';
END $$;
CREATE TABLE IF NOT EXISTS "audit_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"action" varchar(128) NOT NULL,
	"resource" varchar(128),
	"resource_id" varchar(64),
	"details" json,
	"ip_address" varchar(45),
	"created_at" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS "kyc_queue" (
	"id" serial PRIMARY KEY NOT NULL,
	"profile_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"status" "kyc_queue_status" DEFAULT 'PENDING' NOT NULL,
	"reviewed_by" integer,
	"review_notes" text,
	"submitted_at" timestamp DEFAULT now() NOT NULL,
	"reviewed_at" timestamp
);
CREATE TABLE IF NOT EXISTS "notifications" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"title" varchar(256) NOT NULL,
	"message" text NOT NULL,
	"type" "notification_type" DEFAULT 'SYSTEM' NOT NULL,
	"read" boolean DEFAULT false NOT NULL,
	"metadata" json,
	"created_at" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS "price_alerts" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"symbol" varchar(32) NOT NULL,
	"condition" "alert_condition" NOT NULL,
	"target_price" numeric(18, 6) NOT NULL,
	"triggered" boolean DEFAULT false NOT NULL,
	"notified" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS "profiles" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"account_type" "account_type" NOT NULL,
	"phone" varchar(20),
	"nin" varchar(20),
	"bvn" varchar(20),
	"state" varchar(64),
	"country" varchar(64) DEFAULT 'Nigeria',
	"kyc_status" "kyc_status" DEFAULT 'PENDING' NOT NULL,
	"kyc_notes" text,
	"bank_name" varchar(128),
	"bank_account" varchar(20),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS "saved_orders" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"name" varchar(128) NOT NULL,
	"symbol" varchar(32) NOT NULL,
	"side" "order_side" NOT NULL,
	"order_type" "order_type" NOT NULL,
	"quantity" numeric(18, 6) NOT NULL,
	"price" numeric(18, 6),
	"created_at" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"open_id" varchar(64) NOT NULL,
	"name" text,
	"email" varchar(320),
	"login_method" varchar(64),
	"role" "role" DEFAULT 'user' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"last_signed_in" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_open_id_unique" UNIQUE("open_id")
);
CREATE TABLE IF NOT EXISTS "watchlist" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"symbol" varchar(32) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);

-- ---- 0000_cloudy_ogun.sql ----
DO $$ BEGIN
  CREATE TYPE "public"."account_type" AS ENUM('FARMER', 'TRADER', 'PROCESSOR', 'BROKER', 'WAREHOUSE_OPERATOR', 'MARKET_MAKER');
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'type account_type already exists, skipping';
END $$;
DO $$ BEGIN
  CREATE TYPE "public"."alert_condition" AS ENUM('ABOVE', 'BELOW', 'CROSS_ABOVE', 'CROSS_BELOW');
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'type alert_condition already exists, skipping';
END $$;
DO $$ BEGIN
  CREATE TYPE "public"."asset_class" AS ENUM('COMMODITY', 'FOREX', 'EQUITY', 'DIGITAL_ASSET', 'INDEX');
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'type asset_class already exists, skipping';
END $$;
DO $$ BEGIN
  CREATE TYPE "public"."auto_liquidation_status" AS ENUM('PENDING', 'EXECUTING', 'COMPLETED', 'FAILED', 'CANCELLED');
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'type auto_liquidation_status already exists, skipping';
END $$;
DO $$ BEGIN
  CREATE TYPE "public"."broker_account_status" AS ENUM('INACTIVE', 'ACTIVE', 'SUSPENDED');
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'type broker_account_status already exists, skipping';
END $$;
DO $$ BEGIN
  CREATE TYPE "public"."broker_client_status" AS ENUM('ACTIVE', 'INACTIVE', 'SUSPENDED');
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'type broker_client_status already exists, skipping';
END $$;
DO $$ BEGIN
  CREATE TYPE "public"."broker_commission_status" AS ENUM('PENDING', 'PAID', 'CANCELLED');
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'type broker_commission_status already exists, skipping';
END $$;
DO $$ BEGIN
  CREATE TYPE "public"."broker_kyc_status" AS ENUM('PENDING', 'UNDER_REVIEW', 'APPROVED', 'REJECTED');
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'type broker_kyc_status already exists, skipping';
END $$;
DO $$ BEGIN
  CREATE TYPE "public"."bulk_kyc_status" AS ENUM('PROCESSING', 'COMPLETED', 'FAILED', 'PARTIAL');
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'type bulk_kyc_status already exists, skipping';
END $$;
DO $$ BEGIN
  CREATE TYPE "public"."bulk_listing_approval_status" AS ENUM('PENDING', 'COUNTERSIGNED', 'REJECTED', 'EXPIRED');
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'type bulk_listing_approval_status already exists, skipping';
END $$;
DO $$ BEGIN
  CREATE TYPE "public"."clearing_account_status" AS ENUM('ACTIVE', 'SUSPENDED', 'CLOSED');
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'type clearing_account_status already exists, skipping';
END $$;
DO $$ BEGIN
  CREATE TYPE "public"."collateral_ledger_action" AS ENUM('PLEDGE', 'RELEASE', 'LIQUIDATE', 'REVALUE');
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'type collateral_ledger_action already exists, skipping';
END $$;
DO $$ BEGIN
  CREATE TYPE "public"."collateral_status" AS ENUM('ACTIVE', 'RELEASED', 'LIQUIDATED');
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'type collateral_status already exists, skipping';
END $$;
DO $$ BEGIN
  CREATE TYPE "public"."collateral_type" AS ENUM('WAREHOUSE_RECEIPT', 'CASH', 'BOND', 'EQUITY');
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'type collateral_type already exists, skipping';
END $$;
DO $$ BEGIN
  CREATE TYPE "public"."corporate_action_status" AS ENUM('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'CANCELLED', 'COMPLETED');
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'type corporate_action_status already exists, skipping';
END $$;
DO $$ BEGIN
  CREATE TYPE "public"."corporate_action_type" AS ENUM('DIVIDEND', 'STOCK_SPLIT', 'RIGHTS_ISSUE', 'BONUS_ISSUE', 'MERGER', 'DELISTING', 'IPO');
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'type corporate_action_type already exists, skipping';
END $$;
DO $$ BEGIN
  CREATE TYPE "public"."crop_status_v2" AS ENUM('ACTIVE', 'SOLD', 'EXPIRED', 'WITHDRAWN');
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'type crop_status_v2 already exists, skipping';
END $$;
DO $$ BEGIN
  CREATE TYPE "public"."delivery_status" AS ENUM('PENDING', 'SCHEDULED', 'IN_TRANSIT', 'DELIVERED', 'CANCELLED');
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'type delivery_status already exists, skipping';
END $$;
DO $$ BEGIN
  CREATE TYPE "public"."deposit_status" AS ENUM('PENDING', 'RECEIVED', 'GRADED', 'STORED', 'REJECTED');
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'type deposit_status already exists, skipping';
END $$;
DO $$ BEGIN
  CREATE TYPE "public"."dfsp_kyc_status" AS ENUM('PENDING', 'APPROVED', 'REJECTED', 'EDD_REQUIRED');
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'type dfsp_kyc_status already exists, skipping';
END $$;
DO $$ BEGIN
  CREATE TYPE "public"."dfsp_tier" AS ENUM('STANDARD', 'PREMIUM', 'INSTITUTIONAL', 'CORRESPONDENT');
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'type dfsp_tier already exists, skipping';
END $$;
DO $$ BEGIN
  CREATE TYPE "public"."dispute_resolution" AS ENUM('SETTLED', 'FAILED', 'WITHDRAWN');
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'type dispute_resolution already exists, skipping';
END $$;
DO $$ BEGIN
  CREATE TYPE "public"."dispute_status" AS ENUM('OPEN', 'UNDER_REVIEW', 'RESOLVED_SETTLED', 'RESOLVED_FAILED', 'WITHDRAWN');
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'type dispute_status already exists, skipping';
END $$;
DO $$ BEGIN
  CREATE TYPE "public"."farmer_kyc_status" AS ENUM('PENDING', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED');
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'type farmer_kyc_status already exists, skipping';
END $$;
DO $$ BEGIN
  CREATE TYPE "public"."ip_allowlist_scope" AS ENUM('GLOBAL_ADMIN', 'BULK_OPERATIONS', 'LIQUIDATION_OVERRIDE', 'WITHDRAWAL_APPROVAL');
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'type ip_allowlist_scope already exists, skipping';
END $$;
DO $$ BEGIN
  CREATE TYPE "public"."ir_document_type" AS ENUM('ANNUAL_REPORT', 'INTERIM_REPORT', 'QUARTERLY_REPORT', 'PROSPECTUS', 'CIRCULAR', 'PRESS_RELEASE', 'PRESENTATION', 'FINANCIAL_STATEMENT', 'REGULATORY_FILING', 'OTHER');
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'type ir_document_type already exists, skipping';
END $$;
DO $$ BEGIN
  CREATE TYPE "public"."ir_event_type" AS ENUM('EARNINGS_RELEASE', 'DIVIDEND_ANNOUNCEMENT', 'AGM', 'EGM', 'RIGHTS_ISSUE', 'BONUS_ISSUE', 'STOCK_SPLIT', 'MERGER_ACQUISITION', 'REGULATORY_FILING', 'INVESTOR_PRESENTATION', 'ROADSHOW', 'OTHER');
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'type ir_event_type already exists, skipping';
END $$;
DO $$ BEGIN
  CREATE TYPE "public"."kyc_audit_decision" AS ENUM('APPROVED', 'REJECTED', 'RESET', 'UNDER_REVIEW');
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'type kyc_audit_decision already exists, skipping';
END $$;
DO $$ BEGIN
  CREATE TYPE "public"."kyc_audit_stakeholder" AS ENUM('FARMER', 'TRADER', 'BROKER', 'WAREHOUSE_OPERATOR', 'MARKET_MAKER');
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'type kyc_audit_stakeholder already exists, skipping';
END $$;
DO $$ BEGIN
  CREATE TYPE "public"."kyc_risk_level" AS ENUM('LOW', 'MEDIUM', 'HIGH', 'CRITICAL', 'UNKNOWN');
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'type kyc_risk_level already exists, skipping';
END $$;
DO $$ BEGIN
  CREATE TYPE "public"."margin_account_status" AS ENUM('ACTIVE', 'SUSPENDED', 'CLOSED');
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'type margin_account_status already exists, skipping';
END $$;
DO $$ BEGIN
  CREATE TYPE "public"."margin_call_event_type" AS ENUM('ISSUED', 'DEPOSIT_RECEIVED', 'PARTIALLY_MET', 'MET', 'DEFAULTED', 'CANCELLED', 'GRACE_EXTENDED');
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'type margin_call_event_type already exists, skipping';
END $$;
DO $$ BEGIN
  CREATE TYPE "public"."margin_call_status" AS ENUM('OPEN', 'PARTIALLY_MET', 'MET', 'DEFAULTED', 'CANCELLED');
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'type margin_call_status already exists, skipping';
END $$;
DO $$ BEGIN
  CREATE TYPE "public"."mfa_method" AS ENUM('totp', 'webauthn', 'sms', 'email_otp');
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'type mfa_method already exists, skipping';
END $$;
DO $$ BEGIN
  CREATE TYPE "public"."mm_onboarding_account_status" AS ENUM('INACTIVE', 'ACTIVE', 'SUSPENDED');
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'type mm_onboarding_account_status already exists, skipping';
END $$;
DO $$ BEGIN
  CREATE TYPE "public"."mm_onboarding_kyc_status" AS ENUM('PENDING', 'UNDER_REVIEW', 'APPROVED', 'REJECTED');
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'type mm_onboarding_kyc_status already exists, skipping';
END $$;
DO $$ BEGIN
  CREATE TYPE "public"."mojaloop_quote_status" AS ENUM('PENDING', 'ACCEPTED', 'REJECTED', 'EXPIRED');
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'type mojaloop_quote_status already exists, skipping';
END $$;
DO $$ BEGIN
  CREATE TYPE "public"."mojaloop_transfer_status" AS ENUM('PENDING', 'RESERVED', 'COMMITTED', 'ABORTED', 'EXPIRED');
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'type mojaloop_transfer_status already exists, skipping';
END $$;
DO $$ BEGIN
  CREATE TYPE "public"."notification_type" AS ENUM('TRADE', 'SETTLEMENT', 'KYC', 'ALERT', 'SYSTEM', 'MARGIN_CALL', 'LIQUIDATED', 'SECURITY_ALERT');
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'type notification_type already exists, skipping';
END $$;
DO $$ BEGIN
  CREATE TYPE "public"."option_position_status" AS ENUM('OPEN', 'EXERCISED', 'EXPIRED', 'CLOSED');
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'type option_position_status already exists, skipping';
END $$;
DO $$ BEGIN
  CREATE TYPE "public"."option_status" AS ENUM('ACTIVE', 'EXPIRED', 'SETTLED');
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'type option_status already exists, skipping';
END $$;
DO $$ BEGIN
  CREATE TYPE "public"."option_type" AS ENUM('CALL', 'PUT');
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'type option_type already exists, skipping';
END $$;
DO $$ BEGIN
  CREATE TYPE "public"."order_status" AS ENUM('OPEN', 'PARTIALLY_FILLED', 'FILLED', 'CANCELLED', 'REJECTED', 'EXPIRED');
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'type order_status already exists, skipping';
END $$;
DO $$ BEGIN
  CREATE TYPE "public"."re_kyc_stakeholder_type" AS ENUM('FARMER', 'TRADER', 'BROKER', 'WAREHOUSE_OPERATOR', 'MARKET_MAKER');
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'type re_kyc_stakeholder_type already exists, skipping';
END $$;
DO $$ BEGIN
  CREATE TYPE "public"."security_event_severity" AS ENUM('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'type security_event_severity already exists, skipping';
END $$;
DO $$ BEGIN
  CREATE TYPE "public"."security_event_status" AS ENUM('OPEN', 'INVESTIGATING', 'RESOLVED', 'FALSE_POSITIVE');
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'type security_event_status already exists, skipping';
END $$;
DO $$ BEGIN
  CREATE TYPE "public"."security_event_type" AS ENUM('RATE_LIMIT_BREACH', 'ANOMALOUS_ORDER', 'LARGE_WITHDRAWAL', 'REPEATED_AUTH_FAILURE', 'ADMIN_BULK_ACTION', 'SUSPICIOUS_IP', 'UNUSUAL_TRADE_PATTERN', 'ACCOUNT_TAKEOVER_ATTEMPT');
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'type security_event_type already exists, skipping';
END $$;
DO $$ BEGIN
  CREATE TYPE "public"."settlement_status" AS ENUM('PENDING', 'MATCHED', 'SETTLED', 'FAILED', 'DISPUTED');
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'type settlement_status already exists, skipping';
END $$;
DO $$ BEGIN
  CREATE TYPE "public"."soil_type" AS ENUM('LOAMY', 'CLAY', 'SANDY', 'SILT', 'PEAT', 'CHALK', 'OTHER');
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'type soil_type already exists, skipping';
END $$;
DO $$ BEGIN
  CREATE TYPE "public"."stakeholder_type" AS ENUM('FARMER', 'TRADER', 'BROKER', 'WAREHOUSE_OPERATOR', 'MARKET_MAKER', 'ADMIN');
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'type stakeholder_type already exists, skipping';
END $$;
DO $$ BEGIN
  CREATE TYPE "public"."trader_account_status" AS ENUM('INACTIVE', 'ACTIVE', 'SUSPENDED');
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'type trader_account_status already exists, skipping';
END $$;
DO $$ BEGIN
  CREATE TYPE "public"."trader_experience" AS ENUM('BEGINNER', 'INTERMEDIATE', 'EXPERIENCED', 'PROFESSIONAL');
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'type trader_experience already exists, skipping';
END $$;
DO $$ BEGIN
  CREATE TYPE "public"."trader_kyc_status" AS ENUM('PENDING', 'UNDER_REVIEW', 'APPROVED', 'REJECTED');
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'type trader_kyc_status already exists, skipping';
END $$;
DO $$ BEGIN
  CREATE TYPE "public"."trader_risk_profile" AS ENUM('CONSERVATIVE', 'MODERATE', 'AGGRESSIVE');
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'type trader_risk_profile already exists, skipping';
END $$;
DO $$ BEGIN
  CREATE TYPE "public"."warehouse_message_status" AS ENUM('SENT', 'READ', 'REPLIED', 'CLOSED');
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'type warehouse_message_status already exists, skipping';
END $$;
DO $$ BEGIN
  CREATE TYPE "public"."warehouse_op_account_status" AS ENUM('INACTIVE', 'ACTIVE', 'SUSPENDED');
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'type warehouse_op_account_status already exists, skipping';
END $$;
DO $$ BEGIN
  CREATE TYPE "public"."warehouse_op_kyc_status" AS ENUM('PENDING', 'UNDER_REVIEW', 'APPROVED', 'REJECTED');
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'type warehouse_op_kyc_status already exists, skipping';
END $$;
DO $$ BEGIN
  CREATE TYPE "public"."warehouse_receipt_status" AS ENUM('ACTIVE', 'PLEDGED', 'REDEEMED', 'CANCELLED');
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'type warehouse_receipt_status already exists, skipping';
END $$;
DO $$ BEGIN
  CREATE TYPE "public"."webhook_event_filter" AS ENUM('ALL', 'HIGH_AND_CRITICAL', 'CRITICAL_ONLY');
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'type webhook_event_filter already exists, skipping';
END $$;
DO $$ BEGIN
  CREATE TYPE "public"."withdrawal_verification_status" AS ENUM('PENDING', 'PASSED', 'FAILED', 'EXPIRED');
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'type withdrawal_verification_status already exists, skipping';
END $$;
CREATE TABLE IF NOT EXISTS "aml_flags" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"rule_id" bigint,
	"transaction_ref" varchar(128),
	"transaction_type" varchar(64) NOT NULL,
	"amount" numeric(20, 2),
	"currency" varchar(8) DEFAULT 'NGN',
	"flag_reason" text NOT NULL,
	"severity" varchar(16) DEFAULT 'MEDIUM' NOT NULL,
	"status" varchar(32) DEFAULT 'PENDING' NOT NULL,
	"reviewed_by" integer,
	"reviewed_at" timestamp,
	"review_notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS "aml_rules" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"name" varchar(128) NOT NULL,
	"rule_type" varchar(64) NOT NULL,
	"threshold_amount" numeric(20, 2),
	"threshold_count" integer,
	"window_hours" integer DEFAULT 24,
	"currency" varchar(8) DEFAULT 'NGN',
	"severity" varchar(16) DEFAULT 'MEDIUM' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"description" text,
	"created_by" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS "api_keys" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"name" varchar(128) NOT NULL,
	"key_hash" varchar(256) NOT NULL,
	"key_prefix" varchar(16) NOT NULL,
	"permissions" text[] DEFAULT '{}' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"last_used_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp
);
CREATE TABLE IF NOT EXISTS "auto_liquidation_orders" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"margin_call_id" bigint NOT NULL,
	"clearing_account_id" bigint NOT NULL,
	"user_id" integer NOT NULL,
	"status" "auto_liquidation_status" DEFAULT 'PENDING' NOT NULL,
	"instrument" varchar(64) NOT NULL,
	"quantity" numeric(20, 8) NOT NULL,
	"estimated_value" numeric(20, 2) NOT NULL,
	"actual_proceeds" numeric(20, 2),
	"initiated_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp,
	"initiated_by" integer,
	"failure_reason" text,
	"notes" text
);
CREATE TABLE IF NOT EXISTS "broker_clients" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"broker_profile_id" integer NOT NULL,
	"client_user_id" integer NOT NULL,
	"client_name" varchar(200),
	"client_email" varchar(200),
	"client_phone" varchar(30),
	"account_type" varchar(50) DEFAULT 'INDIVIDUAL',
	"status" "broker_client_status" DEFAULT 'ACTIVE' NOT NULL,
	"onboarded_at" timestamp DEFAULT now() NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS "broker_commissions" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"broker_profile_id" integer NOT NULL,
	"client_user_id" integer,
	"order_id" bigint,
	"fill_id" bigint,
	"symbol" varchar(32) NOT NULL,
	"side" varchar(4) NOT NULL,
	"filled_qty" numeric(18, 6) NOT NULL,
	"fill_price" numeric(18, 6) NOT NULL,
	"trade_value" numeric(18, 6) NOT NULL,
	"commission_rate" numeric(6, 4) NOT NULL,
	"commission_amount" numeric(18, 6) NOT NULL,
	"currency" varchar(10) DEFAULT 'NGN' NOT NULL,
	"status" "broker_commission_status" DEFAULT 'PENDING' NOT NULL,
	"paid_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS "broker_profiles" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"firm_name" varchar(200) NOT NULL,
	"rc_number" varchar(50),
	"sec_license_number" varchar(100),
	"cbn_license_number" varchar(100),
	"regulatory_body" varchar(100),
	"contact_phone" varchar(30),
	"contact_email" varchar(200),
	"firm_address" text,
	"state" varchar(100),
	"years_in_operation" integer,
	"client_book_size" varchar(50),
	"commission_rate" numeric(6, 4),
	"sec_certificate_url" text,
	"cbn_approval_url" text,
	"cac_doc_url" text,
	"kyc_status" "broker_kyc_status" DEFAULT 'PENDING' NOT NULL,
	"kyc_notes" text,
	"account_status" "broker_account_status" DEFAULT 'INACTIVE' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "broker_profiles_user_id_unique" UNIQUE("user_id")
);
CREATE TABLE IF NOT EXISTS "bulk_listing_approvals" (
	"id" serial PRIMARY KEY NOT NULL,
	"upload_id" integer NOT NULL,
	"cooperative_user_id" integer NOT NULL,
	"counter_signer_id" integer,
	"status" "bulk_listing_approval_status" DEFAULT 'PENDING' NOT NULL,
	"member_count" integer DEFAULT 0 NOT NULL,
	"crop_type" text NOT NULL,
	"total_quantity_kg" integer DEFAULT 0 NOT NULL,
	"price_per_kg" integer DEFAULT 0 NOT NULL,
	"harvest_date" timestamp,
	"description" text,
	"initiator_notes" text,
	"counter_signer_notes" text,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS "circuit_breaker_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"rule_id" integer,
	"instrument" varchar(32) NOT NULL,
	"asset_class" varchar(32) NOT NULL,
	"trigger_pct" numeric(8, 4) NOT NULL,
	"price_before" numeric(20, 8) NOT NULL,
	"price_after" numeric(20, 8) NOT NULL,
	"actual_move_pct" numeric(8, 4) NOT NULL,
	"halted_at" timestamp DEFAULT now() NOT NULL,
	"halt_until" timestamp NOT NULL,
	"lifted_at" timestamp,
	"lifted_by" integer,
	"status" varchar(16) DEFAULT 'ACTIVE' NOT NULL,
	"notes" text
);
CREATE TABLE IF NOT EXISTS "circuit_breaker_rules" (
	"id" serial PRIMARY KEY NOT NULL,
	"instrument" varchar(32) NOT NULL,
	"asset_class" varchar(32) DEFAULT 'COMMODITY' NOT NULL,
	"trigger_pct" numeric(8, 4) NOT NULL,
	"window_minutes" integer NOT NULL,
	"halt_duration_minutes" integer NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"notes" text,
	"created_by" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS "clearing_accounts" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"account_ref" varchar(32) NOT NULL,
	"status" "clearing_account_status" DEFAULT 'ACTIVE' NOT NULL,
	"initial_margin_pct" numeric(6, 4) DEFAULT '0.10' NOT NULL,
	"maintenance_margin_pct" numeric(6, 4) DEFAULT '0.07' NOT NULL,
	"portfolio_value" numeric(20, 2) DEFAULT '0' NOT NULL,
	"cash_balance" numeric(20, 2) DEFAULT '0' NOT NULL,
	"total_margin_required" numeric(20, 2) DEFAULT '0' NOT NULL,
	"total_margin_posted" numeric(20, 2) DEFAULT '0' NOT NULL,
	"equity_ratio" numeric(8, 6) DEFAULT '1' NOT NULL,
	"last_valuation_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"notes" text,
	CONSTRAINT "clearing_accounts_user_id_unique" UNIQUE("user_id"),
	CONSTRAINT "clearing_accounts_account_ref_unique" UNIQUE("account_ref")
);
CREATE TABLE IF NOT EXISTS "collateral_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"margin_account_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"collateral_type" "collateral_type" NOT NULL,
	"reference_id" integer,
	"description" text NOT NULL,
	"face_value" numeric(18, 2) NOT NULL,
	"current_value" numeric(18, 2) NOT NULL,
	"haircut" numeric(5, 2) DEFAULT '20' NOT NULL,
	"eligible_value" numeric(18, 2) NOT NULL,
	"status" "collateral_status" DEFAULT 'ACTIVE' NOT NULL,
	"pledged_at" timestamp DEFAULT now() NOT NULL,
	"released_at" timestamp,
	"notes" text
);
CREATE TABLE IF NOT EXISTS "collateral_ledger" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"collateral_item_id" integer,
	"action" "collateral_ledger_action" NOT NULL,
	"amount" numeric(18, 2) NOT NULL,
	"balance_before" numeric(18, 2) NOT NULL,
	"balance_after" numeric(18, 2) NOT NULL,
	"description" text NOT NULL,
	"performed_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS "compliance_exports" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"export_type" varchar(32) NOT NULL,
	"format" varchar(8) NOT NULL,
	"date_from" timestamp,
	"date_to" timestamp,
	"filters" text,
	"record_count" integer DEFAULT 0,
	"file_url" text,
	"file_key" text,
	"generated_by" integer NOT NULL,
	"generated_at" timestamp DEFAULT now() NOT NULL,
	"status" varchar(16) DEFAULT 'PENDING' NOT NULL
);
CREATE TABLE IF NOT EXISTS "cooperative_bulk_uploads" (
	"id" serial PRIMARY KEY NOT NULL,
	"uploaded_by" integer NOT NULL,
	"file_name" varchar(256) NOT NULL,
	"status" "bulk_kyc_status" DEFAULT 'PROCESSING' NOT NULL,
	"total_rows" integer DEFAULT 0 NOT NULL,
	"processed_rows" integer DEFAULT 0 NOT NULL,
	"success_rows" integer DEFAULT 0 NOT NULL,
	"failed_rows" integer DEFAULT 0 NOT NULL,
	"errors" json,
	"created_application_ids" json,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp
);
CREATE TABLE IF NOT EXISTS "corporate_actions" (
	"id" serial PRIMARY KEY NOT NULL,
	"action_type" "corporate_action_type" NOT NULL,
	"status" "corporate_action_status" DEFAULT 'DRAFT' NOT NULL,
	"symbol" varchar(64) NOT NULL,
	"title" varchar(256) NOT NULL,
	"description" text,
	"ex_date" timestamp,
	"record_date" timestamp,
	"payment_date" timestamp,
	"announcement_date" timestamp,
	"dividend_amount" numeric(18, 6),
	"dividend_currency" varchar(8),
	"split_ratio_from" integer,
	"split_ratio_to" integer,
	"rights_price" numeric(18, 6),
	"rights_ratio" varchar(32),
	"ipo_price" numeric(18, 6),
	"ipo_shares" bigint,
	"submitted_by" integer NOT NULL,
	"reviewed_by" integer,
	"review_notes" text,
	"submitted_at" timestamp DEFAULT now() NOT NULL,
	"reviewed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS "crop_listings" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"farm_id" integer NOT NULL,
	"crop_type" varchar(100) NOT NULL,
	"variety" varchar(100),
	"quantity_kg" numeric(14, 2) NOT NULL,
	"asking_price_per_kg" numeric(14, 4) NOT NULL,
	"currency" varchar(10) DEFAULT 'NGN' NOT NULL,
	"expected_harvest_date" timestamp NOT NULL,
	"description" text,
	"status" "crop_status_v2" DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS "delivery_orders" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"receipt_id" integer,
	"commodity" varchar(64) NOT NULL,
	"quantity" numeric(18, 6) NOT NULL,
	"unit" varchar(16) NOT NULL,
	"delivery_address" text NOT NULL,
	"scheduled_date" timestamp,
	"status" "delivery_status" DEFAULT 'PENDING' NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS "deposit_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"commodity" varchar(64) NOT NULL,
	"grade" varchar(32),
	"quantity" numeric(18, 6) NOT NULL,
	"unit" varchar(16) NOT NULL,
	"warehouse_id" varchar(64),
	"warehouse_name" varchar(256),
	"expected_date" timestamp,
	"status" "deposit_status" DEFAULT 'PENDING' NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS "device_sessions" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"fingerprint" varchar(128) NOT NULL,
	"user_agent" text,
	"ip_address" varchar(64),
	"timezone" varchar(64),
	"screen_resolution" varchar(32),
	"is_known" boolean DEFAULT false NOT NULL,
	"is_trusted" boolean DEFAULT false NOT NULL,
	"last_seen_at" timestamp DEFAULT now() NOT NULL,
	"first_seen_at" timestamp DEFAULT now() NOT NULL,
	"revoked_at" timestamp
);
CREATE TABLE IF NOT EXISTS "dfsp_kyc_records" (
	"id" serial PRIMARY KEY NOT NULL,
	"fsp_id" varchar(64) NOT NULL,
	"legal_entity_name" varchar(256) NOT NULL,
	"registration_number" varchar(128) NOT NULL,
	"tax_id" varchar(64),
	"regulatory_body" varchar(128) NOT NULL,
	"license_number" varchar(128) NOT NULL,
	"aml_risk_level" varchar(16) DEFAULT 'LOW' NOT NULL,
	"pep_exposure" boolean DEFAULT false NOT NULL,
	"sanctions_screening_passed" boolean DEFAULT false NOT NULL,
	"beneficial_owners" text NOT NULL,
	"compliance_officer_name" varchar(256) NOT NULL,
	"compliance_officer_email" varchar(256) NOT NULL,
	"documents_provided" json DEFAULT '[]'::json NOT NULL,
	"acknowledged_aml_policy" boolean DEFAULT false NOT NULL,
	"acknowledged_data_processing" boolean DEFAULT false NOT NULL,
	"status" "dfsp_kyc_status" DEFAULT 'PENDING' NOT NULL,
	"reviewed_by" varchar(128),
	"reviewed_at" timestamp,
	"review_notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "dfsp_kyc_records_fsp_id_unique" UNIQUE("fsp_id")
);
CREATE TABLE IF NOT EXISTS "dfsp_tiers" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" "dfsp_tier" NOT NULL,
	"display_name" varchar(64) NOT NULL,
	"description" text,
	"daily_limit_amount" numeric(18, 2) DEFAULT '1000000' NOT NULL,
	"daily_limit_currency" varchar(8) DEFAULT 'NGN' NOT NULL,
	"min_transfer_amount" numeric(18, 2) DEFAULT '100' NOT NULL,
	"max_transfer_amount" numeric(18, 2) DEFAULT '5000000' NOT NULL,
	"allowed_currencies" varchar(256) DEFAULT 'NGN' NOT NULL,
	"settlement_window_hrs" integer DEFAULT 24 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "dfsp_tiers_name_unique" UNIQUE("name")
);
CREATE TABLE IF NOT EXISTS "dispute_audit_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"dispute_id" integer NOT NULL,
	"performed_by" integer NOT NULL,
	"action" varchar(64) NOT NULL,
	"from_status" "dispute_status",
	"to_status" "dispute_status",
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS "dispute_evidence" (
	"id" serial PRIMARY KEY NOT NULL,
	"dispute_id" integer NOT NULL,
	"uploaded_by" integer NOT NULL,
	"file_key" varchar(512) NOT NULL,
	"file_url" text NOT NULL,
	"file_name" varchar(256) NOT NULL,
	"mime_type" varchar(128) NOT NULL,
	"file_size" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS "farm_profiles" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"farm_name" varchar(200) NOT NULL,
	"size_hectares" numeric(10, 2) NOT NULL,
	"latitude" numeric(10, 7),
	"longitude" numeric(10, 7),
	"state" varchar(100) NOT NULL,
	"lga" varchar(100) NOT NULL,
	"soil_type" "soil_type" DEFAULT 'LOAMY' NOT NULL,
	"description" text,
	"boundary" jsonb,
	"centroid" geometry(Point,4326),
	"geom" geometry(Polygon,4326),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS "farmer_earnings" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"listing_id" integer,
	"crop_type" varchar(100) NOT NULL,
	"quantity_kg" numeric(14, 2) NOT NULL,
	"price_per_kg" numeric(14, 4) NOT NULL,
	"total_amount" numeric(18, 2) NOT NULL,
	"currency" varchar(10) DEFAULT 'NGN' NOT NULL,
	"buyer_name" varchar(200),
	"settled_at" timestamp DEFAULT now() NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS "farmer_onboarding_drafts" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"step" integer DEFAULT 1 NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "farmer_onboarding_drafts_user_id_unique" UNIQUE("user_id")
);
CREATE TABLE IF NOT EXISTS "farmer_profiles" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"full_name" varchar(200) NOT NULL,
	"phone" varchar(20) NOT NULL,
	"nin" varchar(30),
	"bvn" varchar(30),
	"state" varchar(100) NOT NULL,
	"lga" varchar(100) NOT NULL,
	"kyc_status" "farmer_kyc_status" DEFAULT 'PENDING' NOT NULL,
	"kyc_documents" text,
	"kyc_reviewed_at" timestamp,
	"kyc_reviewed_by" integer,
	"kyc_notes" text,
	"bank_name" varchar(100),
	"bank_account_number" varchar(30),
	"bank_account_name" varchar(200),
	"mobile_money_provider" varchar(50),
	"mobile_money_number" varchar(20),
	"onboarding_step" integer DEFAULT 1 NOT NULL,
	"onboarding_completed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "farmer_profiles_user_id_unique" UNIQUE("user_id")
);
CREATE TABLE IF NOT EXISTS "futures_contracts" (
	"id" serial PRIMARY KEY NOT NULL,
	"symbol" varchar(32) NOT NULL,
	"underlying_asset" varchar(64) NOT NULL,
	"asset_class" varchar(32) DEFAULT 'COMMODITY' NOT NULL,
	"contract_size" numeric(18, 6) NOT NULL,
	"tick_size" numeric(18, 8) NOT NULL,
	"currency" varchar(8) DEFAULT 'NGN' NOT NULL,
	"expiry_date" timestamp NOT NULL,
	"settlement_date" timestamp NOT NULL,
	"initial_margin_pct" numeric(8, 4) DEFAULT '0.10' NOT NULL,
	"maintenance_margin_pct" numeric(8, 4) DEFAULT '0.07' NOT NULL,
	"last_settlement_price" numeric(20, 8),
	"last_mark_price" numeric(20, 8),
	"status" varchar(16) DEFAULT 'ACTIVE' NOT NULL,
	"created_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "futures_contracts_symbol_unique" UNIQUE("symbol")
);
CREATE TABLE IF NOT EXISTS "futures_positions" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"contract_id" integer NOT NULL,
	"side" varchar(8) NOT NULL,
	"quantity" numeric(18, 6) NOT NULL,
	"entry_price" numeric(20, 8) NOT NULL,
	"current_mark_price" numeric(20, 8),
	"unrealized_pnl" numeric(20, 8) DEFAULT '0' NOT NULL,
	"realized_pnl" numeric(20, 8) DEFAULT '0' NOT NULL,
	"margin_posted" numeric(20, 8) NOT NULL,
	"liquidation_price" numeric(20, 8),
	"status" varchar(16) DEFAULT 'OPEN' NOT NULL,
	"opened_at" timestamp DEFAULT now() NOT NULL,
	"closed_at" timestamp,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS "futures_settlements" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"contract_id" integer NOT NULL,
	"settlement_type" varchar(16) NOT NULL,
	"settlement_price" numeric(20, 8) NOT NULL,
	"total_long_pnl" numeric(20, 8) DEFAULT '0' NOT NULL,
	"total_short_pnl" numeric(20, 8) DEFAULT '0' NOT NULL,
	"positions_settled" integer DEFAULT 0 NOT NULL,
	"settled_by" integer,
	"settled_at" timestamp DEFAULT now() NOT NULL,
	"notes" text
);
CREATE TABLE IF NOT EXISTS "ip_allowlist" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"cidr" varchar(50) NOT NULL,
	"label" varchar(128) NOT NULL,
	"scope" "ip_allowlist_scope" DEFAULT 'GLOBAL_ADMIN' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS "ir_documents" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"company_symbol" varchar(16) NOT NULL,
	"company_name" varchar(128) NOT NULL,
	"document_type" "ir_document_type" NOT NULL,
	"title" varchar(256) NOT NULL,
	"description" text,
	"fiscal_year" integer,
	"fiscal_period" varchar(16),
	"file_url" varchar(512) NOT NULL,
	"file_key" varchar(512) NOT NULL,
	"file_size_bytes" integer,
	"mime_type" varchar(64) DEFAULT 'application/pdf' NOT NULL,
	"download_count" integer DEFAULT 0 NOT NULL,
	"is_published" boolean DEFAULT false NOT NULL,
	"published_at" timestamp,
	"created_by" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS "ir_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"company_symbol" varchar(16) NOT NULL,
	"company_name" varchar(128) NOT NULL,
	"event_type" "ir_event_type" NOT NULL,
	"title" varchar(256) NOT NULL,
	"description" text,
	"event_date" timestamp NOT NULL,
	"is_all_day" boolean DEFAULT true NOT NULL,
	"venue" varchar(256),
	"webcast_url" varchar(512),
	"dividend_per_share" numeric(20, 6),
	"dividend_currency" varchar(8),
	"ex_dividend_date" timestamp,
	"record_date" timestamp,
	"payment_date" timestamp,
	"eps_actual" numeric(20, 6),
	"eps_estimate" numeric(20, 6),
	"revenue_actual" numeric(20, 2),
	"revenue_estimate" numeric(20, 2),
	"is_published" boolean DEFAULT false NOT NULL,
	"published_at" timestamp,
	"created_by" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS "ir_subscriptions" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"company_symbol" varchar(16) NOT NULL,
	"notify_earnings" boolean DEFAULT true NOT NULL,
	"notify_dividends" boolean DEFAULT true NOT NULL,
	"notify_documents" boolean DEFAULT true NOT NULL,
	"notify_events" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS "kyc_analysis_results" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"stakeholder_type" text NOT NULL,
	"document_url" text NOT NULL,
	"selfie_url" text,
	"is_pdf" boolean DEFAULT false,
	"ocr_extracted_fields" text,
	"ocr_avg_confidence" real,
	"ocr_line_count" integer,
	"document_authenticity_score" real,
	"document_type" text,
	"document_risk_flags" text,
	"selfie_overall_score" real,
	"selfie_liveness_assessment" text,
	"passive_liveness_score" real,
	"passive_liveness_flags" text,
	"overall_score" real,
	"overall_risk_level" "kyc_risk_level" DEFAULT 'UNKNOWN',
	"all_risk_flags" text,
	"recommendation" text,
	"analysed_at" timestamp DEFAULT now() NOT NULL,
	"service_version" text DEFAULT '1.0.0'
);
CREATE TABLE IF NOT EXISTS "kyc_audit_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"stakeholder_type" "kyc_audit_stakeholder" NOT NULL,
	"profile_id" integer NOT NULL,
	"reviewer_id" integer NOT NULL,
	"reviewer_name" text,
	"decision" "kyc_audit_decision" NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS "kyc_queue" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"status" "kyc_queue_status" DEFAULT 'PENDING' NOT NULL,
	"reviewed_by" integer,
	"review_notes" text,
	"documents" json,
	"submitted_at" timestamp DEFAULT now() NOT NULL,
	"reviewed_at" timestamp
);
CREATE TABLE IF NOT EXISTS "listing_messages" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"listing_id" integer NOT NULL,
	"sender_id" integer NOT NULL,
	"recipient_id" integer NOT NULL,
	"message" text NOT NULL,
	"is_read" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS "live_prices" (
	"id" serial PRIMARY KEY NOT NULL,
	"symbol" varchar(64) NOT NULL,
	"name" varchar(128) NOT NULL,
	"price" numeric(18, 6) NOT NULL,
	"previous_close" numeric(18, 6),
	"change_amount" numeric(18, 6),
	"change_pct" numeric(10, 4),
	"high" numeric(18, 6),
	"low" numeric(18, 6),
	"currency" varchar(8) DEFAULT 'USD' NOT NULL,
	"source" varchar(32) DEFAULT 'yahoo' NOT NULL,
	"yahoo_symbol" varchar(32),
	"asset_class" varchar(32) DEFAULT 'COMMODITY' NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "live_prices_symbol_unique" UNIQUE("symbol")
);
CREATE TABLE IF NOT EXISTS "margin_accounts" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"status" "margin_account_status" DEFAULT 'ACTIVE' NOT NULL,
	"cash_balance" numeric(18, 2) DEFAULT '0' NOT NULL,
	"total_collateral_value" numeric(18, 2) DEFAULT '0' NOT NULL,
	"used_margin" numeric(18, 2) DEFAULT '0' NOT NULL,
	"available_margin" numeric(18, 2) DEFAULT '0' NOT NULL,
	"margin_call_level" numeric(5, 2) DEFAULT '30' NOT NULL,
	"currency" varchar(8) DEFAULT 'NGN' NOT NULL,
	"last_margin_call_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "margin_accounts_user_id_unique" UNIQUE("user_id")
);
CREATE TABLE IF NOT EXISTS "margin_call_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"margin_call_id" bigint NOT NULL,
	"event_type" "margin_call_event_type" NOT NULL,
	"amount" numeric(20, 2),
	"equity_ratio_after" numeric(8, 6),
	"performed_by" integer,
	"occurred_at" timestamp DEFAULT now() NOT NULL,
	"notes" text
);
CREATE TABLE IF NOT EXISTS "margin_calls" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"clearing_account_id" bigint NOT NULL,
	"user_id" integer NOT NULL,
	"call_ref" varchar(32) NOT NULL,
	"status" "margin_call_status" DEFAULT 'OPEN' NOT NULL,
	"equity_ratio_at_call" numeric(8, 6) NOT NULL,
	"portfolio_value_at_call" numeric(20, 2) NOT NULL,
	"margin_deficit" numeric(20, 2) NOT NULL,
	"amount_required" numeric(20, 2) NOT NULL,
	"amount_received" numeric(20, 2) DEFAULT '0' NOT NULL,
	"issued_at" timestamp DEFAULT now() NOT NULL,
	"due_at" timestamp NOT NULL,
	"resolved_at" timestamp,
	"auto_liquidation_triggered_at" timestamp,
	"issued_by" integer,
	"notes" text,
	CONSTRAINT "margin_calls_call_ref_unique" UNIQUE("call_ref")
);
CREATE TABLE IF NOT EXISTS "market_maker_obligations" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"market_maker_id" bigint NOT NULL,
	"instrument" varchar(32) NOT NULL,
	"asset_class" varchar(32) NOT NULL,
	"min_bid_size" numeric(20, 8) NOT NULL,
	"min_ask_size" numeric(20, 8) NOT NULL,
	"max_spread_bps" integer NOT NULL,
	"min_uptime_pct" numeric(5, 2) DEFAULT '90.00' NOT NULL,
	"penalty_per_breach_ngn" numeric(20, 2) DEFAULT '50000.00' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"effective_from" timestamp NOT NULL,
	"effective_to" timestamp,
	"created_by" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS "market_maker_onboarding_profiles" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"firm_name" varchar(200) NOT NULL,
	"trading_desk" varchar(200),
	"contact_phone" varchar(30),
	"contact_email" varchar(200),
	"years_of_operation" integer,
	"regulatory_registrations" text,
	"instrument_obligations" text[],
	"min_quote_size_lots" numeric(12, 2),
	"max_spread_bps" numeric(8, 2),
	"capital_commitment_ngn" numeric(18, 2),
	"performance_bond_ngn" numeric(18, 2),
	"firm_registration_url" text,
	"trading_license_url" text,
	"capital_adequacy_url" text,
	"kyc_status" "mm_onboarding_kyc_status" DEFAULT 'PENDING' NOT NULL,
	"kyc_notes" text,
	"account_status" "mm_onboarding_account_status" DEFAULT 'INACTIVE' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "market_maker_onboarding_profiles_user_id_unique" UNIQUE("user_id")
);
CREATE TABLE IF NOT EXISTS "market_maker_performance_reports" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"market_maker_id" bigint NOT NULL,
	"obligation_id" bigint NOT NULL,
	"instrument" varchar(32) NOT NULL,
	"report_date" varchar(16) NOT NULL,
	"total_snapshots" integer DEFAULT 0 NOT NULL,
	"compliant_snapshots" integer DEFAULT 0 NOT NULL,
	"uptime_pct" numeric(5, 2) DEFAULT '0' NOT NULL,
	"avg_spread_bps" integer DEFAULT 0,
	"max_spread_bps" integer DEFAULT 0,
	"spread_breaches" integer DEFAULT 0 NOT NULL,
	"size_breaches" integer DEFAULT 0 NOT NULL,
	"absence_breaches" integer DEFAULT 0 NOT NULL,
	"total_breaches" integer DEFAULT 0 NOT NULL,
	"penalty_amount" numeric(20, 2) DEFAULT '0' NOT NULL,
	"penalty_status" varchar(32) DEFAULT 'PENDING' NOT NULL,
	"generated_at" timestamp DEFAULT now() NOT NULL,
	"reviewed_by" integer,
	"reviewed_at" timestamp,
	"notes" text
);
CREATE TABLE IF NOT EXISTS "market_maker_profiles" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"firm_name" varchar(128) NOT NULL,
	"license_number" varchar(64),
	"asset_classes" text NOT NULL,
	"instruments" text NOT NULL,
	"status" varchar(32) DEFAULT 'ACTIVE' NOT NULL,
	"approved_by" integer,
	"approved_at" timestamp,
	"suspended_at" timestamp,
	"suspension_reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "market_maker_profiles_user_id_unique" UNIQUE("user_id")
);
CREATE TABLE IF NOT EXISTS "market_maker_quote_snapshots" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"market_maker_id" bigint NOT NULL,
	"obligation_id" bigint NOT NULL,
	"instrument" varchar(32) NOT NULL,
	"snapshot_at" timestamp DEFAULT now() NOT NULL,
	"bid_price" numeric(20, 8),
	"ask_price" numeric(20, 8),
	"bid_size" numeric(20, 8),
	"ask_size" numeric(20, 8),
	"spread_bps" integer,
	"is_compliant" boolean NOT NULL,
	"breach_type" varchar(64),
	"trading_session_date" varchar(16) NOT NULL
);
CREATE TABLE IF NOT EXISTS "mfa_otp_codes" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"method" "mfa_method" NOT NULL,
	"code_hash" varchar(64) NOT NULL,
	"expires_at" timestamp NOT NULL,
	"used_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS "mojaloop_callbacks" (
	"id" serial PRIMARY KEY NOT NULL,
	"callback_type" varchar(64) NOT NULL,
	"resource_id" varchar(64) NOT NULL,
	"source_fsp_id" varchar(64),
	"payload" json NOT NULL,
	"http_status" integer DEFAULT 200 NOT NULL,
	"processed" boolean DEFAULT false NOT NULL,
	"processed_at" timestamp,
	"error_message" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS "mojaloop_dead_letter" (
	"id" serial PRIMARY KEY NOT NULL,
	"transfer_id" varchar(64) NOT NULL,
	"payer_fsp_id" varchar(64) NOT NULL,
	"payee_fsp_id" varchar(64) NOT NULL,
	"payer_identifier" varchar(128) NOT NULL,
	"payee_identifier" varchar(128) NOT NULL,
	"amount" numeric(18, 6) NOT NULL,
	"currency" varchar(8) NOT NULL,
	"status" varchar(32) DEFAULT 'FAILED' NOT NULL,
	"error_message" text,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"last_retry_at" timestamp,
	"resolved" boolean DEFAULT false NOT NULL,
	"resolved_at" timestamp,
	"resolved_by" varchar(128),
	"raw_payload" json,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS "mojaloop_dfsps" (
	"id" serial PRIMARY KEY NOT NULL,
	"fsp_id" varchar(64) NOT NULL,
	"name" varchar(128) NOT NULL,
	"country" varchar(4),
	"currencies" json DEFAULT '[]'::json,
	"is_active" boolean DEFAULT true NOT NULL,
	"endpoint_url" varchar(256),
	"callback_url" varchar(256),
	"tier" "dfsp_tier" DEFAULT 'STANDARD',
	"status" varchar(32) DEFAULT 'ACTIVE',
	"currency" varchar(8) DEFAULT 'NGN',
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "mojaloop_dfsps_fsp_id_unique" UNIQUE("fsp_id")
);
CREATE TABLE IF NOT EXISTS "mojaloop_fee_schedules" (
	"id" serial PRIMARY KEY NOT NULL,
	"tier_name" "dfsp_tier" NOT NULL,
	"currency" varchar(8) NOT NULL,
	"flat_fee" numeric(18, 6) DEFAULT '0' NOT NULL,
	"percentage_fee" numeric(8, 4) DEFAULT '0' NOT NULL,
	"min_fee" numeric(18, 6) DEFAULT '0' NOT NULL,
	"max_fee" numeric(18, 6),
	"effective_from" timestamp DEFAULT now() NOT NULL,
	"effective_to" timestamp,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS "mojaloop_parties" (
	"id" serial PRIMARY KEY NOT NULL,
	"party_id_type" varchar(32) NOT NULL,
	"party_identifier" varchar(128) NOT NULL,
	"fsp_id" varchar(64) NOT NULL,
	"first_name" varchar(128),
	"last_name" varchar(128),
	"date_of_birth" varchar(16),
	"merchant_class_code" varchar(16),
	"currency" varchar(8) DEFAULT 'USD' NOT NULL,
	"supported_currencies" json DEFAULT '[]'::json,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS "mojaloop_quotes" (
	"id" serial PRIMARY KEY NOT NULL,
	"quote_id" varchar(64) NOT NULL,
	"transaction_id" varchar(64) NOT NULL,
	"payer_fsp_id" varchar(64) NOT NULL,
	"payee_fsp_id" varchar(64) NOT NULL,
	"payer_identifier" varchar(128) NOT NULL,
	"payee_identifier" varchar(128) NOT NULL,
	"amount_type" varchar(16) DEFAULT 'SEND' NOT NULL,
	"amount" numeric(18, 6) NOT NULL,
	"currency" varchar(8) NOT NULL,
	"fee_amount" numeric(18, 6) DEFAULT '0',
	"fee_currency" varchar(8),
	"transfer_amount" numeric(18, 6),
	"ilp_packet" text,
	"condition" varchar(256),
	"expiration" timestamp,
	"status" "mojaloop_quote_status" DEFAULT 'PENDING' NOT NULL,
	"reject_reason" text,
	"nexcom_settlement_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "mojaloop_quotes_quote_id_unique" UNIQUE("quote_id")
);
CREATE TABLE IF NOT EXISTS "mojaloop_transfers" (
	"id" serial PRIMARY KEY NOT NULL,
	"transfer_id" varchar(64) NOT NULL,
	"quote_id" varchar(64),
	"payer_fsp_id" varchar(64) NOT NULL,
	"payee_fsp_id" varchar(64) NOT NULL,
	"payer_identifier" varchar(128) NOT NULL,
	"payee_identifier" varchar(128) NOT NULL,
	"amount" numeric(18, 6) NOT NULL,
	"currency" varchar(8) NOT NULL,
	"ilp_packet" text,
	"condition" varchar(256),
	"fulfilment" varchar(256),
	"expiration" timestamp,
	"status" "mojaloop_transfer_status" DEFAULT 'PENDING' NOT NULL,
	"error_code" varchar(8),
	"error_description" text,
	"nexcom_settlement_id" integer,
	"nexcom_order_id" integer,
	"reserved_at" timestamp,
	"committed_at" timestamp,
	"aborted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "mojaloop_transfers_transfer_id_unique" UNIQUE("transfer_id")
);
CREATE TABLE IF NOT EXISTS "open_interest_snapshots" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"contract_id" integer NOT NULL,
	"snapshot_date" timestamp DEFAULT now() NOT NULL,
	"total_long_qty" numeric(18, 6) DEFAULT '0' NOT NULL,
	"total_short_qty" numeric(18, 6) DEFAULT '0' NOT NULL,
	"open_interest" numeric(18, 6) DEFAULT '0' NOT NULL,
	"daily_volume" numeric(18, 6) DEFAULT '0' NOT NULL,
	"settlement_price" numeric(20, 8)
);
CREATE TABLE IF NOT EXISTS "options_contracts" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"symbol" varchar(50) NOT NULL,
	"underlying_contract_id" integer,
	"option_type" "option_type" NOT NULL,
	"strike_price" numeric(20, 8) NOT NULL,
	"expiry_date" timestamp NOT NULL,
	"contract_size" numeric(18, 6) DEFAULT '1' NOT NULL,
	"risk_free_rate" numeric(10, 6) DEFAULT '0.05' NOT NULL,
	"implied_volatility" numeric(10, 6) DEFAULT '0.20' NOT NULL,
	"last_price" numeric(20, 8),
	"open_interest" integer DEFAULT 0 NOT NULL,
	"status" "option_status" DEFAULT 'ACTIVE' NOT NULL,
	"created_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "options_contracts_symbol_unique" UNIQUE("symbol")
);
CREATE TABLE IF NOT EXISTS "options_positions" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"contract_id" integer NOT NULL,
	"option_type" "option_type" NOT NULL,
	"quantity" numeric(18, 6) NOT NULL,
	"premium_paid" numeric(20, 8) NOT NULL,
	"total_cost" numeric(20, 8) NOT NULL,
	"strike_price" numeric(20, 8) NOT NULL,
	"expiry_date" timestamp NOT NULL,
	"status" "option_position_status" DEFAULT 'OPEN' NOT NULL,
	"exercised_at" timestamp,
	"settlement_pnl" numeric(20, 8),
	"opened_at" timestamp DEFAULT now() NOT NULL,
	"closed_at" timestamp
);
CREATE TABLE IF NOT EXISTS "order_amendments" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"order_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"old_qty" numeric(18, 6) NOT NULL,
	"new_qty" numeric(18, 6) NOT NULL,
	"old_price" numeric(18, 6),
	"new_price" numeric(18, 6),
	"reason" text,
	"is_bulk" boolean DEFAULT false NOT NULL,
	"amended_at" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS "order_book_levels" (
	"id" serial PRIMARY KEY NOT NULL,
	"symbol" varchar(32) NOT NULL,
	"side" varchar(4) NOT NULL,
	"price" numeric(18, 6) NOT NULL,
	"quantity" numeric(18, 6) NOT NULL,
	"order_count" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS "orders" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"symbol" varchar(32) NOT NULL,
	"asset_class" "asset_class" DEFAULT 'COMMODITY' NOT NULL,
	"side" "order_side" NOT NULL,
	"order_type" "order_type" NOT NULL,
	"quantity" numeric(18, 6) NOT NULL,
	"price" numeric(18, 6),
	"stop_price" numeric(18, 6),
	"filled_qty" numeric(18, 6) DEFAULT '0' NOT NULL,
	"avg_fill_price" numeric(18, 6),
	"status" "order_status" DEFAULT 'OPEN' NOT NULL,
	"time_in_force" varchar(8) DEFAULT 'GTC' NOT NULL,
	"client_order_id" varchar(64),
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp
);
CREATE TABLE IF NOT EXISTS "participant_performance_metrics" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"participant_type" varchar(32) NOT NULL,
	"period_year" integer NOT NULL,
	"period_month" integer NOT NULL,
	"trade_count" integer DEFAULT 0 NOT NULL,
	"volume_usd" numeric(20, 2) DEFAULT '0' NOT NULL,
	"client_count" integer DEFAULT 0 NOT NULL,
	"avg_spread" numeric(10, 4),
	"uptime_pct" numeric(5, 2),
	"rating" numeric(3, 2),
	"compliance_score" integer DEFAULT 100,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS "platform_settings" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"key" varchar(128) NOT NULL,
	"value" text NOT NULL,
	"description" text,
	"updated_by" integer,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "platform_settings_key_unique" UNIQUE("key")
);
CREATE TABLE IF NOT EXISTS "portfolio_equity_snapshots" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"snapshot_date" timestamp NOT NULL,
	"spot_pnl" numeric(20, 8) DEFAULT '0' NOT NULL,
	"futures_pnl" numeric(20, 8) DEFAULT '0' NOT NULL,
	"options_pnl" numeric(20, 8) DEFAULT '0' NOT NULL,
	"cash_balance" numeric(20, 8) DEFAULT '0' NOT NULL,
	"total_equity" numeric(20, 8) DEFAULT '0' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS "portfolio_snapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"snapshot_date" timestamp NOT NULL,
	"total_value" numeric(18, 2) DEFAULT '0' NOT NULL,
	"total_cost" numeric(18, 2) DEFAULT '0' NOT NULL,
	"realized_pnl" numeric(18, 2) DEFAULT '0' NOT NULL,
	"unrealized_pnl" numeric(18, 2) DEFAULT '0' NOT NULL,
	"currency" varchar(8) DEFAULT 'NGN' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS "positions" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"symbol" varchar(32) NOT NULL,
	"asset_class" "asset_class" DEFAULT 'COMMODITY' NOT NULL,
	"quantity" numeric(18, 6) DEFAULT '0' NOT NULL,
	"avg_cost" numeric(18, 6) DEFAULT '0' NOT NULL,
	"realized_pnl" numeric(18, 6) DEFAULT '0' NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS "pre_trade_risk_checks" (
	"id" serial PRIMARY KEY NOT NULL,
	"order_id" bigint NOT NULL,
	"user_id" integer NOT NULL,
	"symbol" varchar(32) NOT NULL,
	"check_type" varchar(32) NOT NULL,
	"passed" boolean NOT NULL,
	"required_margin" numeric(18, 6),
	"available_margin" numeric(18, 6),
	"current_position" numeric(18, 6),
	"position_limit" numeric(18, 6),
	"reject_reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS "profiles" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"account_type" "account_type" DEFAULT 'TRADER' NOT NULL,
	"first_name" varchar(64),
	"last_name" varchar(64),
	"phone" varchar(20),
	"nin" varchar(20),
	"bvn" varchar(20),
	"address" text,
	"state" varchar(64),
	"country" varchar(64) DEFAULT 'Nigeria',
	"company_name" varchar(256),
	"rc_number" varchar(64),
	"tax_id" varchar(64),
	"kyc_status" "kyc_status" DEFAULT 'PENDING' NOT NULL,
	"kyc_notes" text,
	"bank_name" varchar(128),
	"bank_account" varchar(20),
	"stakeholder_type" "stakeholder_type",
	"metadata" json,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "profiles_user_id_unique" UNIQUE("user_id")
);
CREATE TABLE IF NOT EXISTS "push_subscriptions" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"endpoint" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"enable_price_alerts" boolean DEFAULT true NOT NULL,
	"enable_trade_fills" boolean DEFAULT true NOT NULL,
	"enable_system_alerts" boolean DEFAULT false NOT NULL,
	"user_agent" text,
	"device_label" varchar(100),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "push_subscriptions_endpoint_unique" UNIQUE("endpoint")
);
CREATE TABLE IF NOT EXISTS "rate_limit_counters" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"action" varchar(64) NOT NULL,
	"window_start" timestamp NOT NULL,
	"count" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS "re_kyc_flags" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"stakeholder_type" "re_kyc_stakeholder_type" NOT NULL,
	"profile_id" integer NOT NULL,
	"reason" text NOT NULL,
	"kyc_approved_at" timestamp,
	"notified_at" timestamp,
	"resolved_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS "regulatory_report_schedules" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"report_type" varchar(64) NOT NULL,
	"asset_class" varchar(32),
	"format" varchar(8) DEFAULT 'CSV' NOT NULL,
	"frequency" varchar(32) NOT NULL,
	"day_of_week" integer,
	"day_of_month" integer,
	"time_utc" varchar(8) DEFAULT '15:00' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_run_at" timestamp,
	"next_run_at" timestamp,
	"created_by" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS "regulatory_reports" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"report_type" varchar(64) NOT NULL,
	"report_date" timestamp NOT NULL,
	"period_start" timestamp NOT NULL,
	"period_end" timestamp NOT NULL,
	"asset_class" varchar(32),
	"format" varchar(8) DEFAULT 'CSV' NOT NULL,
	"status" varchar(32) DEFAULT 'PENDING' NOT NULL,
	"row_count" integer DEFAULT 0,
	"file_size" integer DEFAULT 0,
	"content" text,
	"error_message" text,
	"generated_by" integer NOT NULL,
	"schedule_id" bigint,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS "sar_reports" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"flag_id" bigint,
	"user_id" integer NOT NULL,
	"report_number" varchar(64) NOT NULL,
	"subject_name" varchar(256),
	"subject_id" varchar(128),
	"activity_type" varchar(128) NOT NULL,
	"activity_description" text NOT NULL,
	"total_amount" numeric(20, 2),
	"currency" varchar(8) DEFAULT 'NGN',
	"activity_start_date" timestamp,
	"activity_end_date" timestamp,
	"filed_by" integer NOT NULL,
	"filed_at" timestamp DEFAULT now() NOT NULL,
	"status" varchar(32) DEFAULT 'DRAFT' NOT NULL,
	"regulatory_ref" varchar(128),
	"exported_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "sar_reports_report_number_unique" UNIQUE("report_number")
);
CREATE TABLE IF NOT EXISTS "security_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"event_type" "security_event_type" NOT NULL,
	"severity" "security_event_severity" NOT NULL,
	"status" "security_event_status" DEFAULT 'OPEN' NOT NULL,
	"title" varchar(256) NOT NULL,
	"description" text NOT NULL,
	"metadata" json,
	"ip_address" varchar(45),
	"resolved_by" integer,
	"resolved_at" timestamp,
	"resolution_notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS "settlement_cycles" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"cycle_date" timestamp NOT NULL,
	"settlement_type" varchar(8) DEFAULT 'T+1' NOT NULL,
	"asset_class" varchar(32) DEFAULT 'COMMODITY' NOT NULL,
	"status" varchar(32) DEFAULT 'OPEN' NOT NULL,
	"total_trades" integer DEFAULT 0,
	"matched_trades" integer DEFAULT 0,
	"failed_trades" integer DEFAULT 0,
	"gross_value" numeric(24, 2) DEFAULT '0',
	"net_value" numeric(24, 2) DEFAULT '0',
	"currency" varchar(8) DEFAULT 'NGN',
	"created_by" integer NOT NULL,
	"opened_at" timestamp DEFAULT now() NOT NULL,
	"matched_at" timestamp,
	"settled_at" timestamp,
	"closed_at" timestamp,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS "settlement_disputes" (
	"id" serial PRIMARY KEY NOT NULL,
	"settlement_id" bigint NOT NULL,
	"raised_by" integer NOT NULL,
	"assigned_to" integer,
	"status" "dispute_status" DEFAULT 'OPEN' NOT NULL,
	"reason" text NOT NULL,
	"evidence" text,
	"resolution" "dispute_resolution",
	"resolution_notes" text,
	"resolved_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"resolved_at" timestamp,
	"sla_deadline" timestamp,
	"sla_breached" boolean DEFAULT false NOT NULL
);
CREATE TABLE IF NOT EXISTS "settlement_fails" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"instruction_id" bigint NOT NULL,
	"cycle_id" bigint NOT NULL,
	"fail_type" varchar(32) NOT NULL,
	"failed_party_user_id" integer NOT NULL,
	"penalty_amount" numeric(20, 2) DEFAULT '0',
	"currency" varchar(8) DEFAULT 'NGN',
	"status" varchar(32) DEFAULT 'OPEN' NOT NULL,
	"escalated_to" varchar(128),
	"escalated_at" timestamp,
	"resolved_at" timestamp,
	"resolution_notes" text,
	"reviewed_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS "settlement_instructions" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"cycle_id" bigint NOT NULL,
	"buyer_user_id" integer NOT NULL,
	"seller_user_id" integer NOT NULL,
	"order_id" bigint,
	"instrument" varchar(64) NOT NULL,
	"quantity" numeric(20, 6) NOT NULL,
	"price" numeric(20, 6) NOT NULL,
	"total_value" numeric(20, 2) NOT NULL,
	"currency" varchar(8) DEFAULT 'NGN',
	"instruction_type" varchar(16) DEFAULT 'DVP' NOT NULL,
	"status" varchar(32) DEFAULT 'PENDING' NOT NULL,
	"failure_reason" text,
	"confirmed_at" timestamp,
	"settled_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS "settlement_positions" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"cycle_id" bigint NOT NULL,
	"user_id" integer NOT NULL,
	"instrument" varchar(64) NOT NULL,
	"gross_buy_qty" numeric(20, 6) DEFAULT '0',
	"gross_sell_qty" numeric(20, 6) DEFAULT '0',
	"net_qty" numeric(20, 6) DEFAULT '0',
	"gross_buy_value" numeric(20, 2) DEFAULT '0',
	"gross_sell_value" numeric(20, 2) DEFAULT '0',
	"net_cash_obligation" numeric(20, 2) DEFAULT '0',
	"currency" varchar(8) DEFAULT 'NGN',
	"status" varchar(32) DEFAULT 'PENDING' NOT NULL,
	"confirmed_at" timestamp,
	"settled_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS "settlements" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"order_id" bigint NOT NULL,
	"user_id" integer NOT NULL,
	"symbol" varchar(32) NOT NULL,
	"asset_class" "asset_class" DEFAULT 'COMMODITY' NOT NULL,
	"side" "order_side" NOT NULL,
	"quantity" numeric(18, 6) NOT NULL,
	"price" numeric(18, 6) NOT NULL,
	"gross_amount" numeric(18, 2) NOT NULL,
	"fee" numeric(18, 2) DEFAULT '0' NOT NULL,
	"net_amount" numeric(18, 2) NOT NULL,
	"currency" varchar(8) DEFAULT 'NGN' NOT NULL,
	"status" "settlement_status" DEFAULT 'PENDING' NOT NULL,
	"settlement_date" timestamp,
	"counterparty_id" integer,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS "shareholder_registry" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"company_symbol" varchar(16) NOT NULL,
	"user_id" integer NOT NULL,
	"shareholder_name" varchar(128) NOT NULL,
	"shareholder_type" varchar(32) DEFAULT 'INDIVIDUAL' NOT NULL,
	"shares_held" numeric(20, 0) NOT NULL,
	"total_shares" numeric(20, 0) NOT NULL,
	"holding_pct" numeric(10, 6) NOT NULL,
	"acquisition_date" timestamp,
	"last_updated_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS "totp_secrets" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"secret" varchar(64) NOT NULL,
	"is_enabled" boolean DEFAULT false NOT NULL,
	"confirmed_at" timestamp,
	"backup_codes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "totp_secrets_user_id_unique" UNIQUE("user_id")
);
CREATE TABLE IF NOT EXISTS "trade_fills" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"aggressor_order_id" bigint NOT NULL,
	"resting_order_id" bigint NOT NULL,
	"symbol" varchar(32) NOT NULL,
	"asset_class" varchar(32) NOT NULL,
	"buyer_user_id" integer NOT NULL,
	"seller_user_id" integer NOT NULL,
	"filled_qty" numeric(18, 6) NOT NULL,
	"fill_price" numeric(18, 6) NOT NULL,
	"gross_value" numeric(18, 6) NOT NULL,
	"buyer_fee" numeric(18, 6) DEFAULT '0' NOT NULL,
	"seller_fee" numeric(18, 6) DEFAULT '0' NOT NULL,
	"settlement_id" bigint,
	"sequence_no" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS "trader_profiles" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"full_name" varchar(200) NOT NULL,
	"phone" varchar(30) NOT NULL,
	"nin" varchar(50),
	"bvn" varchar(50),
	"email" varchar(200),
	"address" text,
	"state" varchar(100),
	"lga" varchar(100),
	"trading_experience" "trader_experience" DEFAULT 'BEGINNER' NOT NULL,
	"preferred_markets" text[],
	"capital_range" varchar(50),
	"risk_profile" "trader_risk_profile" DEFAULT 'MODERATE' NOT NULL,
	"id_document_url" text,
	"proof_of_address_url" text,
	"bank_statement_url" text,
	"bank_name" varchar(200),
	"account_number" varchar(30),
	"kyc_status" "trader_kyc_status" DEFAULT 'PENDING' NOT NULL,
	"kyc_notes" text,
	"account_status" "trader_account_status" DEFAULT 'INACTIVE' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "trader_profiles_user_id_unique" UNIQUE("user_id")
);
CREATE TABLE IF NOT EXISTS "user_mfa_settings" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"mfa_required" boolean DEFAULT false NOT NULL,
	"primary_method" "mfa_method",
	"totp_enabled" boolean DEFAULT false NOT NULL,
	"webauthn_enabled" boolean DEFAULT false NOT NULL,
	"sms_enabled" boolean DEFAULT false NOT NULL,
	"email_otp_enabled" boolean DEFAULT false NOT NULL,
	"phone_number" varchar(20),
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_mfa_settings_user_id_unique" UNIQUE("user_id")
);
CREATE TABLE IF NOT EXISTS "user_preferences" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"currency" varchar(8) DEFAULT 'NGN' NOT NULL,
	"language" varchar(16) DEFAULT 'en' NOT NULL,
	"theme" varchar(16) DEFAULT 'dark' NOT NULL,
	"timezone" varchar(64) DEFAULT 'Africa/Lagos' NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"notif_trade_executions" boolean DEFAULT true NOT NULL,
	"notif_price_alerts" boolean DEFAULT true NOT NULL,
	"notif_ewr_updates" boolean DEFAULT true NOT NULL,
	"notif_deposit_updates" boolean DEFAULT true NOT NULL,
	"notif_delivery_updates" boolean DEFAULT true NOT NULL,
	"notif_system_messages" boolean DEFAULT false NOT NULL,
	"notif_email" boolean DEFAULT true NOT NULL,
	"notif_sms" boolean DEFAULT false NOT NULL,
	"notif_push" boolean DEFAULT true NOT NULL,
	CONSTRAINT "user_preferences_user_id_unique" UNIQUE("user_id")
);
CREATE TABLE IF NOT EXISTS "velocity_ledger" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"amount" numeric(20, 2) NOT NULL,
	"currency" varchar(8) DEFAULT 'NGN' NOT NULL,
	"reference" varchar(128),
	"recorded_at" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS "velocity_limit_config" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"window_hours" integer DEFAULT 24 NOT NULL,
	"max_amount" numeric(20, 2) NOT NULL,
	"currency" varchar(8) DEFAULT 'NGN' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS "warehouse_messages" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"warehouse_id" varchar(50) NOT NULL,
	"warehouse_name" varchar(200) NOT NULL,
	"subject" varchar(300) NOT NULL,
	"body" text NOT NULL,
	"status" "warehouse_message_status" DEFAULT 'SENT' NOT NULL,
	"reply_body" text,
	"replied_at" timestamp,
	"read_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS "warehouse_operator_profiles" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"facility_name" varchar(200) NOT NULL,
	"facility_address" text NOT NULL,
	"state" varchar(100) NOT NULL,
	"lga" varchar(100),
	"gps_lat" numeric(10, 7),
	"gps_lng" numeric(10, 7),
	"storage_capacity_mt" numeric(12, 2),
	"commodities_handled" text[],
	"nwr_cert_number" varchar(100),
	"nwr_cert_doc_url" text,
	"facility_inspection_url" text,
	"insurance_doc_url" text,
	"grading_staff_count" integer,
	"operating_hours" varchar(100),
	"accepted_grades" text[],
	"kyc_status" "warehouse_op_kyc_status" DEFAULT 'PENDING' NOT NULL,
	"kyc_notes" text,
	"account_status" "warehouse_op_account_status" DEFAULT 'INACTIVE' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "warehouse_operator_profiles_user_id_unique" UNIQUE("user_id")
);
CREATE TABLE IF NOT EXISTS "warehouse_receipts" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"receipt_number" varchar(64) NOT NULL,
	"commodity" varchar(64) NOT NULL,
	"grade" varchar(32),
	"quantity" numeric(18, 6) NOT NULL,
	"unit" varchar(16) NOT NULL,
	"warehouse_id" varchar(64),
	"warehouse_name" varchar(256),
	"deposit_date" timestamp DEFAULT now() NOT NULL,
	"expiry_date" timestamp,
	"status" "warehouse_receipt_status" DEFAULT 'ACTIVE' NOT NULL,
	"value_usd" numeric(18, 2),
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "warehouse_receipts_receipt_number_unique" UNIQUE("receipt_number")
);
CREATE TABLE IF NOT EXISTS "wash_trade_flags" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"instrument" varchar(32) NOT NULL,
	"asset_class" varchar(32) NOT NULL,
	"buy_order_id" bigint,
	"sell_order_id" bigint,
	"buy_price" numeric(20, 8),
	"sell_price" numeric(20, 8),
	"quantity" numeric(20, 8),
	"window_minutes" integer NOT NULL,
	"detected_at" timestamp DEFAULT now() NOT NULL,
	"status" varchar(16) DEFAULT 'PENDING' NOT NULL,
	"reviewed_by" integer,
	"reviewed_at" timestamp,
	"review_notes" text,
	"penalty_applied" boolean DEFAULT false NOT NULL
);
CREATE TABLE IF NOT EXISTS "webauthn_challenges" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"challenge" text NOT NULL,
	"type" varchar(16) NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS "webauthn_credentials" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"credential_id" text NOT NULL,
	"public_key" text NOT NULL,
	"sign_count" integer DEFAULT 0 NOT NULL,
	"device_name" varchar(128) DEFAULT 'Passkey' NOT NULL,
	"aaguid" varchar(36),
	"uv_capable" boolean DEFAULT false NOT NULL,
	"resident_key" boolean DEFAULT false NOT NULL,
	"transports" text,
	"last_used_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "webauthn_credentials_credential_id_unique" UNIQUE("credential_id")
);
CREATE TABLE IF NOT EXISTS "webhook_configs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"name" varchar(128) NOT NULL,
	"url" varchar(2048) NOT NULL,
	"secret" varchar(256),
	"event_filter" "webhook_event_filter" DEFAULT 'HIGH_AND_CRITICAL' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_triggered_at" timestamp,
	"last_status_code" integer,
	"failure_count" integer DEFAULT 0 NOT NULL,
	"created_by" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS "withdrawal_verifications" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"amount" numeric(18, 2) NOT NULL,
	"challenge_text" varchar(512) NOT NULL,
	"expected_answer" varchar(512) NOT NULL,
	"status" "withdrawal_verification_status" DEFAULT 'PENDING' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"verified_at" timestamp,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
DO $$ BEGIN
  CREATE UNIQUE INDEX IF NOT EXISTS "fee_schedule_tier_currency_idx" ON "mojaloop_fee_schedules" USING btree ("tier_name","currency");
EXCEPTION WHEN duplicate_table OR duplicate_object OR undefined_column OR undefined_table THEN
  RAISE NOTICE 'index fee_schedule_tier_currency_idx skipped: %', SQLERRM;
END $$;

-- ---- 0001_tan_talkback.sql ----
DO $$ BEGIN
  CREATE TYPE "public"."abcp_status" AS ENUM('STRUCTURING', 'SEC_REVIEW', 'APPROVED', 'ISSUED', 'TRADING', 'MATURED', 'DEFAULTED', 'CANCELLED');
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'type abcp_status already exists, skipping';
END $$;
DO $$ BEGIN
  CREATE TYPE "public"."bank_financing_status" AS ENUM('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'DISBURSED', 'REPAYING', 'CLOSED', 'DEFAULTED');
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'type bank_financing_status already exists, skipping';
END $$;
DO $$ BEGIN
  CREATE TYPE "public"."crop_report_type" AS ENUM('PLANTING_PROGRESS', 'CROP_CONDITIONS', 'YIELD_FORECAST', 'HARVEST_PROGRESS', 'STORAGE_STOCKS', 'PRICE_OUTLOOK');
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'type crop_report_type already exists, skipping';
END $$;
DO $$ BEGIN
  CREATE TYPE "public"."field_agent_status" AS ENUM('PENDING', 'ACTIVE', 'SUSPENDED', 'TERMINATED');
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'type field_agent_status already exists, skipping';
END $$;
DO $$ BEGIN
  CREATE TYPE "public"."field_visit_status" AS ENUM('SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'NO_SHOW');
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'type field_visit_status already exists, skipping';
END $$;
DO $$ BEGIN
  CREATE TYPE "public"."field_visit_type" AS ENUM('ONBOARDING', 'CROP_INSPECTION', 'LOAN_ASSESSMENT', 'HARVEST_VERIFICATION', 'REPAYMENT_COLLECTION', 'FOLLOW_UP');
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'type field_visit_type already exists, skipping';
END $$;
DO $$ BEGIN
  CREATE TYPE "public"."fixed_income_status" AS ENUM('ACTIVE', 'MATURED', 'DEFAULTED', 'CALLED', 'SUSPENDED');
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'type fixed_income_status already exists, skipping';
END $$;
DO $$ BEGIN
  CREATE TYPE "public"."fixed_income_type" AS ENUM('TREASURY_BILL', 'TREASURY_BOND', 'CORPORATE_BOND', 'ABCP', 'SUKUK', 'COMMERCIAL_PAPER', 'AGRI_BOND', 'GREEN_BOND');
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'type fixed_income_type already exists, skipping';
END $$;
DO $$ BEGIN
  CREATE TYPE "public"."input_financing_status" AS ENUM('APPLIED', 'APPROVED', 'DISBURSED', 'IN_USE', 'REPAYING', 'REPAID', 'DEFAULTED', 'WRITTEN_OFF');
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'type input_financing_status already exists, skipping';
END $$;
DO $$ BEGIN
  CREATE TYPE "public"."input_type" AS ENUM('SEEDS', 'FERTILIZER', 'PESTICIDE', 'HERBICIDE', 'EQUIPMENT', 'IRRIGATION', 'STORAGE', 'CASH');
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'type input_type already exists, skipping';
END $$;
DO $$ BEGIN
  CREATE TYPE "public"."workbench_crop_season" AS ENUM('WET_SEASON', 'DRY_SEASON', 'YEAR_ROUND');
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'type workbench_crop_season already exists, skipping';
END $$;
DO $$ BEGIN
  CREATE TYPE "public"."workbench_farm_status" AS ENUM('ACTIVE', 'FALLOW', 'HARVESTED', 'ABANDONED');
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'type workbench_farm_status already exists, skipping';
END $$;
CREATE TABLE IF NOT EXISTS "abcp_programs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"program_name" varchar(300) NOT NULL,
	"isin" varchar(20),
	"sponsor_name" varchar(200) NOT NULL,
	"sponsor_user_id" integer,
	"arranger_name" varchar(200),
	"program_size_ngn" numeric(22, 2) NOT NULL,
	"outstanding_ngn" numeric(22, 2) DEFAULT '0',
	"collateral_type" varchar(100) NOT NULL,
	"collateral_value_ngn" numeric(22, 2),
	"coverage_ratio_pct" numeric(6, 2),
	"yield_pct" numeric(8, 4),
	"tenor_days" integer NOT NULL,
	"issue_date" timestamp,
	"maturity_date" timestamp,
	"credit_rating" varchar(10),
	"rating_agency" varchar(50),
	"status" "abcp_status" DEFAULT 'STRUCTURING' NOT NULL,
	"sec_approval_ref" varchar(100),
	"prospectus_url" text,
	"underlying_ewr_ids" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "abcp_programs_isin_unique" UNIQUE("isin")
);
CREATE TABLE IF NOT EXISTS "bank_financing_applications" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"bank_name" varchar(200) NOT NULL,
	"bank_code" varchar(20),
	"loan_purpose" varchar(100) NOT NULL,
	"requested_amount_ngn" numeric(18, 2) NOT NULL,
	"approved_amount_ngn" numeric(18, 2),
	"interest_rate_pct" numeric(6, 3),
	"tenor_months" integer,
	"collateral_ewr_id" integer,
	"collateral_value_ngn" numeric(18, 2),
	"status" "bank_financing_status" DEFAULT 'DRAFT' NOT NULL,
	"rejection_reason" text,
	"disbursed_at" timestamp,
	"repayment_due_date" timestamp,
	"external_reference_id" varchar(100),
	"documents" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS "commodity_index_history" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"index_id" integer NOT NULL,
	"value" numeric(10, 4) NOT NULL,
	"change_percent" numeric(8, 4),
	"volume" numeric(22, 2),
	"recorded_at" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS "commodity_indexes" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"ticker" varchar(20) NOT NULL,
	"name" varchar(200) NOT NULL,
	"description" text,
	"base_value" numeric(10, 4) DEFAULT '1000',
	"current_value" numeric(10, 4),
	"change_percent" numeric(8, 4),
	"components" jsonb,
	"calculation_method" varchar(50) DEFAULT 'PRICE_WEIGHTED',
	"rebalance_frequency" varchar(20) DEFAULT 'MONTHLY',
	"last_calculated_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "commodity_indexes_ticker_unique" UNIQUE("ticker")
);
CREATE TABLE IF NOT EXISTS "crop_production_reports" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"report_type" "crop_report_type" NOT NULL,
	"crop_symbol" varchar(20) NOT NULL,
	"crop_name" varchar(100) NOT NULL,
	"reporting_period" varchar(50) NOT NULL,
	"coverage_region" varchar(100) DEFAULT 'NIGERIA',
	"production_mt" numeric(14, 2),
	"yield_mt_per_ha" numeric(8, 4),
	"area_harvested_ha" numeric(14, 2),
	"stocks_mt" numeric(14, 2),
	"exports_mt" numeric(14, 2),
	"imports_mt" numeric(14, 2),
	"price_ngn_per_mt" numeric(12, 2),
	"price_change_percent" numeric(8, 4),
	"outlook_summary" text,
	"spatial_data_url" text,
	"published_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS "field_agents" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"agent_code" varchar(20) NOT NULL,
	"full_name" varchar(200) NOT NULL,
	"phone" varchar(20) NOT NULL,
	"state_of_operation" varchar(100),
	"lga_of_operation" varchar(100),
	"total_farmers_onboarded" integer DEFAULT 0,
	"total_loans_originated" integer DEFAULT 0,
	"total_loans_value_ngn" numeric(22, 2) DEFAULT '0',
	"commission_earned_ngn" numeric(18, 2) DEFAULT '0',
	"status" "field_agent_status" DEFAULT 'PENDING' NOT NULL,
	"supervisor_id" integer,
	"profile_photo_url" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "field_agents_user_id_unique" UNIQUE("user_id"),
	CONSTRAINT "field_agents_agent_code_unique" UNIQUE("agent_code")
);
CREATE TABLE IF NOT EXISTS "field_visits" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"agent_id" integer NOT NULL,
	"farmer_id" integer NOT NULL,
	"farm_id" integer,
	"visit_type" "field_visit_type" NOT NULL,
	"status" "field_visit_status" DEFAULT 'SCHEDULED' NOT NULL,
	"scheduled_at" timestamp NOT NULL,
	"started_at" timestamp,
	"completed_at" timestamp,
	"gps_latitude" numeric(10, 7),
	"gps_longitude" numeric(10, 7),
	"observations" text,
	"photo_urls" jsonb,
	"crop_condition" varchar(20),
	"estimated_yield_mt" numeric(10, 3),
	"loan_recommendation_ngn" numeric(18, 2),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS "fixed_income_instruments" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"isin" varchar(20),
	"ticker" varchar(20) NOT NULL,
	"name" varchar(300) NOT NULL,
	"issuer_name" varchar(200) NOT NULL,
	"type" "fixed_income_type" NOT NULL,
	"status" "fixed_income_status" DEFAULT 'ACTIVE' NOT NULL,
	"face_value_ngn" numeric(18, 2) NOT NULL,
	"coupon_rate_pct" numeric(8, 4),
	"yield_pct" numeric(8, 4),
	"maturity_date" timestamp NOT NULL,
	"issue_date" timestamp NOT NULL,
	"total_issuance_ngn" numeric(22, 2),
	"outstanding_ngn" numeric(22, 2),
	"credit_rating" varchar(10),
	"rating_agency" varchar(50),
	"collateral_description" text,
	"prospectus_url" text,
	"last_price_ngn" numeric(18, 4),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "fixed_income_instruments_isin_unique" UNIQUE("isin")
);
CREATE TABLE IF NOT EXISTS "fixed_income_trades" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"instrument_id" integer NOT NULL,
	"buyer_user_id" integer NOT NULL,
	"seller_user_id" integer,
	"face_value_ngn" numeric(18, 2) NOT NULL,
	"price_ngn" numeric(18, 4) NOT NULL,
	"yield_pct" numeric(8, 4),
	"settlement_date" timestamp,
	"trade_date" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS "input_financing_loans" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"farmer_id" integer NOT NULL,
	"agent_id" integer,
	"crop_plan_id" integer,
	"input_type" "input_type" NOT NULL,
	"input_description" text NOT NULL,
	"requested_value_ngn" numeric(18, 2) NOT NULL,
	"approved_value_ngn" numeric(18, 2),
	"disbursed_value_ngn" numeric(18, 2),
	"repaid_value_ngn" numeric(18, 2) DEFAULT '0',
	"interest_rate_pct" numeric(6, 3) DEFAULT '8.5',
	"tenor_months" integer DEFAULT 6,
	"status" "input_financing_status" DEFAULT 'APPLIED' NOT NULL,
	"collateral_ewr_id" integer,
	"repayment_method" varchar(50) DEFAULT 'HARVEST_DEDUCTION',
	"disbursed_at" timestamp,
	"repayment_due_date" timestamp,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS "input_financing_repayments" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"loan_id" integer NOT NULL,
	"amount_ngn" numeric(18, 2) NOT NULL,
	"method" varchar(50) NOT NULL,
	"reference" varchar(100),
	"paid_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS "workbench_crop_plans" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"farm_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"crop_symbol" varchar(20) NOT NULL,
	"crop_name" varchar(100) NOT NULL,
	"season" "workbench_crop_season" NOT NULL,
	"planting_date" timestamp,
	"expected_harvest_date" timestamp,
	"actual_harvest_date" timestamp,
	"planned_hectares" numeric(10, 2),
	"actual_hectares" numeric(10, 2),
	"expected_yield_mt" numeric(10, 3),
	"actual_yield_mt" numeric(10, 3),
	"input_cost_ngn" numeric(18, 2),
	"revenue_ngn" numeric(18, 2),
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS "workbench_farms" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"farm_name" varchar(200) NOT NULL,
	"location_state" varchar(100),
	"location_lga" varchar(100),
	"location_address" text,
	"coordinates" geometry(Point,4326),
	"total_hectares" numeric(10, 2),
	"soil_type" varchar(50),
	"irrigation_type" varchar(50),
	"status" "workbench_farm_status" DEFAULT 'ACTIVE' NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS "workbench_soil_tests" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"farm_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"test_date" timestamp DEFAULT now() NOT NULL,
	"ph_level" numeric(4, 2),
	"nitrogen_ppm" numeric(8, 2),
	"phosphorus_ppm" numeric(8, 2),
	"potassium_ppm" numeric(8, 2),
	"organic_matter_pct" numeric(5, 2),
	"recommendations" text,
	"lab_name" varchar(200),
	"report_url" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);

-- ---- 0002_light_amazoness.sql ----
DO $$ BEGIN
  CREATE TYPE "public"."push_platform" AS ENUM('ios', 'android', 'web');
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'type push_platform already exists, skipping';
END $$;
CREATE TABLE IF NOT EXISTS "push_tokens" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"token" varchar(512) NOT NULL,
	"platform" "push_platform" NOT NULL,
	"device_name" varchar(128) DEFAULT 'Unknown' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "push_tokens_token_unique" UNIQUE("token")
);

-- ---- 0002_nexcom_warehouse_ops.sql ----
-- Migration: warehouse_receipts, deposit_requests, delivery_orders, api_keys
-- Created manually to match schema.ts definitions

DO $$ BEGIN
  CREATE TYPE "warehouse_receipt_status" AS ENUM('ACTIVE', 'PLEDGED', 'REDEEMED', 'CANCELLED');
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'type warehouse_receipt_status already exists, skipping';
END $$;
DO $$ BEGIN
  CREATE TYPE "deposit_status" AS ENUM('PENDING', 'RECEIVED', 'GRADED', 'STORED', 'REJECTED');
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'type deposit_status already exists, skipping';
END $$;
DO $$ BEGIN
  CREATE TYPE "delivery_status" AS ENUM('PENDING', 'SCHEDULED', 'IN_TRANSIT', 'DELIVERED', 'CANCELLED');
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'type delivery_status already exists, skipping';
END $$;
CREATE TABLE IF NOT EXISTS "warehouse_receipts" (
  "id" serial PRIMARY KEY NOT NULL,
  "user_id" integer NOT NULL,
  "receipt_number" varchar(64) NOT NULL UNIQUE,
  "commodity" varchar(64) NOT NULL,
  "grade" varchar(32),
  "quantity" numeric(18, 6) NOT NULL,
  "unit" varchar(16) NOT NULL,
  "warehouse_id" varchar(64),
  "warehouse_name" varchar(256),
  "deposit_date" timestamp DEFAULT now() NOT NULL,
  "expiry_date" timestamp,
  "status" "warehouse_receipt_status" DEFAULT 'ACTIVE' NOT NULL,
  "value_usd" numeric(18, 2),
  "notes" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS "api_keys" (
  "id" serial PRIMARY KEY NOT NULL,
  "user_id" integer NOT NULL,
  "name" varchar(128) NOT NULL,
  "key_hash" varchar(256) NOT NULL,
  "key_prefix" varchar(16) NOT NULL,
  "permissions" text[] NOT NULL DEFAULT '{}',
  "active" boolean DEFAULT true NOT NULL,
  "last_used_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "expires_at" timestamp
);

-- ---- 0003_gorgeous_stingray.sql ----
ALTER TYPE "public"."account_type" ADD VALUE IF NOT EXISTS 'WAREHOUSE_OPERATOR';
ALTER TYPE "public"."account_type" ADD VALUE IF NOT EXISTS 'MARKET_MAKER';
ALTER TYPE "public"."alert_condition" ADD VALUE IF NOT EXISTS 'CROSS_ABOVE';
ALTER TYPE "public"."alert_condition" ADD VALUE IF NOT EXISTS 'CROSS_BELOW';
CREATE TABLE IF NOT EXISTS "user_preferences" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"currency" varchar(8) DEFAULT 'NGN' NOT NULL,
	"language" varchar(16) DEFAULT 'en' NOT NULL,
	"theme" varchar(16) DEFAULT 'dark' NOT NULL,
	"timezone" varchar(64) DEFAULT 'Africa/Lagos' NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_preferences_user_id_unique" UNIQUE("user_id")
);
ALTER TABLE "profiles" ALTER COLUMN "account_type" SET DEFAULT 'TRADER';
DO $$ BEGIN
  ALTER TABLE "kyc_queue" ADD COLUMN IF NOT EXISTS "documents" json;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column documents skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "profiles" ADD COLUMN IF NOT EXISTS "first_name" varchar(64);
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column first_name skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "profiles" ADD COLUMN IF NOT EXISTS "last_name" varchar(64);
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column last_name skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "profiles" ADD COLUMN IF NOT EXISTS "address" text;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column address skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "profiles" ADD COLUMN IF NOT EXISTS "company_name" varchar(256);
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column company_name skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "profiles" ADD COLUMN IF NOT EXISTS "rc_number" varchar(64);
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column rc_number skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "profiles" ADD COLUMN IF NOT EXISTS "tax_id" varchar(64);
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column tax_id skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "profiles" ADD COLUMN IF NOT EXISTS "stakeholder_type" "stakeholder_type";
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column stakeholder_type skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "profiles" ADD COLUMN IF NOT EXISTS "metadata" json;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column metadata skipped: %', SQLERRM;
END $$;
ALTER TABLE "kyc_queue" DROP COLUMN "profile_id";
DO $$ BEGIN
  ALTER TABLE "profiles" ADD CONSTRAINT "profiles_user_id_unique" UNIQUE("user_id");
EXCEPTION WHEN duplicate_object OR duplicate_table OR undefined_column OR undefined_table
  OR datatype_mismatch OR foreign_key_violation OR feature_not_supported THEN
  RAISE NOTICE 'constraint profiles_user_id_unique skipped: %', SQLERRM;
END $$;

-- ---- 0004_nostalgic_echo.sql ----
CREATE TABLE IF NOT EXISTS "margin_accounts" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"status" "margin_account_status" DEFAULT 'ACTIVE' NOT NULL,
	"cash_balance" numeric(18, 2) DEFAULT '0' NOT NULL,
	"total_collateral_value" numeric(18, 2) DEFAULT '0' NOT NULL,
	"used_margin" numeric(18, 2) DEFAULT '0' NOT NULL,
	"available_margin" numeric(18, 2) DEFAULT '0' NOT NULL,
	"margin_call_level" numeric(5, 2) DEFAULT '30' NOT NULL,
	"currency" varchar(8) DEFAULT 'NGN' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "margin_accounts_user_id_unique" UNIQUE("user_id")
);
CREATE TABLE IF NOT EXISTS "settlement_disputes" (
	"id" serial PRIMARY KEY NOT NULL,
	"settlement_id" bigint NOT NULL,
	"raised_by" integer NOT NULL,
	"assigned_to" integer,
	"status" "dispute_status" DEFAULT 'OPEN' NOT NULL,
	"reason" text NOT NULL,
	"evidence" text,
	"resolution" "dispute_resolution",
	"resolution_notes" text,
	"resolved_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"resolved_at" timestamp
);

-- ---- 0005_cuddly_meggan.sql ----
ALTER TYPE "public"."notification_type" ADD VALUE IF NOT EXISTS 'MARGIN_CALL';
DO $$ BEGIN
  ALTER TABLE "margin_accounts" ADD COLUMN IF NOT EXISTS "last_margin_call_at" timestamp;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column last_margin_call_at skipped: %', SQLERRM;
END $$;

-- ---- 0006_thick_true_believers.sql ----
ALTER TYPE "public"."notification_type" ADD VALUE IF NOT EXISTS 'LIQUIDATED';
ALTER TYPE "public"."notification_type" ADD VALUE IF NOT EXISTS 'SECURITY_ALERT';
DO $$ BEGIN
  ALTER TABLE "settlement_disputes" ADD COLUMN IF NOT EXISTS "sla_deadline" timestamp;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column sla_deadline skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "settlement_disputes" ADD COLUMN IF NOT EXISTS "sla_breached" boolean DEFAULT false NOT NULL;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column sla_breached skipped: %', SQLERRM;
END $$;

-- ---- 0013_salty_starhawk.sql ----
CREATE TABLE IF NOT EXISTS "circuit_breaker_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"rule_id" integer NOT NULL,
	"instrument" varchar(32) NOT NULL,
	"asset_class" varchar(32) NOT NULL,
	"trigger_pct" numeric(8, 4) NOT NULL,
	"price_before" numeric(20, 8) NOT NULL,
	"price_after" numeric(20, 8) NOT NULL,
	"actual_move_pct" numeric(8, 4) NOT NULL,
	"halted_at" timestamp DEFAULT now() NOT NULL,
	"halt_until" timestamp NOT NULL,
	"lifted_at" timestamp,
	"lifted_by" integer,
	"status" varchar(16) DEFAULT 'ACTIVE' NOT NULL,
	"notes" text
);

-- ---- 0014_majestic_white_queen.sql ----
ALTER TABLE "circuit_breaker_events" ALTER COLUMN "rule_id" DROP NOT NULL;

-- ---- 0017_known_swarm.sql ----
CREATE TABLE IF NOT EXISTS "farm_profiles" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"farm_name" varchar(200) NOT NULL,
	"size_hectares" numeric(10, 2) NOT NULL,
	"latitude" numeric(10, 7),
	"longitude" numeric(10, 7),
	"state" varchar(100) NOT NULL,
	"lga" varchar(100) NOT NULL,
	"soil_type" "soil_type" DEFAULT 'LOAMY' NOT NULL,
	"description" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS "farmer_profiles" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"full_name" varchar(200) NOT NULL,
	"phone" varchar(20) NOT NULL,
	"nin" varchar(30),
	"bvn" varchar(30),
	"state" varchar(100) NOT NULL,
	"lga" varchar(100) NOT NULL,
	"kyc_status" "farmer_kyc_status" DEFAULT 'PENDING' NOT NULL,
	"kyc_documents" text,
	"kyc_reviewed_at" timestamp,
	"kyc_reviewed_by" integer,
	"kyc_notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "farmer_profiles_user_id_unique" UNIQUE("user_id")
);

-- ---- 0023_certain_mastermind.sql ----
CREATE TABLE IF NOT EXISTS "mojaloop_dfsps" (
	"id" serial PRIMARY KEY NOT NULL,
	"fsp_id" varchar(64) NOT NULL,
	"name" varchar(128) NOT NULL,
	"country" varchar(4),
	"currencies" json DEFAULT '[]'::json,
	"is_active" boolean DEFAULT true NOT NULL,
	"endpoint_url" varchar(256),
	"callback_url" varchar(256),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "mojaloop_dfsps_fsp_id_unique" UNIQUE("fsp_id")
);

-- ---- 0026_fine_molecule_man.sql ----
DO $$ BEGIN
  ALTER TABLE "mojaloop_dfsps" ADD COLUMN IF NOT EXISTS "tier" "dfsp_tier" DEFAULT 'STANDARD';
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column tier skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "mojaloop_dfsps" ADD COLUMN IF NOT EXISTS "status" varchar(32) DEFAULT 'ACTIVE';
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column status skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "mojaloop_dfsps" ADD COLUMN IF NOT EXISTS "currency" varchar(8) DEFAULT 'NGN';
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column currency skipped: %', SQLERRM;
END $$;

-- ---- 0029_rainy_the_initiative.sql ----
DO $$ BEGIN
  ALTER TABLE "farmer_profiles" ADD COLUMN IF NOT EXISTS "bank_name" varchar(100);
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column bank_name skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "farmer_profiles" ADD COLUMN IF NOT EXISTS "bank_account_number" varchar(30);
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column bank_account_number skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "farmer_profiles" ADD COLUMN IF NOT EXISTS "bank_account_name" varchar(200);
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column bank_account_name skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "farmer_profiles" ADD COLUMN IF NOT EXISTS "mobile_money_provider" varchar(50);
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column mobile_money_provider skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "farmer_profiles" ADD COLUMN IF NOT EXISTS "mobile_money_number" varchar(20);
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column mobile_money_number skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "farmer_profiles" ADD COLUMN IF NOT EXISTS "onboarding_step" integer DEFAULT 1 NOT NULL;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column onboarding_step skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "farmer_profiles" ADD COLUMN IF NOT EXISTS "onboarding_completed_at" timestamp;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column onboarding_completed_at skipped: %', SQLERRM;
END $$;

-- ---- 0030_uneven_nightcrawler.sql ----
DO $$ BEGIN
  ALTER TABLE "farm_profiles" ADD COLUMN IF NOT EXISTS "boundary" jsonb;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column boundary skipped: %', SQLERRM;
END $$;

-- ---- 0031_glossy_phalanx.sql ----
DO $$ BEGIN
  ALTER TABLE "farm_profiles" ADD COLUMN IF NOT EXISTS "centroid" geometry(Point,4326);
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column centroid skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "farm_profiles" ADD COLUMN IF NOT EXISTS "geom" geometry(Polygon,4326);
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column geom skipped: %', SQLERRM;
END $$;

-- ---- 0034_spicy_starbolt.sql ----
CREATE TABLE IF NOT EXISTS "order_amendments" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"order_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"old_qty" numeric(18, 6) NOT NULL,
	"new_qty" numeric(18, 6) NOT NULL,
	"old_price" numeric(18, 6),
	"new_price" numeric(18, 6),
	"reason" text,
	"amended_at" timestamp DEFAULT now() NOT NULL
);

-- ---- 0035_whole_phalanx.sql ----
DO $$ BEGIN
  ALTER TABLE "order_amendments" ADD COLUMN IF NOT EXISTS "is_bulk" boolean DEFAULT false NOT NULL;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column is_bulk skipped: %', SQLERRM;
END $$;

-- ---- 0036_early_whizzer.sql ----
CREATE TABLE IF NOT EXISTS "warehouse_messages" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"warehouse_id" varchar(50) NOT NULL,
	"warehouse_name" varchar(200) NOT NULL,
	"subject" varchar(300) NOT NULL,
	"body" text NOT NULL,
	"status" "warehouse_message_status" DEFAULT 'SENT' NOT NULL,
	"reply_body" text,
	"replied_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

-- ---- 0037_happy_radioactive_man.sql ----
DO $$ BEGIN
  ALTER TABLE "user_preferences" ADD COLUMN IF NOT EXISTS "notif_trade_executions" boolean DEFAULT true NOT NULL;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column notif_trade_executions skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "user_preferences" ADD COLUMN IF NOT EXISTS "notif_price_alerts" boolean DEFAULT true NOT NULL;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column notif_price_alerts skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "user_preferences" ADD COLUMN IF NOT EXISTS "notif_ewr_updates" boolean DEFAULT true NOT NULL;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column notif_ewr_updates skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "user_preferences" ADD COLUMN IF NOT EXISTS "notif_deposit_updates" boolean DEFAULT true NOT NULL;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column notif_deposit_updates skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "user_preferences" ADD COLUMN IF NOT EXISTS "notif_delivery_updates" boolean DEFAULT true NOT NULL;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column notif_delivery_updates skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "user_preferences" ADD COLUMN IF NOT EXISTS "notif_system_messages" boolean DEFAULT false NOT NULL;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column notif_system_messages skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "user_preferences" ADD COLUMN IF NOT EXISTS "notif_email" boolean DEFAULT true NOT NULL;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column notif_email skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "user_preferences" ADD COLUMN IF NOT EXISTS "notif_sms" boolean DEFAULT false NOT NULL;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column notif_sms skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "user_preferences" ADD COLUMN IF NOT EXISTS "notif_push" boolean DEFAULT true NOT NULL;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column notif_push skipped: %', SQLERRM;
END $$;

-- ---- 0038_stiff_firestar.sql ----
DO $$ BEGIN
  ALTER TABLE "warehouse_messages" ADD COLUMN IF NOT EXISTS "read_at" timestamp;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column read_at skipped: %', SQLERRM;
END $$;

-- ---- 0039_pale_whizzer.sql ----
DO $$ BEGIN
  ALTER TABLE "live_prices" ADD COLUMN IF NOT EXISTS "volume" numeric(20, 2);
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column volume skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "live_prices" ADD COLUMN IF NOT EXISTS "bid_price" numeric(18, 6);
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column bid_price skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "live_prices" ADD COLUMN IF NOT EXISTS "ask_price" numeric(18, 6);
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column ask_price skipped: %', SQLERRM;
END $$;

-- ---- 0040_overconfident_synch.sql ----
ALTER TABLE "live_prices" DROP COLUMN "volume";
ALTER TABLE "live_prices" DROP COLUMN "bid_price";
ALTER TABLE "live_prices" DROP COLUMN "ask_price";

-- ---- 0042_tidy_genesis.sql ----
DO $$ BEGIN
  CREATE TYPE "public"."channel_contact_status" AS ENUM('ACTIVE', 'OPTED_OUT', 'BLOCKED');
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'type channel_contact_status already exists, skipping';
END $$;
DO $$ BEGIN
  CREATE TYPE "public"."telegram_contact_status" AS ENUM('ACTIVE', 'BLOCKED', 'OPTED_OUT');
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'type telegram_contact_status already exists, skipping';
END $$;
DO $$ BEGIN
  CREATE TYPE "public"."telegram_message_direction" AS ENUM('INBOUND', 'OUTBOUND');
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'type telegram_message_direction already exists, skipping';
END $$;
DO $$ BEGIN
  CREATE TYPE "public"."ussd_session_status" AS ENUM('ACTIVE', 'COMPLETED', 'TIMED_OUT', 'FAILED');
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'type ussd_session_status already exists, skipping';
END $$;
DO $$ BEGIN
  CREATE TYPE "public"."whatsapp_message_direction" AS ENUM('INBOUND', 'OUTBOUND');
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'type whatsapp_message_direction already exists, skipping';
END $$;
DO $$ BEGIN
  CREATE TYPE "public"."whatsapp_message_status" AS ENUM('QUEUED', 'SENT', 'DELIVERED', 'READ', 'FAILED');
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'type whatsapp_message_status already exists, skipping';
END $$;
CREATE TABLE IF NOT EXISTS "telegram_contacts" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"telegram_id" varchar(30) NOT NULL,
	"username" varchar(100),
	"first_name" varchar(100),
	"last_name" varchar(100),
	"status" "telegram_contact_status" DEFAULT 'ACTIVE' NOT NULL,
	"is_verified" boolean DEFAULT false NOT NULL,
	"verification_code" varchar(10),
	"verification_expires_at" timestamp,
	"alerts_enabled" boolean DEFAULT true NOT NULL,
	"price_alerts_enabled" boolean DEFAULT true NOT NULL,
	"trade_notifications_enabled" boolean DEFAULT true NOT NULL,
	"last_interaction_at" timestamp,
	"total_commands" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "telegram_contacts_telegram_id_unique" UNIQUE("telegram_id")
);
CREATE TABLE IF NOT EXISTS "telegram_messages" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"contact_id" integer NOT NULL,
	"telegram_message_id" integer,
	"direction" "telegram_message_direction" NOT NULL,
	"command" varchar(64),
	"text" text,
	"parse_mode" varchar(20) DEFAULT 'Markdown',
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS "ussd_pins" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"pin_hash" varchar(256) NOT NULL,
	"failed_attempts" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "ussd_pins_user_id_unique" UNIQUE("user_id")
);
CREATE TABLE IF NOT EXISTS "ussd_sessions" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"session_id" varchar(128) NOT NULL,
	"phone_number" varchar(20) NOT NULL,
	"user_id" integer,
	"service_code" varchar(20) DEFAULT '*347*99#',
	"network_code" varchar(20),
	"menu_path" text DEFAULT '',
	"current_menu" varchar(64) DEFAULT 'MAIN',
	"last_input" varchar(256),
	"status" "ussd_session_status" DEFAULT 'ACTIVE' NOT NULL,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"last_activity_at" timestamp DEFAULT now() NOT NULL,
	"ended_at" timestamp,
	"total_interactions" integer DEFAULT 0 NOT NULL,
	"metadata" jsonb,
	CONSTRAINT "ussd_sessions_session_id_unique" UNIQUE("session_id")
);
CREATE TABLE IF NOT EXISTS "whatsapp_contacts" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"phone_number" varchar(20) NOT NULL,
	"wa_id" varchar(30) NOT NULL,
	"display_name" varchar(200),
	"status" "channel_contact_status" DEFAULT 'ACTIVE' NOT NULL,
	"last_message_at" timestamp,
	"total_messages" integer DEFAULT 0 NOT NULL,
	"verification_token" varchar(64),
	"verified_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "whatsapp_contacts_phone_number_unique" UNIQUE("phone_number"),
	CONSTRAINT "whatsapp_contacts_wa_id_unique" UNIQUE("wa_id")
);
CREATE TABLE IF NOT EXISTS "whatsapp_messages" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"contact_id" integer NOT NULL,
	"wamid" varchar(256),
	"direction" "whatsapp_message_direction" NOT NULL,
	"message_type" varchar(30) DEFAULT 'text' NOT NULL,
	"body" text,
	"status" "whatsapp_message_status" DEFAULT 'QUEUED' NOT NULL,
	"error_code" varchar(20),
	"error_message" text,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "whatsapp_messages_wamid_unique" UNIQUE("wamid")
);

-- ---- 0043_furry_callisto.sql ----
DO $$ BEGIN
  ALTER TABLE "telegram_contacts" ADD COLUMN IF NOT EXISTS "market_broadcasts" boolean DEFAULT true NOT NULL;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column market_broadcasts skipped: %', SQLERRM;
END $$;

-- ---- 0044_clumsy_microbe.sql ----
DO $$ BEGIN
  CREATE TYPE "public"."bank_account_status" AS ENUM('ACTIVE', 'DORMANT', 'FROZEN', 'CLOSED');
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'type bank_account_status already exists, skipping';
END $$;
DO $$ BEGIN
  CREATE TYPE "public"."bank_account_type" AS ENUM('ESCROW', 'SETTLEMENT', 'SAVINGS', 'CURRENT', 'MARGIN');
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'type bank_account_type already exists, skipping';
END $$;
DO $$ BEGIN
  CREATE TYPE "public"."bank_transaction_type" AS ENUM('CREDIT', 'DEBIT', 'REVERSAL', 'FEE', 'INTEREST');
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'type bank_transaction_type already exists, skipping';
END $$;
CREATE TABLE IF NOT EXISTS "bank_accounts" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"account_ref" varchar(50) NOT NULL,
	"type" "bank_account_type" DEFAULT 'ESCROW' NOT NULL,
	"label" varchar(100) NOT NULL,
	"currency" varchar(10) DEFAULT 'NGN' NOT NULL,
	"balance_kobo" bigint DEFAULT 0 NOT NULL,
	"avail_balance_kobo" bigint DEFAULT 0 NOT NULL,
	"status" "bank_account_status" DEFAULT 'ACTIVE' NOT NULL,
	"cbs_account_id" varchar(100),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "bank_accounts_account_ref_unique" UNIQUE("account_ref")
);
CREATE TABLE IF NOT EXISTS "bank_transactions" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"account_id" bigint NOT NULL,
	"user_id" integer NOT NULL,
	"type" "bank_transaction_type" NOT NULL,
	"amount_kobo" bigint NOT NULL,
	"balance_after_kobo" bigint NOT NULL,
	"currency" varchar(10) DEFAULT 'NGN' NOT NULL,
	"narrative" text,
	"reference" varchar(100),
	"value_date" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);

-- ---- 0045_furry_quentin_quire.sql ----
DO $$ BEGIN
  CREATE TYPE "public"."stripe_payment_status" AS ENUM('PENDING', 'SUCCEEDED', 'FAILED', 'CANCELED', 'REFUNDED');
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'type stripe_payment_status already exists, skipping';
END $$;
DO $$ BEGIN
  CREATE TYPE "public"."stripe_payment_type" AS ENUM('DEPOSIT', 'WITHDRAWAL');
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'type stripe_payment_type already exists, skipping';
END $$;
CREATE TABLE IF NOT EXISTS "stripe_payments" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"stripe_payment_intent_id" varchar(128),
	"stripe_checkout_session_id" varchar(128),
	"type" "stripe_payment_type" DEFAULT 'DEPOSIT' NOT NULL,
	"amount_cents" integer NOT NULL,
	"currency" varchar(10) DEFAULT 'usd' NOT NULL,
	"status" "stripe_payment_status" DEFAULT 'PENDING' NOT NULL,
	"bank_transaction_id" bigint,
	"metadata" json,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "stripe_payments_stripe_payment_intent_id_unique" UNIQUE("stripe_payment_intent_id"),
	CONSTRAINT "stripe_payments_stripe_checkout_session_id_unique" UNIQUE("stripe_checkout_session_id")
);

-- ---- 0046_even_joseph.sql ----
DO $$ BEGIN
  ALTER TABLE "user_preferences" ADD COLUMN IF NOT EXISTS "biometric_enabled" boolean DEFAULT false NOT NULL;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column biometric_enabled skipped: %', SQLERRM;
END $$;

-- ---- 0047_tranquil_lady_vermin.sql ----
DO $$ BEGIN
  CREATE TYPE "public"."credit_score_model" AS ENUM('NEXCOM_AGRI_V1', 'BUREAU_CREDITCHEK', 'BUREAU_FIRSTCENTRAL', 'MANUAL');
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'type credit_score_model already exists, skipping';
END $$;
DO $$ BEGIN
  CREATE TYPE "public"."insurance_coverage_type" AS ENUM('YIELD_PROTECTION', 'REVENUE_PROTECTION', 'MULTI_PERIL', 'DROUGHT', 'FLOOD', 'PEST_DISEASE', 'FIRE', 'COMPREHENSIVE');
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'type insurance_coverage_type already exists, skipping';
END $$;
DO $$ BEGIN
  CREATE TYPE "public"."insurance_policy_status" AS ENUM('DRAFT', 'ACTIVE', 'EXPIRED', 'CANCELLED', 'CLAIMED', 'SETTLED');
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'type insurance_policy_status already exists, skipping';
END $$;
DO $$ BEGIN
  CREATE TYPE "public"."loan_event_type" AS ENUM('APPLIED', 'CREDIT_CHECKED', 'APPROVED', 'REJECTED', 'DISBURSED', 'REPAYMENT_RECEIVED', 'OVERDUE_NOTICE', 'DEFAULT_NOTICE', 'WRITTEN_OFF', 'RESTRUCTURED', 'CLOSED');
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'type loan_event_type already exists, skipping';
END $$;
DO $$ BEGIN
  CREATE TYPE "public"."repayment_status" AS ENUM('SCHEDULED', 'DUE', 'PAID', 'OVERDUE', 'WAIVED', 'WRITTEN_OFF');
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'type repayment_status already exists, skipping';
END $$;
CREATE TABLE IF NOT EXISTS "collateral_registry" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"loan_id" bigint,
	"owner_id" integer NOT NULL,
	"type" "collateral_type" NOT NULL,
	"status" "collateral_status" DEFAULT 'ACTIVE' NOT NULL,
	"description" text NOT NULL,
	"valuation_ngn" numeric(18, 2) NOT NULL,
	"ltv_pct" numeric(6, 3) DEFAULT '70',
	"registry_ref" varchar(100) NOT NULL,
	"ewr_id" integer,
	"land_title_ref" varchar(100),
	"document_urls" jsonb DEFAULT '[]',
	"valuation_date" timestamp,
	"expires_at" timestamp,
	"pledged_at" timestamp,
	"released_at" timestamp,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "collateral_registry_registry_ref_unique" UNIQUE("registry_ref")
);
CREATE TABLE IF NOT EXISTS "credit_scores" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"farmer_id" integer,
	"model" "credit_score_model" DEFAULT 'NEXCOM_AGRI_V1' NOT NULL,
	"score" integer NOT NULL,
	"band" varchar(20) NOT NULL,
	"max_loan_ngn" numeric(18, 2),
	"interest_rate_pct" numeric(6, 3),
	"factors" jsonb,
	"bureau_ref" varchar(100),
	"valid_until" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS "crop_insurance_policies" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"farmer_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"policy_ref" varchar(50) NOT NULL,
	"coverage_type" "insurance_coverage_type" NOT NULL,
	"status" "insurance_policy_status" DEFAULT 'DRAFT' NOT NULL,
	"crop_type" varchar(100) NOT NULL,
	"farm_id" integer,
	"covered_area_hectares" numeric(10, 4) NOT NULL,
	"sum_insured_ngn" numeric(18, 2) NOT NULL,
	"premium_ngn" numeric(18, 2) NOT NULL,
	"premium_paid_ngn" numeric(18, 2) DEFAULT '0',
	"deductible_pct" numeric(6, 3) DEFAULT '10',
	"season" varchar(50),
	"start_date" timestamp,
	"end_date" timestamp,
	"provider_name" varchar(100) DEFAULT 'NEXCOM Agri Insurance',
	"provider_policy_ref" varchar(100),
	"claim_amount_ngn" numeric(18, 2),
	"claim_settled_ngn" numeric(18, 2),
	"claimed_at" timestamp,
	"settled_at" timestamp,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "crop_insurance_policies_policy_ref_unique" UNIQUE("policy_ref")
);
CREATE TABLE IF NOT EXISTS "loan_lifecycle_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"loan_id" bigint NOT NULL,
	"event_type" "loan_event_type" NOT NULL,
	"performed_by" integer,
	"notes" text,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS "loan_repayment_schedules" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"loan_id" bigint NOT NULL,
	"installment_no" integer NOT NULL,
	"due_date" timestamp NOT NULL,
	"principal_ngn" numeric(18, 2) NOT NULL,
	"interest_ngn" numeric(18, 2) NOT NULL,
	"total_ngn" numeric(18, 2) NOT NULL,
	"paid_ngn" numeric(18, 2) DEFAULT '0',
	"status" "repayment_status" DEFAULT 'SCHEDULED' NOT NULL,
	"paid_at" timestamp,
	"payment_ref" varchar(100),
	"penalty_ngn" numeric(18, 2) DEFAULT '0',
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

-- ---- 0048_nexcom_schema_hardening.sql ----
-- Migration 0048: Schema hardening — FK constraints, indexes, json→jsonb, real→numeric, master tables
-- Generated by NEXCOM v44 schema audit

-- ─── 1. json → jsonb migrations ──────────────────────────────────────────────
ALTER TABLE "profiles" ALTER COLUMN "metadata" TYPE jsonb USING "metadata"::text::jsonb;
ALTER TABLE "notifications" ALTER COLUMN "metadata" TYPE jsonb USING "metadata"::text::jsonb;
ALTER TABLE "kyc_queue" ALTER COLUMN "documents" TYPE jsonb USING "documents"::text::jsonb;
ALTER TABLE "audit_log" ALTER COLUMN "details" TYPE jsonb USING "details"::text::jsonb;
ALTER TABLE "cooperative_bulk_uploads" ALTER COLUMN "errors" TYPE jsonb USING "errors"::text::jsonb;
ALTER TABLE "cooperative_bulk_uploads" ALTER COLUMN "created_application_ids" TYPE jsonb USING "created_application_ids"::text::jsonb;
ALTER TABLE "security_events" ALTER COLUMN "metadata" TYPE jsonb USING "metadata"::text::jsonb;
ALTER TABLE "mojaloop_parties" ALTER COLUMN "supported_currencies" TYPE jsonb USING "supported_currencies"::text::jsonb;
ALTER TABLE "mojaloop_callbacks" ALTER COLUMN "payload" TYPE jsonb USING "payload"::text::jsonb;
ALTER TABLE "mojaloop_dfsps" ALTER COLUMN "currencies" TYPE jsonb USING "currencies"::text::jsonb;
ALTER TABLE "mojaloop_dead_letter" ALTER COLUMN "raw_payload" TYPE jsonb USING "raw_payload"::text::jsonb;
ALTER TABLE "dfsp_kyc_records" ALTER COLUMN "documents_provided" TYPE jsonb USING "documents_provided"::text::jsonb;
ALTER TABLE "stripe_payments" ALTER COLUMN "metadata" TYPE jsonb USING "metadata"::text::jsonb;
-- ─── 2. real → numeric(8,4) migrations ───────────────────────────────────────
ALTER TABLE "kyc_analysis_results" ALTER COLUMN "ocr_avg_confidence" TYPE numeric(8,4) USING "ocr_avg_confidence"::numeric;
ALTER TABLE "kyc_analysis_results" ALTER COLUMN "document_authenticity_score" TYPE numeric(8,4) USING "document_authenticity_score"::numeric;
ALTER TABLE "kyc_analysis_results" ALTER COLUMN "selfie_overall_score" TYPE numeric(8,4) USING "selfie_overall_score"::numeric;
ALTER TABLE "kyc_analysis_results" ALTER COLUMN "passive_liveness_score" TYPE numeric(8,4) USING "passive_liveness_score"::numeric;
ALTER TABLE "kyc_analysis_results" ALTER COLUMN "overall_score" TYPE numeric(8,4) USING "overall_score"::numeric;
DO $$ BEGIN
  CREATE TYPE "instrument_status" AS ENUM ('ACTIVE', 'SUSPENDED', 'DELISTED', 'PENDING');
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'type instrument_status already exists, skipping';
END $$;
DO $$ BEGIN
  CREATE TYPE "instrument_asset_class" AS ENUM ('COMMODITY', 'FOREX', 'EQUITY', 'DIGITAL_ASSET', 'INDEX', 'FIXED_INCOME', 'DERIVATIVE');
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'type instrument_asset_class already exists, skipping';
END $$;
CREATE TABLE IF NOT EXISTS "instruments" (
  "id" serial PRIMARY KEY NOT NULL,
  "symbol" varchar(32) NOT NULL,
  "name" varchar(200) NOT NULL,
  "asset_class" "instrument_asset_class" NOT NULL,
  "base_currency" varchar(8) NOT NULL DEFAULT 'NGN',
  "quote_currency" varchar(8) NOT NULL DEFAULT 'NGN',
  "lot_size" numeric(18,6) NOT NULL DEFAULT '1',
  "min_lot_size" numeric(18,6) NOT NULL DEFAULT '1',
  "tick_size" numeric(18,6) NOT NULL DEFAULT '0.01',
  "price_band_pct" numeric(8,4) DEFAULT '10',
  "settlement_days" integer NOT NULL DEFAULT 2,
  "trading_hours_start" varchar(8) DEFAULT '09:30',
  "trading_hours_end" varchar(8) DEFAULT '16:00',
  "exchange" varchar(64) DEFAULT 'NEXCOM',
  "isin" varchar(20),
  "description" text,
  "status" "instrument_status" NOT NULL DEFAULT 'ACTIVE',
  "listed_at" timestamp DEFAULT now(),
  "delisted_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "instruments_symbol_unique" UNIQUE("symbol")
);
DO $$ BEGIN
  CREATE TYPE "warehouse_accreditation_status" AS ENUM ('PENDING', 'ACCREDITED', 'SUSPENDED', 'REVOKED');
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'type warehouse_accreditation_status already exists, skipping';
END $$;
CREATE TABLE IF NOT EXISTS "warehouses" (
  "id" serial PRIMARY KEY NOT NULL,
  "name" varchar(200) NOT NULL,
  "code" varchar(32) NOT NULL,
  "operator_id" integer,
  "address" text,
  "city" varchar(100),
  "state" varchar(100),
  "country" varchar(64) DEFAULT 'Nigeria',
  "gps_lat" numeric(10,7),
  "gps_lng" numeric(10,7),
  "capacity_mt" numeric(14,2),
  "available_capacity_mt" numeric(14,2),
  "accreditation_status" "warehouse_accreditation_status" NOT NULL DEFAULT 'PENDING',
  "accreditation_ref" varchar(100),
  "accreditation_expiry" timestamp,
  "phone" varchar(32),
  "email" varchar(128),
  "supported_commodities" jsonb,
  "insurance_policy_ref" varchar(100),
  "is_active" boolean NOT NULL DEFAULT true,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "warehouses_code_unique" UNIQUE("code")
);
DO $$ BEGIN
  -- ─── 5. Composite unique constraints ─────────────────────────────────────────
ALTER TABLE "positions" ADD CONSTRAINT "positions_user_symbol_unique" UNIQUE ("user_id", "symbol", "asset_class");
EXCEPTION WHEN duplicate_object OR duplicate_table OR undefined_column OR undefined_table
  OR datatype_mismatch OR foreign_key_violation OR feature_not_supported THEN
  RAISE NOTICE 'constraint positions_user_symbol_unique skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "watchlist" ADD CONSTRAINT "watchlist_user_symbol_unique" UNIQUE ("user_id", "symbol");
EXCEPTION WHEN duplicate_object OR duplicate_table OR undefined_column OR undefined_table
  OR datatype_mismatch OR foreign_key_violation OR feature_not_supported THEN
  RAISE NOTICE 'constraint watchlist_user_symbol_unique skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "order_book_levels" ADD CONSTRAINT "order_book_levels_symbol_side_price_unique" UNIQUE ("symbol", "side", "price");
EXCEPTION WHEN duplicate_object OR duplicate_table OR undefined_column OR undefined_table
  OR datatype_mismatch OR foreign_key_violation OR feature_not_supported THEN
  RAISE NOTICE 'constraint order_book_levels_symbol_side_price_unique skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "commodity_indexes" ADD CONSTRAINT "commodity_indexes_symbol_unique" UNIQUE ("symbol");
EXCEPTION WHEN duplicate_object OR duplicate_table OR undefined_column OR undefined_table
  OR datatype_mismatch OR foreign_key_violation OR feature_not_supported THEN
  RAISE NOTICE 'constraint commodity_indexes_symbol_unique skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "live_prices" ADD CONSTRAINT "live_prices_symbol_unique" UNIQUE ("symbol");
EXCEPTION WHEN duplicate_object OR duplicate_table OR undefined_column OR undefined_table
  OR datatype_mismatch OR foreign_key_violation OR feature_not_supported THEN
  RAISE NOTICE 'constraint live_prices_symbol_unique skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  -- ─── 6. Check constraints ─────────────────────────────────────────────────────
ALTER TABLE "orders" ADD CONSTRAINT "orders_quantity_positive" CHECK ("quantity" > 0);
EXCEPTION WHEN duplicate_object OR duplicate_table OR undefined_column OR undefined_table
  OR datatype_mismatch OR foreign_key_violation OR feature_not_supported THEN
  RAISE NOTICE 'constraint orders_quantity_positive skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "orders" ADD CONSTRAINT "orders_price_positive" CHECK ("price" IS NULL OR "price" > 0);
EXCEPTION WHEN duplicate_object OR duplicate_table OR undefined_column OR undefined_table
  OR datatype_mismatch OR foreign_key_violation OR feature_not_supported THEN
  RAISE NOTICE 'constraint orders_price_positive skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "positions" ADD CONSTRAINT "positions_quantity_nonneg" CHECK ("quantity" >= 0);
EXCEPTION WHEN duplicate_object OR duplicate_table OR undefined_column OR undefined_table
  OR datatype_mismatch OR foreign_key_violation OR feature_not_supported THEN
  RAISE NOTICE 'constraint positions_quantity_nonneg skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "margin_calls" ADD CONSTRAINT "margin_calls_amount_positive" CHECK ("amount_required" > 0);
EXCEPTION WHEN duplicate_object OR duplicate_table OR undefined_column OR undefined_table
  OR datatype_mismatch OR foreign_key_violation OR feature_not_supported THEN
  RAISE NOTICE 'constraint margin_calls_amount_positive skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "mojaloop_fee_schedules" ADD CONSTRAINT "fee_pct_range" CHECK ("percentage_fee" >= 0 AND "percentage_fee" <= 1);
EXCEPTION WHEN duplicate_object OR duplicate_table OR undefined_column OR undefined_table
  OR datatype_mismatch OR foreign_key_violation OR feature_not_supported THEN
  RAISE NOTICE 'constraint fee_pct_range skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "kyc_analysis_results" ADD CONSTRAINT "score_range" CHECK ("overall_score" IS NULL OR ("overall_score" >= 0 AND "overall_score" <= 1));
EXCEPTION WHEN duplicate_object OR duplicate_table OR undefined_column OR undefined_table
  OR datatype_mismatch OR foreign_key_violation OR feature_not_supported THEN
  RAISE NOTICE 'constraint score_range skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS "orders_user_id_idx" ON "orders" ("user_id");
EXCEPTION WHEN duplicate_table OR duplicate_object OR undefined_column OR undefined_table THEN
  RAISE NOTICE 'index orders_user_id_idx skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS "orders_symbol_status_idx" ON "orders" ("symbol", "status");
EXCEPTION WHEN duplicate_table OR duplicate_object OR undefined_column OR undefined_table THEN
  RAISE NOTICE 'index orders_symbol_status_idx skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS "orders_created_at_idx" ON "orders" ("created_at" DESC);
EXCEPTION WHEN duplicate_table OR duplicate_object OR undefined_column OR undefined_table THEN
  RAISE NOTICE 'index orders_created_at_idx skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS "trade_fills_order_id_idx" ON "trade_fills" ("order_id");
EXCEPTION WHEN duplicate_table OR duplicate_object OR undefined_column OR undefined_table THEN
  RAISE NOTICE 'index trade_fills_order_id_idx skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS "trade_fills_user_id_created_idx" ON "trade_fills" ("user_id", "created_at" DESC);
EXCEPTION WHEN duplicate_table OR duplicate_object OR undefined_column OR undefined_table THEN
  RAISE NOTICE 'index trade_fills_user_id_created_idx skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS "settlements_user_id_status_idx" ON "settlements" ("user_id", "status");
EXCEPTION WHEN duplicate_table OR duplicate_object OR undefined_column OR undefined_table THEN
  RAISE NOTICE 'index settlements_user_id_status_idx skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS "settlements_created_at_idx" ON "settlements" ("created_at" DESC);
EXCEPTION WHEN duplicate_table OR duplicate_object OR undefined_column OR undefined_table THEN
  RAISE NOTICE 'index settlements_created_at_idx skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS "notifications_user_id_read_idx" ON "notifications" ("user_id", "read");
EXCEPTION WHEN duplicate_table OR duplicate_object OR undefined_column OR undefined_table THEN
  RAISE NOTICE 'index notifications_user_id_read_idx skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS "notifications_created_at_idx" ON "notifications" ("created_at" DESC);
EXCEPTION WHEN duplicate_table OR duplicate_object OR undefined_column OR undefined_table THEN
  RAISE NOTICE 'index notifications_created_at_idx skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS "positions_user_id_idx" ON "positions" ("user_id");
EXCEPTION WHEN duplicate_table OR duplicate_object OR undefined_column OR undefined_table THEN
  RAISE NOTICE 'index positions_user_id_idx skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS "warehouse_receipts_user_id_idx" ON "warehouse_receipts" ("user_id");
EXCEPTION WHEN duplicate_table OR duplicate_object OR undefined_column OR undefined_table THEN
  RAISE NOTICE 'index warehouse_receipts_user_id_idx skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS "warehouse_receipts_status_idx" ON "warehouse_receipts" ("status");
EXCEPTION WHEN duplicate_table OR duplicate_object OR undefined_column OR undefined_table THEN
  RAISE NOTICE 'index warehouse_receipts_status_idx skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS "aml_flags_user_id_idx" ON "aml_flags" ("user_id");
EXCEPTION WHEN duplicate_table OR duplicate_object OR undefined_column OR undefined_table THEN
  RAISE NOTICE 'index aml_flags_user_id_idx skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS "aml_flags_status_flagged_idx" ON "aml_flags" ("status", "flagged_at" DESC);
EXCEPTION WHEN duplicate_table OR duplicate_object OR undefined_column OR undefined_table THEN
  RAISE NOTICE 'index aml_flags_status_flagged_idx skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS "kyc_queue_user_id_idx" ON "kyc_queue" ("user_id");
EXCEPTION WHEN duplicate_table OR duplicate_object OR undefined_column OR undefined_table THEN
  RAISE NOTICE 'index kyc_queue_user_id_idx skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS "kyc_queue_status_idx" ON "kyc_queue" ("status");
EXCEPTION WHEN duplicate_table OR duplicate_object OR undefined_column OR undefined_table THEN
  RAISE NOTICE 'index kyc_queue_status_idx skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS "audit_log_user_id_idx" ON "audit_log" ("user_id");
EXCEPTION WHEN duplicate_table OR duplicate_object OR undefined_column OR undefined_table THEN
  RAISE NOTICE 'index audit_log_user_id_idx skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS "audit_log_action_created_idx" ON "audit_log" ("action", "created_at" DESC);
EXCEPTION WHEN duplicate_table OR duplicate_object OR undefined_column OR undefined_table THEN
  RAISE NOTICE 'index audit_log_action_created_idx skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS "margin_calls_user_id_status_idx" ON "margin_calls" ("user_id", "status");
EXCEPTION WHEN duplicate_table OR duplicate_object OR undefined_column OR undefined_table THEN
  RAISE NOTICE 'index margin_calls_user_id_status_idx skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS "margin_calls_due_at_idx" ON "margin_calls" ("due_at");
EXCEPTION WHEN duplicate_table OR duplicate_object OR undefined_column OR undefined_table THEN
  RAISE NOTICE 'index margin_calls_due_at_idx skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS "bank_transactions_user_id_idx" ON "bank_transactions" ("user_id");
EXCEPTION WHEN duplicate_table OR duplicate_object OR undefined_column OR undefined_table THEN
  RAISE NOTICE 'index bank_transactions_user_id_idx skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS "bank_transactions_created_at_idx" ON "bank_transactions" ("created_at" DESC);
EXCEPTION WHEN duplicate_table OR duplicate_object OR undefined_column OR undefined_table THEN
  RAISE NOTICE 'index bank_transactions_created_at_idx skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS "price_alerts_user_id_idx" ON "price_alerts" ("user_id");
EXCEPTION WHEN duplicate_table OR duplicate_object OR undefined_column OR undefined_table THEN
  RAISE NOTICE 'index price_alerts_user_id_idx skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS "kyc_analysis_user_id_idx" ON "kyc_analysis_results" ("user_id");
EXCEPTION WHEN duplicate_table OR duplicate_object OR undefined_column OR undefined_table THEN
  RAISE NOTICE 'index kyc_analysis_user_id_idx skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS "mojaloop_transfers_status_idx" ON "mojaloop_transfers" ("status");
EXCEPTION WHEN duplicate_table OR duplicate_object OR undefined_column OR undefined_table THEN
  RAISE NOTICE 'index mojaloop_transfers_status_idx skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS "loan_events_loan_id_idx" ON "loan_lifecycle_events" ("loan_id");
EXCEPTION WHEN duplicate_table OR duplicate_object OR undefined_column OR undefined_table THEN
  RAISE NOTICE 'index loan_events_loan_id_idx skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS "sar_reports_user_id_idx" ON "sar_reports" ("user_id");
EXCEPTION WHEN duplicate_table OR duplicate_object OR undefined_column OR undefined_table THEN
  RAISE NOTICE 'index sar_reports_user_id_idx skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS "instruments_asset_class_status_idx" ON "instruments" ("asset_class", "status");
EXCEPTION WHEN duplicate_table OR duplicate_object OR undefined_column OR undefined_table THEN
  RAISE NOTICE 'index instruments_asset_class_status_idx skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS "warehouses_state_idx" ON "warehouses" ("state");
EXCEPTION WHEN duplicate_table OR duplicate_object OR undefined_column OR undefined_table THEN
  RAISE NOTICE 'index warehouses_state_idx skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS "warehouses_accreditation_idx" ON "warehouses" ("accreditation_status");
EXCEPTION WHEN duplicate_table OR duplicate_object OR undefined_column OR undefined_table THEN
  RAISE NOTICE 'index warehouses_accreditation_idx skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  -- ─── 8. FK constraints for core relationships ────────────────────────────────
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR duplicate_table OR undefined_column OR undefined_table
  OR datatype_mismatch OR foreign_key_violation OR feature_not_supported THEN
  RAISE NOTICE 'constraint profiles_user_id_fk skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "orders" ADD CONSTRAINT "orders_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object OR duplicate_table OR undefined_column OR undefined_table
  OR datatype_mismatch OR foreign_key_violation OR feature_not_supported THEN
  RAISE NOTICE 'constraint orders_user_id_fk skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "trade_fills" ADD CONSTRAINT "trade_fills_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object OR duplicate_table OR undefined_column OR undefined_table
  OR datatype_mismatch OR foreign_key_violation OR feature_not_supported THEN
  RAISE NOTICE 'constraint trade_fills_user_id_fk skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "positions" ADD CONSTRAINT "positions_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object OR duplicate_table OR undefined_column OR undefined_table
  OR datatype_mismatch OR foreign_key_violation OR feature_not_supported THEN
  RAISE NOTICE 'constraint positions_user_id_fk skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR duplicate_table OR undefined_column OR undefined_table
  OR datatype_mismatch OR foreign_key_violation OR feature_not_supported THEN
  RAISE NOTICE 'constraint notifications_user_id_fk skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "kyc_queue" ADD CONSTRAINT "kyc_queue_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object OR duplicate_table OR undefined_column OR undefined_table
  OR datatype_mismatch OR foreign_key_violation OR feature_not_supported THEN
  RAISE NOTICE 'constraint kyc_queue_user_id_fk skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "settlements" ADD CONSTRAINT "settlements_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object OR duplicate_table OR undefined_column OR undefined_table
  OR datatype_mismatch OR foreign_key_violation OR feature_not_supported THEN
  RAISE NOTICE 'constraint settlements_user_id_fk skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "margin_accounts" ADD CONSTRAINT "margin_accounts_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object OR duplicate_table OR undefined_column OR undefined_table
  OR datatype_mismatch OR foreign_key_violation OR feature_not_supported THEN
  RAISE NOTICE 'constraint margin_accounts_user_id_fk skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "clearing_accounts" ADD CONSTRAINT "clearing_accounts_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object OR duplicate_table OR undefined_column OR undefined_table
  OR datatype_mismatch OR foreign_key_violation OR feature_not_supported THEN
  RAISE NOTICE 'constraint clearing_accounts_user_id_fk skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "warehouse_receipts" ADD CONSTRAINT "warehouse_receipts_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object OR duplicate_table OR undefined_column OR undefined_table
  OR datatype_mismatch OR foreign_key_violation OR feature_not_supported THEN
  RAISE NOTICE 'constraint warehouse_receipts_user_id_fk skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "aml_flags" ADD CONSTRAINT "aml_flags_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object OR duplicate_table OR undefined_column OR undefined_table
  OR datatype_mismatch OR foreign_key_violation OR feature_not_supported THEN
  RAISE NOTICE 'constraint aml_flags_user_id_fk skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "sar_reports" ADD CONSTRAINT "sar_reports_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object OR duplicate_table OR undefined_column OR undefined_table
  OR datatype_mismatch OR foreign_key_violation OR feature_not_supported THEN
  RAISE NOTICE 'constraint sar_reports_user_id_fk skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object OR duplicate_table OR undefined_column OR undefined_table
  OR datatype_mismatch OR foreign_key_violation OR feature_not_supported THEN
  RAISE NOTICE 'constraint audit_log_user_id_fk skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR duplicate_table OR undefined_column OR undefined_table
  OR datatype_mismatch OR foreign_key_violation OR feature_not_supported THEN
  RAISE NOTICE 'constraint api_keys_user_id_fk skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "device_sessions" ADD CONSTRAINT "device_sessions_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR duplicate_table OR undefined_column OR undefined_table
  OR datatype_mismatch OR foreign_key_violation OR feature_not_supported THEN
  RAISE NOTICE 'constraint device_sessions_user_id_fk skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "webauthn_credentials" ADD CONSTRAINT "webauthn_credentials_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR duplicate_table OR undefined_column OR undefined_table
  OR datatype_mismatch OR foreign_key_violation OR feature_not_supported THEN
  RAISE NOTICE 'constraint webauthn_credentials_user_id_fk skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "user_mfa_settings" ADD CONSTRAINT "user_mfa_settings_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR duplicate_table OR undefined_column OR undefined_table
  OR datatype_mismatch OR foreign_key_violation OR feature_not_supported THEN
  RAISE NOTICE 'constraint user_mfa_settings_user_id_fk skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object OR duplicate_table OR undefined_column OR undefined_table
  OR datatype_mismatch OR foreign_key_violation OR feature_not_supported THEN
  RAISE NOTICE 'constraint bank_accounts_user_id_fk skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "stripe_payments" ADD CONSTRAINT "stripe_payments_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object OR duplicate_table OR undefined_column OR undefined_table
  OR datatype_mismatch OR foreign_key_violation OR feature_not_supported THEN
  RAISE NOTICE 'constraint stripe_payments_user_id_fk skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "credit_scores" ADD CONSTRAINT "credit_scores_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object OR duplicate_table OR undefined_column OR undefined_table
  OR datatype_mismatch OR foreign_key_violation OR feature_not_supported THEN
  RAISE NOTICE 'constraint credit_scores_user_id_fk skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "crop_insurance_policies" ADD CONSTRAINT "crop_insurance_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object OR duplicate_table OR undefined_column OR undefined_table
  OR datatype_mismatch OR foreign_key_violation OR feature_not_supported THEN
  RAISE NOTICE 'constraint crop_insurance_user_id_fk skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "warehouse_receipts" ADD CONSTRAINT "warehouse_receipts_warehouse_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object OR duplicate_table OR undefined_column OR undefined_table
  OR datatype_mismatch OR foreign_key_violation OR feature_not_supported THEN
  RAISE NOTICE 'constraint warehouse_receipts_warehouse_id_fk skipped: %', SQLERRM;
END $$;

-- ---- 0049_production_indexes.sql ----
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_orders_user_id ON orders(user_id);
EXCEPTION WHEN duplicate_table OR duplicate_object OR undefined_column OR undefined_table THEN
  RAISE NOTICE 'index idx_orders_user_id skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_orders_symbol ON orders(symbol);
EXCEPTION WHEN duplicate_table OR duplicate_object OR undefined_column OR undefined_table THEN
  RAISE NOTICE 'index idx_orders_symbol skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
EXCEPTION WHEN duplicate_table OR duplicate_object OR undefined_column OR undefined_table THEN
  RAISE NOTICE 'index idx_orders_status skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_orders_user_status ON orders(user_id, status);
EXCEPTION WHEN duplicate_table OR duplicate_object OR undefined_column OR undefined_table THEN
  RAISE NOTICE 'index idx_orders_user_status skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_orders_symbol_status ON orders(symbol, status);
EXCEPTION WHEN duplicate_table OR duplicate_object OR undefined_column OR undefined_table THEN
  RAISE NOTICE 'index idx_orders_symbol_status skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_orders_symbol_side_status ON orders(symbol, side, status);
EXCEPTION WHEN duplicate_table OR duplicate_object OR undefined_column OR undefined_table THEN
  RAISE NOTICE 'index idx_orders_symbol_side_status skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at DESC);
EXCEPTION WHEN duplicate_table OR duplicate_object OR undefined_column OR undefined_table THEN
  RAISE NOTICE 'index idx_orders_created_at skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_orders_user_created ON orders(user_id, created_at DESC);
EXCEPTION WHEN duplicate_table OR duplicate_object OR undefined_column OR undefined_table THEN
  RAISE NOTICE 'index idx_orders_user_created skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_client_order_id ON orders(client_order_id) WHERE client_order_id IS NOT NULL;
EXCEPTION WHEN duplicate_table OR duplicate_object OR undefined_column OR undefined_table THEN
  RAISE NOTICE 'index idx_orders_client_order_id skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_orders_expires_at ON orders(expires_at) WHERE expires_at IS NOT NULL;
EXCEPTION WHEN duplicate_table OR duplicate_object OR undefined_column OR undefined_table THEN
  RAISE NOTICE 'index idx_orders_expires_at skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_trade_fills_order_id ON trade_fills(order_id);
EXCEPTION WHEN duplicate_table OR duplicate_object OR undefined_column OR undefined_table THEN
  RAISE NOTICE 'index idx_trade_fills_order_id skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_trade_fills_user_id ON trade_fills(user_id);
EXCEPTION WHEN duplicate_table OR duplicate_object OR undefined_column OR undefined_table THEN
  RAISE NOTICE 'index idx_trade_fills_user_id skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_trade_fills_symbol ON trade_fills(symbol);
EXCEPTION WHEN duplicate_table OR duplicate_object OR undefined_column OR undefined_table THEN
  RAISE NOTICE 'index idx_trade_fills_symbol skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_trade_fills_created_at ON trade_fills(created_at DESC);
EXCEPTION WHEN duplicate_table OR duplicate_object OR undefined_column OR undefined_table THEN
  RAISE NOTICE 'index idx_trade_fills_created_at skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_trade_fills_symbol_created ON trade_fills(symbol, created_at DESC);
EXCEPTION WHEN duplicate_table OR duplicate_object OR undefined_column OR undefined_table THEN
  RAISE NOTICE 'index idx_trade_fills_symbol_created skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_settlements_user_id ON settlements(user_id);
EXCEPTION WHEN duplicate_table OR duplicate_object OR undefined_column OR undefined_table THEN
  RAISE NOTICE 'index idx_settlements_user_id skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_settlements_order_id ON settlements(order_id);
EXCEPTION WHEN duplicate_table OR duplicate_object OR undefined_column OR undefined_table THEN
  RAISE NOTICE 'index idx_settlements_order_id skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_settlements_status ON settlements(status);
EXCEPTION WHEN duplicate_table OR duplicate_object OR undefined_column OR undefined_table THEN
  RAISE NOTICE 'index idx_settlements_status skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_settlements_user_status ON settlements(user_id, status);
EXCEPTION WHEN duplicate_table OR duplicate_object OR undefined_column OR undefined_table THEN
  RAISE NOTICE 'index idx_settlements_user_status skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_settlements_settlement_date ON settlements(settlement_date);
EXCEPTION WHEN duplicate_table OR duplicate_object OR undefined_column OR undefined_table THEN
  RAISE NOTICE 'index idx_settlements_settlement_date skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_settlements_created_at ON settlements(created_at DESC);
EXCEPTION WHEN duplicate_table OR duplicate_object OR undefined_column OR undefined_table THEN
  RAISE NOTICE 'index idx_settlements_created_at skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  CREATE UNIQUE INDEX IF NOT EXISTS idx_live_prices_symbol ON live_prices(symbol);
EXCEPTION WHEN duplicate_table OR duplicate_object OR undefined_column OR undefined_table THEN
  RAISE NOTICE 'index idx_live_prices_symbol skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_live_prices_asset_class ON live_prices(asset_class);
EXCEPTION WHEN duplicate_table OR duplicate_object OR undefined_column OR undefined_table THEN
  RAISE NOTICE 'index idx_live_prices_asset_class skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_live_prices_updated_at ON live_prices(updated_at DESC);
EXCEPTION WHEN duplicate_table OR duplicate_object OR undefined_column OR undefined_table THEN
  RAISE NOTICE 'index idx_live_prices_updated_at skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);
EXCEPTION WHEN duplicate_table OR duplicate_object OR undefined_column OR undefined_table THEN
  RAISE NOTICE 'index idx_notifications_user_id skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_notifications_user_read ON notifications(user_id, read);
EXCEPTION WHEN duplicate_table OR duplicate_object OR undefined_column OR undefined_table THEN
  RAISE NOTICE 'index idx_notifications_user_read skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON notifications(created_at DESC);
EXCEPTION WHEN duplicate_table OR duplicate_object OR undefined_column OR undefined_table THEN
  RAISE NOTICE 'index idx_notifications_created_at skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_notifications_user_created ON notifications(user_id, created_at DESC);
EXCEPTION WHEN duplicate_table OR duplicate_object OR undefined_column OR undefined_table THEN
  RAISE NOTICE 'index idx_notifications_user_created skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_price_alerts_user_id ON price_alerts(user_id);
EXCEPTION WHEN duplicate_table OR duplicate_object OR undefined_column OR undefined_table THEN
  RAISE NOTICE 'index idx_price_alerts_user_id skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_price_alerts_symbol ON price_alerts(symbol);
EXCEPTION WHEN duplicate_table OR duplicate_object OR undefined_column OR undefined_table THEN
  RAISE NOTICE 'index idx_price_alerts_symbol skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_price_alerts_triggered ON price_alerts(triggered, notified) WHERE triggered = false;
EXCEPTION WHEN duplicate_table OR duplicate_object OR undefined_column OR undefined_table THEN
  RAISE NOTICE 'index idx_price_alerts_triggered skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_price_alerts_symbol_triggered ON price_alerts(symbol, triggered);
EXCEPTION WHEN duplicate_table OR duplicate_object OR undefined_column OR undefined_table THEN
  RAISE NOTICE 'index idx_price_alerts_symbol_triggered skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_positions_user_id ON positions(user_id);
EXCEPTION WHEN duplicate_table OR duplicate_object OR undefined_column OR undefined_table THEN
  RAISE NOTICE 'index idx_positions_user_id skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  CREATE UNIQUE INDEX IF NOT EXISTS idx_positions_user_symbol ON positions(user_id, symbol);
EXCEPTION WHEN duplicate_table OR duplicate_object OR undefined_column OR undefined_table THEN
  RAISE NOTICE 'index idx_positions_user_symbol skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_warehouse_receipts_user_id ON warehouse_receipts(user_id);
EXCEPTION WHEN duplicate_table OR duplicate_object OR undefined_column OR undefined_table THEN
  RAISE NOTICE 'index idx_warehouse_receipts_user_id skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_warehouse_receipts_status ON warehouse_receipts(status);
EXCEPTION WHEN duplicate_table OR duplicate_object OR undefined_column OR undefined_table THEN
  RAISE NOTICE 'index idx_warehouse_receipts_status skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_warehouse_receipts_commodity ON warehouse_receipts(commodity);
EXCEPTION WHEN duplicate_table OR duplicate_object OR undefined_column OR undefined_table THEN
  RAISE NOTICE 'index idx_warehouse_receipts_commodity skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_warehouse_receipts_user_status ON warehouse_receipts(user_id, status);
EXCEPTION WHEN duplicate_table OR duplicate_object OR undefined_column OR undefined_table THEN
  RAISE NOTICE 'index idx_warehouse_receipts_user_status skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_warehouse_receipts_expiry ON warehouse_receipts(expiry_date) WHERE expiry_date IS NOT NULL;
EXCEPTION WHEN duplicate_table OR duplicate_object OR undefined_column OR undefined_table THEN
  RAISE NOTICE 'index idx_warehouse_receipts_expiry skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_input_financing_loans_user_id ON input_financing_loans(user_id);
EXCEPTION WHEN duplicate_table OR duplicate_object OR undefined_column OR undefined_table THEN
  RAISE NOTICE 'index idx_input_financing_loans_user_id skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_input_financing_loans_status ON input_financing_loans(status);
EXCEPTION WHEN duplicate_table OR duplicate_object OR undefined_column OR undefined_table THEN
  RAISE NOTICE 'index idx_input_financing_loans_status skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_input_financing_loans_user_status ON input_financing_loans(user_id, status);
EXCEPTION WHEN duplicate_table OR duplicate_object OR undefined_column OR undefined_table THEN
  RAISE NOTICE 'index idx_input_financing_loans_user_status skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_input_financing_loans_due_date ON input_financing_loans(due_date);
EXCEPTION WHEN duplicate_table OR duplicate_object OR undefined_column OR undefined_table THEN
  RAISE NOTICE 'index idx_input_financing_loans_due_date skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_input_financing_loans_created_at ON input_financing_loans(created_at DESC);
EXCEPTION WHEN duplicate_table OR duplicate_object OR undefined_column OR undefined_table THEN
  RAISE NOTICE 'index idx_input_financing_loans_created_at skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_portfolio_snapshots_user_id ON portfolio_snapshots(user_id);
EXCEPTION WHEN duplicate_table OR duplicate_object OR undefined_column OR undefined_table THEN
  RAISE NOTICE 'index idx_portfolio_snapshots_user_id skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_portfolio_snapshots_user_date ON portfolio_snapshots(user_id, snapshot_date DESC);
EXCEPTION WHEN duplicate_table OR duplicate_object OR undefined_column OR undefined_table THEN
  RAISE NOTICE 'index idx_portfolio_snapshots_user_date skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  CREATE UNIQUE INDEX IF NOT EXISTS idx_portfolio_snapshots_user_date_unique ON portfolio_snapshots(user_id, snapshot_date);
EXCEPTION WHEN duplicate_table OR duplicate_object OR undefined_column OR undefined_table THEN
  RAISE NOTICE 'index idx_portfolio_snapshots_user_date_unique skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_kyc_queue_user_id ON kyc_queue(user_id);
EXCEPTION WHEN duplicate_table OR duplicate_object OR undefined_column OR undefined_table THEN
  RAISE NOTICE 'index idx_kyc_queue_user_id skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_kyc_queue_status ON kyc_queue(status);
EXCEPTION WHEN duplicate_table OR duplicate_object OR undefined_column OR undefined_table THEN
  RAISE NOTICE 'index idx_kyc_queue_status skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_kyc_queue_submitted_at ON kyc_queue(submitted_at DESC);
EXCEPTION WHEN duplicate_table OR duplicate_object OR undefined_column OR undefined_table THEN
  RAISE NOTICE 'index idx_kyc_queue_submitted_at skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_audit_log_user_id ON audit_log(user_id);
EXCEPTION WHEN duplicate_table OR duplicate_object OR undefined_column OR undefined_table THEN
  RAISE NOTICE 'index idx_audit_log_user_id skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_audit_log_action ON audit_log(action);
EXCEPTION WHEN duplicate_table OR duplicate_object OR undefined_column OR undefined_table THEN
  RAISE NOTICE 'index idx_audit_log_action skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_audit_log_resource ON audit_log(resource, resource_id);
EXCEPTION WHEN duplicate_table OR duplicate_object OR undefined_column OR undefined_table THEN
  RAISE NOTICE 'index idx_audit_log_resource skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON audit_log(created_at DESC);
EXCEPTION WHEN duplicate_table OR duplicate_object OR undefined_column OR undefined_table THEN
  RAISE NOTICE 'index idx_audit_log_created_at skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  CREATE UNIQUE INDEX IF NOT EXISTS idx_margin_accounts_user_id ON margin_accounts(user_id);
EXCEPTION WHEN duplicate_table OR duplicate_object OR undefined_column OR undefined_table THEN
  RAISE NOTICE 'index idx_margin_accounts_user_id skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_margin_accounts_status ON margin_accounts(status);
EXCEPTION WHEN duplicate_table OR duplicate_object OR undefined_column OR undefined_table THEN
  RAISE NOTICE 'index idx_margin_accounts_status skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_collateral_items_user_id ON collateral_items(user_id);
EXCEPTION WHEN duplicate_table OR duplicate_object OR undefined_column OR undefined_table THEN
  RAISE NOTICE 'index idx_collateral_items_user_id skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_collateral_items_margin_account ON collateral_items(margin_account_id);
EXCEPTION WHEN duplicate_table OR duplicate_object OR undefined_column OR undefined_table THEN
  RAISE NOTICE 'index idx_collateral_items_margin_account skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_collateral_items_status ON collateral_items(status);
EXCEPTION WHEN duplicate_table OR duplicate_object OR undefined_column OR undefined_table THEN
  RAISE NOTICE 'index idx_collateral_items_status skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_collateral_ledger_user_id ON collateral_ledger(user_id);
EXCEPTION WHEN duplicate_table OR duplicate_object OR undefined_column OR undefined_table THEN
  RAISE NOTICE 'index idx_collateral_ledger_user_id skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_collateral_ledger_item_id ON collateral_ledger(collateral_item_id);
EXCEPTION WHEN duplicate_table OR duplicate_object OR undefined_column OR undefined_table THEN
  RAISE NOTICE 'index idx_collateral_ledger_item_id skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_collateral_ledger_created_at ON collateral_ledger(created_at DESC);
EXCEPTION WHEN duplicate_table OR duplicate_object OR undefined_column OR undefined_table THEN
  RAISE NOTICE 'index idx_collateral_ledger_created_at skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_settlement_disputes_settlement_id ON settlement_disputes(settlement_id);
EXCEPTION WHEN duplicate_table OR duplicate_object OR undefined_column OR undefined_table THEN
  RAISE NOTICE 'index idx_settlement_disputes_settlement_id skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_settlement_disputes_raised_by ON settlement_disputes(raised_by);
EXCEPTION WHEN duplicate_table OR duplicate_object OR undefined_column OR undefined_table THEN
  RAISE NOTICE 'index idx_settlement_disputes_raised_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_settlement_disputes_status ON settlement_disputes(status);
EXCEPTION WHEN duplicate_table OR duplicate_object OR undefined_column OR undefined_table THEN
  RAISE NOTICE 'index idx_settlement_disputes_status skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_settlement_disputes_sla ON settlement_disputes(sla_deadline) WHERE sla_breached = false;
EXCEPTION WHEN duplicate_table OR duplicate_object OR undefined_column OR undefined_table THEN
  RAISE NOTICE 'index idx_settlement_disputes_sla skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_security_events_user_id ON security_events(user_id);
EXCEPTION WHEN duplicate_table OR duplicate_object OR undefined_column OR undefined_table THEN
  RAISE NOTICE 'index idx_security_events_user_id skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_security_events_severity ON security_events(severity);
EXCEPTION WHEN duplicate_table OR duplicate_object OR undefined_column OR undefined_table THEN
  RAISE NOTICE 'index idx_security_events_severity skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_security_events_status ON security_events(status);
EXCEPTION WHEN duplicate_table OR duplicate_object OR undefined_column OR undefined_table THEN
  RAISE NOTICE 'index idx_security_events_status skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_security_events_created_at ON security_events(created_at DESC);
EXCEPTION WHEN duplicate_table OR duplicate_object OR undefined_column OR undefined_table THEN
  RAISE NOTICE 'index idx_security_events_created_at skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_aml_flags_user_id ON aml_flags(user_id);
EXCEPTION WHEN duplicate_table OR duplicate_object OR undefined_column OR undefined_table THEN
  RAISE NOTICE 'index idx_aml_flags_user_id skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_aml_flags_status ON aml_flags(status);
EXCEPTION WHEN duplicate_table OR duplicate_object OR undefined_column OR undefined_table THEN
  RAISE NOTICE 'index idx_aml_flags_status skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_aml_flags_created_at ON aml_flags(created_at DESC);
EXCEPTION WHEN duplicate_table OR duplicate_object OR undefined_column OR undefined_table THEN
  RAISE NOTICE 'index idx_aml_flags_created_at skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_mojaloop_transfers_payer ON mojaloop_transfers(payer_fsp_id);
EXCEPTION WHEN duplicate_table OR duplicate_object OR undefined_column OR undefined_table THEN
  RAISE NOTICE 'index idx_mojaloop_transfers_payer skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_mojaloop_transfers_payee ON mojaloop_transfers(payee_fsp_id);
EXCEPTION WHEN duplicate_table OR duplicate_object OR undefined_column OR undefined_table THEN
  RAISE NOTICE 'index idx_mojaloop_transfers_payee skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_mojaloop_transfers_state ON mojaloop_transfers(transfer_state);
EXCEPTION WHEN duplicate_table OR duplicate_object OR undefined_column OR undefined_table THEN
  RAISE NOTICE 'index idx_mojaloop_transfers_state skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_mojaloop_transfers_created ON mojaloop_transfers(created_at DESC);
EXCEPTION WHEN duplicate_table OR duplicate_object OR undefined_column OR undefined_table THEN
  RAISE NOTICE 'index idx_mojaloop_transfers_created skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_farmer_profiles_user_id ON farmer_profiles(user_id);
EXCEPTION WHEN duplicate_table OR duplicate_object OR undefined_column OR undefined_table THEN
  RAISE NOTICE 'index idx_farmer_profiles_user_id skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_farmer_profiles_state ON farmer_profiles(state);
EXCEPTION WHEN duplicate_table OR duplicate_object OR undefined_column OR undefined_table THEN
  RAISE NOTICE 'index idx_farmer_profiles_state skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_farmer_profiles_cooperative ON farmer_profiles(cooperative_id);
EXCEPTION WHEN duplicate_table OR duplicate_object OR undefined_column OR undefined_table THEN
  RAISE NOTICE 'index idx_farmer_profiles_cooperative skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_crop_listings_farmer_id ON crop_listings(farmer_id);
EXCEPTION WHEN duplicate_table OR duplicate_object OR undefined_column OR undefined_table THEN
  RAISE NOTICE 'index idx_crop_listings_farmer_id skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_crop_listings_commodity ON crop_listings(commodity);
EXCEPTION WHEN duplicate_table OR duplicate_object OR undefined_column OR undefined_table THEN
  RAISE NOTICE 'index idx_crop_listings_commodity skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_crop_listings_status ON crop_listings(status);
EXCEPTION WHEN duplicate_table OR duplicate_object OR undefined_column OR undefined_table THEN
  RAISE NOTICE 'index idx_crop_listings_status skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_crop_listings_created_at ON crop_listings(created_at DESC);
EXCEPTION WHEN duplicate_table OR duplicate_object OR undefined_column OR undefined_table THEN
  RAISE NOTICE 'index idx_crop_listings_created_at skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_field_visits_agent_id ON field_visits(agent_id);
EXCEPTION WHEN duplicate_table OR duplicate_object OR undefined_column OR undefined_table THEN
  RAISE NOTICE 'index idx_field_visits_agent_id skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_field_visits_farmer_id ON field_visits(farmer_id);
EXCEPTION WHEN duplicate_table OR duplicate_object OR undefined_column OR undefined_table THEN
  RAISE NOTICE 'index idx_field_visits_farmer_id skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_field_visits_status ON field_visits(status);
EXCEPTION WHEN duplicate_table OR duplicate_object OR undefined_column OR undefined_table THEN
  RAISE NOTICE 'index idx_field_visits_status skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_field_visits_scheduled ON field_visits(scheduled_date);
EXCEPTION WHEN duplicate_table OR duplicate_object OR undefined_column OR undefined_table THEN
  RAISE NOTICE 'index idx_field_visits_scheduled skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_bank_transactions_account_id ON bank_transactions(account_id);
EXCEPTION WHEN duplicate_table OR duplicate_object OR undefined_column OR undefined_table THEN
  RAISE NOTICE 'index idx_bank_transactions_account_id skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_bank_transactions_type ON bank_transactions(transaction_type);
EXCEPTION WHEN duplicate_table OR duplicate_object OR undefined_column OR undefined_table THEN
  RAISE NOTICE 'index idx_bank_transactions_type skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_bank_transactions_status ON bank_transactions(status);
EXCEPTION WHEN duplicate_table OR duplicate_object OR undefined_column OR undefined_table THEN
  RAISE NOTICE 'index idx_bank_transactions_status skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_bank_transactions_created_at ON bank_transactions(created_at DESC);
EXCEPTION WHEN duplicate_table OR duplicate_object OR undefined_column OR undefined_table THEN
  RAISE NOTICE 'index idx_bank_transactions_created_at skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_bank_transactions_account_created ON bank_transactions(account_id, created_at DESC);
EXCEPTION WHEN duplicate_table OR duplicate_object OR undefined_column OR undefined_table THEN
  RAISE NOTICE 'index idx_bank_transactions_account_created skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_credit_scores_user_id ON credit_scores(user_id);
EXCEPTION WHEN duplicate_table OR duplicate_object OR undefined_column OR undefined_table THEN
  RAISE NOTICE 'index idx_credit_scores_user_id skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_credit_scores_user_created ON credit_scores(user_id, created_at DESC);
EXCEPTION WHEN duplicate_table OR duplicate_object OR undefined_column OR undefined_table THEN
  RAISE NOTICE 'index idx_credit_scores_user_created skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_loan_repayment_schedules_loan_id ON loan_repayment_schedules(loan_id);
EXCEPTION WHEN duplicate_table OR duplicate_object OR undefined_column OR undefined_table THEN
  RAISE NOTICE 'index idx_loan_repayment_schedules_loan_id skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_loan_repayment_schedules_due_date ON loan_repayment_schedules(due_date);
EXCEPTION WHEN duplicate_table OR duplicate_object OR undefined_column OR undefined_table THEN
  RAISE NOTICE 'index idx_loan_repayment_schedules_due_date skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_loan_repayment_schedules_status ON loan_repayment_schedules(status);
EXCEPTION WHEN duplicate_table OR duplicate_object OR undefined_column OR undefined_table THEN
  RAISE NOTICE 'index idx_loan_repayment_schedules_status skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_crop_insurance_policies_user_id ON crop_insurance_policies(user_id);
EXCEPTION WHEN duplicate_table OR duplicate_object OR undefined_column OR undefined_table THEN
  RAISE NOTICE 'index idx_crop_insurance_policies_user_id skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_crop_insurance_policies_status ON crop_insurance_policies(status);
EXCEPTION WHEN duplicate_table OR duplicate_object OR undefined_column OR undefined_table THEN
  RAISE NOTICE 'index idx_crop_insurance_policies_status skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_crop_insurance_policies_expiry ON crop_insurance_policies(expiry_date);
EXCEPTION WHEN duplicate_table OR duplicate_object OR undefined_column OR undefined_table THEN
  RAISE NOTICE 'index idx_crop_insurance_policies_expiry skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_futures_positions_user_id ON futures_positions(user_id);
EXCEPTION WHEN duplicate_table OR duplicate_object OR undefined_column OR undefined_table THEN
  RAISE NOTICE 'index idx_futures_positions_user_id skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_futures_positions_contract_id ON futures_positions(contract_id);
EXCEPTION WHEN duplicate_table OR duplicate_object OR undefined_column OR undefined_table THEN
  RAISE NOTICE 'index idx_futures_positions_contract_id skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_futures_positions_user_contract ON futures_positions(user_id, contract_id);
EXCEPTION WHEN duplicate_table OR duplicate_object OR undefined_column OR undefined_table THEN
  RAISE NOTICE 'index idx_futures_positions_user_contract skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_ussd_sessions_phone ON ussd_sessions(phone_number);
EXCEPTION WHEN duplicate_table OR duplicate_object OR undefined_column OR undefined_table THEN
  RAISE NOTICE 'index idx_ussd_sessions_phone skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_ussd_sessions_session_id ON ussd_sessions(session_id);
EXCEPTION WHEN duplicate_table OR duplicate_object OR undefined_column OR undefined_table THEN
  RAISE NOTICE 'index idx_ussd_sessions_session_id skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_ussd_sessions_created_at ON ussd_sessions(created_at DESC);
EXCEPTION WHEN duplicate_table OR duplicate_object OR undefined_column OR undefined_table THEN
  RAISE NOTICE 'index idx_ussd_sessions_created_at skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user_id ON push_subscriptions(user_id);
EXCEPTION WHEN duplicate_table OR duplicate_object OR undefined_column OR undefined_table THEN
  RAISE NOTICE 'index idx_push_subscriptions_user_id skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_contact_id ON whatsapp_messages(contact_id);
EXCEPTION WHEN duplicate_table OR duplicate_object OR undefined_column OR undefined_table THEN
  RAISE NOTICE 'index idx_whatsapp_messages_contact_id skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_created_at ON whatsapp_messages(created_at DESC);
EXCEPTION WHEN duplicate_table OR duplicate_object OR undefined_column OR undefined_table THEN
  RAISE NOTICE 'index idx_whatsapp_messages_created_at skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_telegram_messages_contact_id ON telegram_messages(contact_id);
EXCEPTION WHEN duplicate_table OR duplicate_object OR undefined_column OR undefined_table THEN
  RAISE NOTICE 'index idx_telegram_messages_contact_id skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_telegram_messages_created_at ON telegram_messages(created_at DESC);
EXCEPTION WHEN duplicate_table OR duplicate_object OR undefined_column OR undefined_table THEN
  RAISE NOTICE 'index idx_telegram_messages_created_at skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_webauthn_credentials_user_id ON webauthn_credentials(user_id);
EXCEPTION WHEN duplicate_table OR duplicate_object OR undefined_column OR undefined_table THEN
  RAISE NOTICE 'index idx_webauthn_credentials_user_id skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  CREATE UNIQUE INDEX IF NOT EXISTS idx_webauthn_credentials_cred_id ON webauthn_credentials(credential_id);
EXCEPTION WHEN duplicate_table OR duplicate_object OR undefined_column OR undefined_table THEN
  RAISE NOTICE 'index idx_webauthn_credentials_cred_id skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_broker_clients_broker_id ON broker_clients(broker_id);
EXCEPTION WHEN duplicate_table OR duplicate_object OR undefined_column OR undefined_table THEN
  RAISE NOTICE 'index idx_broker_clients_broker_id skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_broker_clients_client_id ON broker_clients(client_id);
EXCEPTION WHEN duplicate_table OR duplicate_object OR undefined_column OR undefined_table THEN
  RAISE NOTICE 'index idx_broker_clients_client_id skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_fixed_income_trades_user_id ON fixed_income_trades(user_id);
EXCEPTION WHEN duplicate_table OR duplicate_object OR undefined_column OR undefined_table THEN
  RAISE NOTICE 'index idx_fixed_income_trades_user_id skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_fixed_income_trades_instrument_id ON fixed_income_trades(instrument_id);
EXCEPTION WHEN duplicate_table OR duplicate_object OR undefined_column OR undefined_table THEN
  RAISE NOTICE 'index idx_fixed_income_trades_instrument_id skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_fixed_income_trades_created_at ON fixed_income_trades(created_at DESC);
EXCEPTION WHEN duplicate_table OR duplicate_object OR undefined_column OR undefined_table THEN
  RAISE NOTICE 'index idx_fixed_income_trades_created_at skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_abcp_programs_status ON abcp_programs(status);
EXCEPTION WHEN duplicate_table OR duplicate_object OR undefined_column OR undefined_table THEN
  RAISE NOTICE 'index idx_abcp_programs_status skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_abcp_programs_created_at ON abcp_programs(created_at DESC);
EXCEPTION WHEN duplicate_table OR duplicate_object OR undefined_column OR undefined_table THEN
  RAISE NOTICE 'index idx_abcp_programs_created_at skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_workbench_farms_user_id ON workbench_farms(user_id);
EXCEPTION WHEN duplicate_table OR duplicate_object OR undefined_column OR undefined_table THEN
  RAISE NOTICE 'index idx_workbench_farms_user_id skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_workbench_crop_plans_farm_id ON workbench_crop_plans(farm_id);
EXCEPTION WHEN duplicate_table OR duplicate_object OR undefined_column OR undefined_table THEN
  RAISE NOTICE 'index idx_workbench_crop_plans_farm_id skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_workbench_soil_tests_farm_id ON workbench_soil_tests(farm_id);
EXCEPTION WHEN duplicate_table OR duplicate_object OR undefined_column OR undefined_table THEN
  RAISE NOTICE 'index idx_workbench_soil_tests_farm_id skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_order_book_levels_symbol ON order_book_levels(symbol);
EXCEPTION WHEN duplicate_table OR duplicate_object OR undefined_column OR undefined_table THEN
  RAISE NOTICE 'index idx_order_book_levels_symbol skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_order_book_levels_symbol_side ON order_book_levels(symbol, side);
EXCEPTION WHEN duplicate_table OR duplicate_object OR undefined_column OR undefined_table THEN
  RAISE NOTICE 'index idx_order_book_levels_symbol_side skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_order_book_levels_updated_at ON order_book_levels(updated_at DESC);
EXCEPTION WHEN duplicate_table OR duplicate_object OR undefined_column OR undefined_table THEN
  RAISE NOTICE 'index idx_order_book_levels_updated_at skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_pre_trade_risk_checks_user_id ON pre_trade_risk_checks(user_id);
EXCEPTION WHEN duplicate_table OR duplicate_object OR undefined_column OR undefined_table THEN
  RAISE NOTICE 'index idx_pre_trade_risk_checks_user_id skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_pre_trade_risk_checks_order_id ON pre_trade_risk_checks(order_id);
EXCEPTION WHEN duplicate_table OR duplicate_object OR undefined_column OR undefined_table THEN
  RAISE NOTICE 'index idx_pre_trade_risk_checks_order_id skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_pre_trade_risk_checks_result ON pre_trade_risk_checks(result);
EXCEPTION WHEN duplicate_table OR duplicate_object OR undefined_column OR undefined_table THEN
  RAISE NOTICE 'index idx_pre_trade_risk_checks_result skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_circuit_breaker_events_symbol ON circuit_breaker_events(symbol);
EXCEPTION WHEN duplicate_table OR duplicate_object OR undefined_column OR undefined_table THEN
  RAISE NOTICE 'index idx_circuit_breaker_events_symbol skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_circuit_breaker_events_created_at ON circuit_breaker_events(created_at DESC);
EXCEPTION WHEN duplicate_table OR duplicate_object OR undefined_column OR undefined_table THEN
  RAISE NOTICE 'index idx_circuit_breaker_events_created_at skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_margin_calls_user_id ON margin_calls(user_id);
EXCEPTION WHEN duplicate_table OR duplicate_object OR undefined_column OR undefined_table THEN
  RAISE NOTICE 'index idx_margin_calls_user_id skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_margin_calls_status ON margin_calls(status);
EXCEPTION WHEN duplicate_table OR duplicate_object OR undefined_column OR undefined_table THEN
  RAISE NOTICE 'index idx_margin_calls_status skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_margin_calls_deadline ON margin_calls(deadline);
EXCEPTION WHEN duplicate_table OR duplicate_object OR undefined_column OR undefined_table THEN
  RAISE NOTICE 'index idx_margin_calls_deadline skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_device_sessions_user_id ON device_sessions(user_id);
EXCEPTION WHEN duplicate_table OR duplicate_object OR undefined_column OR undefined_table THEN
  RAISE NOTICE 'index idx_device_sessions_user_id skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_device_sessions_last_active ON device_sessions(last_active_at DESC);
EXCEPTION WHEN duplicate_table OR duplicate_object OR undefined_column OR undefined_table THEN
  RAISE NOTICE 'index idx_device_sessions_last_active skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_velocity_ledger_user_id ON velocity_ledger(user_id);
EXCEPTION WHEN duplicate_table OR duplicate_object OR undefined_column OR undefined_table THEN
  RAISE NOTICE 'index idx_velocity_ledger_user_id skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_velocity_ledger_window ON velocity_ledger(window_start);
EXCEPTION WHEN duplicate_table OR duplicate_object OR undefined_column OR undefined_table THEN
  RAISE NOTICE 'index idx_velocity_ledger_window skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_user_id ON profiles(user_id);
EXCEPTION WHEN duplicate_table OR duplicate_object OR undefined_column OR undefined_table THEN
  RAISE NOTICE 'index idx_profiles_user_id skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_profiles_kyc_status ON profiles(kyc_status);
EXCEPTION WHEN duplicate_table OR duplicate_object OR undefined_column OR undefined_table THEN
  RAISE NOTICE 'index idx_profiles_kyc_status skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_profiles_account_type ON profiles(account_type);
EXCEPTION WHEN duplicate_table OR duplicate_object OR undefined_column OR undefined_table THEN
  RAISE NOTICE 'index idx_profiles_account_type skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  CREATE UNIQUE INDEX IF NOT EXISTS idx_users_open_id ON users(open_id);
EXCEPTION WHEN duplicate_table OR duplicate_object OR undefined_column OR undefined_table THEN
  RAISE NOTICE 'index idx_users_open_id skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_users_email ON users(email) WHERE email IS NOT NULL;
EXCEPTION WHEN duplicate_table OR duplicate_object OR undefined_column OR undefined_table THEN
  RAISE NOTICE 'index idx_users_email skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
EXCEPTION WHEN duplicate_table OR duplicate_object OR undefined_column OR undefined_table THEN
  RAISE NOTICE 'index idx_users_role skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_users_created_at ON users(created_at DESC);
EXCEPTION WHEN duplicate_table OR duplicate_object OR undefined_column OR undefined_table THEN
  RAISE NOTICE 'index idx_users_created_at skipped: %', SQLERRM;
END $$;

-- ---- 0050_lush_spacker_dave.sql ----
DO $$ BEGIN
  CREATE TYPE "public"."instrument_asset_class" AS ENUM('COMMODITY', 'FOREX', 'EQUITY', 'DIGITAL_ASSET', 'INDEX', 'FIXED_INCOME', 'DERIVATIVE');
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'type instrument_asset_class already exists, skipping';
END $$;
DO $$ BEGIN
  CREATE TYPE "public"."instrument_status" AS ENUM('ACTIVE', 'SUSPENDED', 'DELISTED', 'PENDING');
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'type instrument_status already exists, skipping';
END $$;
DO $$ BEGIN
  CREATE TYPE "public"."warehouse_accreditation_status" AS ENUM('PENDING', 'ACCREDITED', 'SUSPENDED', 'REVOKED');
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'type warehouse_accreditation_status already exists, skipping';
END $$;
CREATE TABLE IF NOT EXISTS "instruments" (
	"id" serial PRIMARY KEY NOT NULL,
	"symbol" varchar(32) NOT NULL,
	"name" varchar(200) NOT NULL,
	"asset_class" "instrument_asset_class" NOT NULL,
	"base_currency" varchar(8) DEFAULT 'NGN' NOT NULL,
	"quote_currency" varchar(8) DEFAULT 'NGN' NOT NULL,
	"lot_size" numeric(18, 6) DEFAULT '1' NOT NULL,
	"min_lot_size" numeric(18, 6) DEFAULT '1' NOT NULL,
	"tick_size" numeric(18, 6) DEFAULT '0.01' NOT NULL,
	"price_band_pct" numeric(8, 4) DEFAULT '10',
	"settlement_days" integer DEFAULT 2 NOT NULL,
	"trading_hours_start" varchar(8) DEFAULT '09:30',
	"trading_hours_end" varchar(8) DEFAULT '16:00',
	"exchange" varchar(64) DEFAULT 'NEXCOM',
	"isin" varchar(20),
	"description" text,
	"status" "instrument_status" DEFAULT 'ACTIVE' NOT NULL,
	"listed_at" timestamp DEFAULT now(),
	"delisted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "instruments_symbol_unique" UNIQUE("symbol")
);
CREATE TABLE IF NOT EXISTS "warehouses" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(200) NOT NULL,
	"code" varchar(32) NOT NULL,
	"operator_id" integer,
	"address" text,
	"city" varchar(100),
	"state" varchar(100),
	"country" varchar(64) DEFAULT 'Nigeria',
	"gps_lat" numeric(10, 7),
	"gps_lng" numeric(10, 7),
	"capacity_mt" numeric(14, 2),
	"available_capacity_mt" numeric(14, 2),
	"accreditation_status" "warehouse_accreditation_status" DEFAULT 'PENDING' NOT NULL,
	"accreditation_ref" varchar(100),
	"accreditation_expiry" timestamp,
	"phone" varchar(32),
	"email" varchar(128),
	"supported_commodities" jsonb,
	"insurance_policy_ref" varchar(100),
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "warehouses_code_unique" UNIQUE("code")
);
ALTER TABLE "audit_log" ALTER COLUMN "details" SET DATA TYPE jsonb;
ALTER TABLE "cooperative_bulk_uploads" ALTER COLUMN "errors" SET DATA TYPE jsonb;
ALTER TABLE "cooperative_bulk_uploads" ALTER COLUMN "created_application_ids" SET DATA TYPE jsonb;
ALTER TABLE "kyc_analysis_results" ALTER COLUMN "ocr_avg_confidence" SET DATA TYPE numeric(8, 4);
ALTER TABLE "kyc_analysis_results" ALTER COLUMN "document_authenticity_score" SET DATA TYPE numeric(8, 4);
ALTER TABLE "kyc_analysis_results" ALTER COLUMN "selfie_overall_score" SET DATA TYPE numeric(8, 4);
ALTER TABLE "kyc_analysis_results" ALTER COLUMN "passive_liveness_score" SET DATA TYPE numeric(8, 4);
ALTER TABLE "kyc_analysis_results" ALTER COLUMN "overall_score" SET DATA TYPE numeric(8, 4);
ALTER TABLE "kyc_queue" ALTER COLUMN "documents" SET DATA TYPE jsonb;
ALTER TABLE "mojaloop_parties" ALTER COLUMN "supported_currencies" SET DATA TYPE jsonb;
ALTER TABLE "mojaloop_parties" ALTER COLUMN "supported_currencies" SET DEFAULT '[]'::jsonb;
ALTER TABLE "notifications" ALTER COLUMN "metadata" SET DATA TYPE jsonb;
ALTER TABLE "profiles" ALTER COLUMN "metadata" SET DATA TYPE jsonb;
ALTER TABLE "security_events" ALTER COLUMN "metadata" SET DATA TYPE jsonb;
ALTER TABLE "stripe_payments" ALTER COLUMN "metadata" SET DATA TYPE jsonb;

-- ---- 0051_audit_columns.sql ----
DO $$ BEGIN
  -- Migration 0051: Add created_by and last_updated_by audit columns to all tables
-- These columns reference users.id (nullable, no FK constraint for performance)

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "created_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column created_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "last_updated_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column last_updated_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "profiles" ADD COLUMN IF NOT EXISTS "created_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column created_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "profiles" ADD COLUMN IF NOT EXISTS "last_updated_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column last_updated_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "created_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column created_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "last_updated_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column last_updated_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "order_amendments" ADD COLUMN IF NOT EXISTS "created_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column created_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "order_amendments" ADD COLUMN IF NOT EXISTS "last_updated_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column last_updated_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "positions" ADD COLUMN IF NOT EXISTS "created_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column created_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "positions" ADD COLUMN IF NOT EXISTS "last_updated_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column last_updated_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "watchlist" ADD COLUMN IF NOT EXISTS "created_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column created_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "watchlist" ADD COLUMN IF NOT EXISTS "last_updated_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column last_updated_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "price_alerts" ADD COLUMN IF NOT EXISTS "created_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column created_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "price_alerts" ADD COLUMN IF NOT EXISTS "last_updated_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column last_updated_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "saved_orders" ADD COLUMN IF NOT EXISTS "created_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column created_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "saved_orders" ADD COLUMN IF NOT EXISTS "last_updated_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column last_updated_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "created_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column created_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "last_updated_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column last_updated_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "kyc_queue" ADD COLUMN IF NOT EXISTS "created_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column created_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "kyc_queue" ADD COLUMN IF NOT EXISTS "last_updated_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column last_updated_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "audit_log" ADD COLUMN IF NOT EXISTS "created_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column created_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "audit_log" ADD COLUMN IF NOT EXISTS "last_updated_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column last_updated_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "warehouse_receipts" ADD COLUMN IF NOT EXISTS "created_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column created_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "warehouse_receipts" ADD COLUMN IF NOT EXISTS "last_updated_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column last_updated_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "deposit_requests" ADD COLUMN IF NOT EXISTS "created_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column created_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "deposit_requests" ADD COLUMN IF NOT EXISTS "last_updated_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column last_updated_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "delivery_orders" ADD COLUMN IF NOT EXISTS "created_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column created_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "delivery_orders" ADD COLUMN IF NOT EXISTS "last_updated_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column last_updated_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "api_keys" ADD COLUMN IF NOT EXISTS "created_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column created_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "api_keys" ADD COLUMN IF NOT EXISTS "last_updated_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column last_updated_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "settlements" ADD COLUMN IF NOT EXISTS "created_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column created_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "settlements" ADD COLUMN IF NOT EXISTS "last_updated_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column last_updated_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "portfolio_snapshots" ADD COLUMN IF NOT EXISTS "created_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column created_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "portfolio_snapshots" ADD COLUMN IF NOT EXISTS "last_updated_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column last_updated_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "user_preferences" ADD COLUMN IF NOT EXISTS "created_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column created_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "user_preferences" ADD COLUMN IF NOT EXISTS "last_updated_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column last_updated_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "cooperative_bulk_uploads" ADD COLUMN IF NOT EXISTS "created_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column created_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "cooperative_bulk_uploads" ADD COLUMN IF NOT EXISTS "last_updated_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column last_updated_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "margin_accounts" ADD COLUMN IF NOT EXISTS "created_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column created_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "margin_accounts" ADD COLUMN IF NOT EXISTS "last_updated_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column last_updated_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "collateral_items" ADD COLUMN IF NOT EXISTS "created_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column created_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "collateral_items" ADD COLUMN IF NOT EXISTS "last_updated_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column last_updated_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "collateral_ledger" ADD COLUMN IF NOT EXISTS "created_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column created_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "collateral_ledger" ADD COLUMN IF NOT EXISTS "last_updated_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column last_updated_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "settlement_disputes" ADD COLUMN IF NOT EXISTS "created_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column created_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "settlement_disputes" ADD COLUMN IF NOT EXISTS "last_updated_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column last_updated_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "dispute_audit_log" ADD COLUMN IF NOT EXISTS "created_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column created_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "dispute_audit_log" ADD COLUMN IF NOT EXISTS "last_updated_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column last_updated_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "dispute_evidence" ADD COLUMN IF NOT EXISTS "created_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column created_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "dispute_evidence" ADD COLUMN IF NOT EXISTS "last_updated_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column last_updated_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "security_events" ADD COLUMN IF NOT EXISTS "created_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column created_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "security_events" ADD COLUMN IF NOT EXISTS "last_updated_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column last_updated_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "rate_limit_counters" ADD COLUMN IF NOT EXISTS "created_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column created_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "rate_limit_counters" ADD COLUMN IF NOT EXISTS "last_updated_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column last_updated_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "withdrawal_verifications" ADD COLUMN IF NOT EXISTS "created_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column created_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "withdrawal_verifications" ADD COLUMN IF NOT EXISTS "last_updated_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column last_updated_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "webhook_configs" ADD COLUMN IF NOT EXISTS "created_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column created_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "webhook_configs" ADD COLUMN IF NOT EXISTS "last_updated_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column last_updated_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "ip_allowlist" ADD COLUMN IF NOT EXISTS "created_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column created_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "ip_allowlist" ADD COLUMN IF NOT EXISTS "last_updated_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column last_updated_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "platform_settings" ADD COLUMN IF NOT EXISTS "created_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column created_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "platform_settings" ADD COLUMN IF NOT EXISTS "last_updated_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column last_updated_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "totp_secrets" ADD COLUMN IF NOT EXISTS "created_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column created_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "totp_secrets" ADD COLUMN IF NOT EXISTS "last_updated_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column last_updated_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "device_sessions" ADD COLUMN IF NOT EXISTS "created_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column created_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "device_sessions" ADD COLUMN IF NOT EXISTS "last_updated_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column last_updated_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "velocity_limit_config" ADD COLUMN IF NOT EXISTS "created_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column created_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "velocity_limit_config" ADD COLUMN IF NOT EXISTS "last_updated_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column last_updated_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "velocity_ledger" ADD COLUMN IF NOT EXISTS "created_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column created_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "velocity_ledger" ADD COLUMN IF NOT EXISTS "last_updated_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column last_updated_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "aml_rules" ADD COLUMN IF NOT EXISTS "created_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column created_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "aml_rules" ADD COLUMN IF NOT EXISTS "last_updated_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column last_updated_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "aml_flags" ADD COLUMN IF NOT EXISTS "created_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column created_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "aml_flags" ADD COLUMN IF NOT EXISTS "last_updated_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column last_updated_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "sar_reports" ADD COLUMN IF NOT EXISTS "created_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column created_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "sar_reports" ADD COLUMN IF NOT EXISTS "last_updated_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column last_updated_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "compliance_exports" ADD COLUMN IF NOT EXISTS "created_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column created_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "compliance_exports" ADD COLUMN IF NOT EXISTS "last_updated_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column last_updated_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "settlement_cycles" ADD COLUMN IF NOT EXISTS "created_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column created_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "settlement_cycles" ADD COLUMN IF NOT EXISTS "last_updated_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column last_updated_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "settlement_positions" ADD COLUMN IF NOT EXISTS "created_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column created_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "settlement_positions" ADD COLUMN IF NOT EXISTS "last_updated_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column last_updated_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "settlement_instructions" ADD COLUMN IF NOT EXISTS "created_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column created_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "settlement_instructions" ADD COLUMN IF NOT EXISTS "last_updated_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column last_updated_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "settlement_fails" ADD COLUMN IF NOT EXISTS "created_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column created_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "settlement_fails" ADD COLUMN IF NOT EXISTS "last_updated_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column last_updated_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "regulatory_reports" ADD COLUMN IF NOT EXISTS "created_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column created_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "regulatory_reports" ADD COLUMN IF NOT EXISTS "last_updated_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column last_updated_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "regulatory_report_schedules" ADD COLUMN IF NOT EXISTS "created_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column created_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "regulatory_report_schedules" ADD COLUMN IF NOT EXISTS "last_updated_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column last_updated_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "market_maker_profiles" ADD COLUMN IF NOT EXISTS "created_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column created_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "market_maker_profiles" ADD COLUMN IF NOT EXISTS "last_updated_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column last_updated_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "market_maker_obligations" ADD COLUMN IF NOT EXISTS "created_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column created_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "market_maker_obligations" ADD COLUMN IF NOT EXISTS "last_updated_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column last_updated_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "market_maker_quote_snapshots" ADD COLUMN IF NOT EXISTS "created_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column created_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "market_maker_quote_snapshots" ADD COLUMN IF NOT EXISTS "last_updated_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column last_updated_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "market_maker_performance_reports" ADD COLUMN IF NOT EXISTS "created_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column created_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "market_maker_performance_reports" ADD COLUMN IF NOT EXISTS "last_updated_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column last_updated_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "clearing_accounts" ADD COLUMN IF NOT EXISTS "created_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column created_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "clearing_accounts" ADD COLUMN IF NOT EXISTS "last_updated_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column last_updated_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "margin_calls" ADD COLUMN IF NOT EXISTS "created_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column created_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "margin_calls" ADD COLUMN IF NOT EXISTS "last_updated_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column last_updated_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "margin_call_events" ADD COLUMN IF NOT EXISTS "created_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column created_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "margin_call_events" ADD COLUMN IF NOT EXISTS "last_updated_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column last_updated_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "auto_liquidation_orders" ADD COLUMN IF NOT EXISTS "created_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column created_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "auto_liquidation_orders" ADD COLUMN IF NOT EXISTS "last_updated_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column last_updated_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "ir_events" ADD COLUMN IF NOT EXISTS "created_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column created_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "ir_events" ADD COLUMN IF NOT EXISTS "last_updated_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column last_updated_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "ir_documents" ADD COLUMN IF NOT EXISTS "created_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column created_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "ir_documents" ADD COLUMN IF NOT EXISTS "last_updated_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column last_updated_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "shareholder_registry" ADD COLUMN IF NOT EXISTS "created_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column created_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "shareholder_registry" ADD COLUMN IF NOT EXISTS "last_updated_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column last_updated_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "ir_subscriptions" ADD COLUMN IF NOT EXISTS "created_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column created_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "ir_subscriptions" ADD COLUMN IF NOT EXISTS "last_updated_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column last_updated_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "circuit_breaker_rules" ADD COLUMN IF NOT EXISTS "created_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column created_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "circuit_breaker_rules" ADD COLUMN IF NOT EXISTS "last_updated_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column last_updated_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "circuit_breaker_events" ADD COLUMN IF NOT EXISTS "created_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column created_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "circuit_breaker_events" ADD COLUMN IF NOT EXISTS "last_updated_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column last_updated_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "wash_trade_flags" ADD COLUMN IF NOT EXISTS "created_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column created_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "wash_trade_flags" ADD COLUMN IF NOT EXISTS "last_updated_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column last_updated_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "futures_contracts" ADD COLUMN IF NOT EXISTS "created_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column created_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "futures_contracts" ADD COLUMN IF NOT EXISTS "last_updated_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column last_updated_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "futures_positions" ADD COLUMN IF NOT EXISTS "created_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column created_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "futures_positions" ADD COLUMN IF NOT EXISTS "last_updated_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column last_updated_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "futures_settlements" ADD COLUMN IF NOT EXISTS "created_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column created_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "futures_settlements" ADD COLUMN IF NOT EXISTS "last_updated_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column last_updated_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "open_interest_snapshots" ADD COLUMN IF NOT EXISTS "created_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column created_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "open_interest_snapshots" ADD COLUMN IF NOT EXISTS "last_updated_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column last_updated_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "options_contracts" ADD COLUMN IF NOT EXISTS "created_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column created_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "options_contracts" ADD COLUMN IF NOT EXISTS "last_updated_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column last_updated_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "options_positions" ADD COLUMN IF NOT EXISTS "created_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column created_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "options_positions" ADD COLUMN IF NOT EXISTS "last_updated_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column last_updated_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "portfolio_equity_snapshots" ADD COLUMN IF NOT EXISTS "created_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column created_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "portfolio_equity_snapshots" ADD COLUMN IF NOT EXISTS "last_updated_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column last_updated_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "farmer_profiles" ADD COLUMN IF NOT EXISTS "created_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column created_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "farmer_profiles" ADD COLUMN IF NOT EXISTS "last_updated_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column last_updated_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "farmer_onboarding_drafts" ADD COLUMN IF NOT EXISTS "created_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column created_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "farmer_onboarding_drafts" ADD COLUMN IF NOT EXISTS "last_updated_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column last_updated_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "farm_profiles" ADD COLUMN IF NOT EXISTS "created_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column created_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "farm_profiles" ADD COLUMN IF NOT EXISTS "last_updated_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column last_updated_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "crop_listings" ADD COLUMN IF NOT EXISTS "created_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column created_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "crop_listings" ADD COLUMN IF NOT EXISTS "last_updated_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column last_updated_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "listing_messages" ADD COLUMN IF NOT EXISTS "created_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column created_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "listing_messages" ADD COLUMN IF NOT EXISTS "last_updated_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column last_updated_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "farmer_earnings" ADD COLUMN IF NOT EXISTS "created_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column created_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "farmer_earnings" ADD COLUMN IF NOT EXISTS "last_updated_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column last_updated_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "trader_profiles" ADD COLUMN IF NOT EXISTS "created_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column created_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "trader_profiles" ADD COLUMN IF NOT EXISTS "last_updated_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column last_updated_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "broker_profiles" ADD COLUMN IF NOT EXISTS "created_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column created_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "broker_profiles" ADD COLUMN IF NOT EXISTS "last_updated_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column last_updated_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "warehouse_operator_profiles" ADD COLUMN IF NOT EXISTS "created_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column created_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "warehouse_operator_profiles" ADD COLUMN IF NOT EXISTS "last_updated_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column last_updated_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "market_maker_onboarding_profiles" ADD COLUMN IF NOT EXISTS "created_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column created_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "market_maker_onboarding_profiles" ADD COLUMN IF NOT EXISTS "last_updated_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column last_updated_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "kyc_audit_log" ADD COLUMN IF NOT EXISTS "created_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column created_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "kyc_audit_log" ADD COLUMN IF NOT EXISTS "last_updated_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column last_updated_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "kyc_analysis_results" ADD COLUMN IF NOT EXISTS "created_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column created_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "kyc_analysis_results" ADD COLUMN IF NOT EXISTS "last_updated_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column last_updated_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "bulk_listing_approvals" ADD COLUMN IF NOT EXISTS "created_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column created_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "bulk_listing_approvals" ADD COLUMN IF NOT EXISTS "last_updated_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column last_updated_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "re_kyc_flags" ADD COLUMN IF NOT EXISTS "created_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column created_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "re_kyc_flags" ADD COLUMN IF NOT EXISTS "last_updated_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column last_updated_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "live_prices" ADD COLUMN IF NOT EXISTS "created_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column created_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "live_prices" ADD COLUMN IF NOT EXISTS "last_updated_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column last_updated_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "participant_performance_metrics" ADD COLUMN IF NOT EXISTS "created_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column created_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "participant_performance_metrics" ADD COLUMN IF NOT EXISTS "last_updated_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column last_updated_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "corporate_actions" ADD COLUMN IF NOT EXISTS "created_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column created_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "corporate_actions" ADD COLUMN IF NOT EXISTS "last_updated_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column last_updated_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "trade_fills" ADD COLUMN IF NOT EXISTS "created_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column created_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "trade_fills" ADD COLUMN IF NOT EXISTS "last_updated_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column last_updated_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "order_book_levels" ADD COLUMN IF NOT EXISTS "created_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column created_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "order_book_levels" ADD COLUMN IF NOT EXISTS "last_updated_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column last_updated_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "pre_trad_risk_checks" ADD COLUMN IF NOT EXISTS "created_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column created_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "pre_trad_risk_checks" ADD COLUMN IF NOT EXISTS "last_updated_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column last_updated_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "mojaloop_parties" ADD COLUMN IF NOT EXISTS "created_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column created_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "mojaloop_parties" ADD COLUMN IF NOT EXISTS "last_updated_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column last_updated_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "mojaloop_quotes" ADD COLUMN IF NOT EXISTS "created_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column created_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "mojaloop_quotes" ADD COLUMN IF NOT EXISTS "last_updated_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column last_updated_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "mojaloop_transfers" ADD COLUMN IF NOT EXISTS "created_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column created_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "mojaloop_transfers" ADD COLUMN IF NOT EXISTS "last_updated_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column last_updated_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "mojaloop_callbacks" ADD COLUMN IF NOT EXISTS "created_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column created_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "mojaloop_callbacks" ADD COLUMN IF NOT EXISTS "last_updated_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column last_updated_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "mojaloop_dfsps" ADD COLUMN IF NOT EXISTS "created_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column created_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "mojaloop_dfsps" ADD COLUMN IF NOT EXISTS "last_updated_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column last_updated_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "mojaloop_dead_letter" ADD COLUMN IF NOT EXISTS "created_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column created_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "mojaloop_dead_letter" ADD COLUMN IF NOT EXISTS "last_updated_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column last_updated_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "dfsp_tiers" ADD COLUMN IF NOT EXISTS "created_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column created_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "dfsp_tiers" ADD COLUMN IF NOT EXISTS "last_updated_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column last_updated_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "mojaloop_fee_schedules" ADD COLUMN IF NOT EXISTS "created_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column created_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "mojaloop_fee_schedules" ADD COLUMN IF NOT EXISTS "last_updated_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column last_updated_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "dfsp_kyc_records" ADD COLUMN IF NOT EXISTS "created_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column created_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "dfsp_kyc_records" ADD COLUMN IF NOT EXISTS "last_updated_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column last_updated_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "webauthn_credentials" ADD COLUMN IF NOT EXISTS "created_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column created_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "webauthn_credentials" ADD COLUMN IF NOT EXISTS "last_updated_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column last_updated_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "webauthn_challenges" ADD COLUMN IF NOT EXISTS "created_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column created_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "webauthn_challenges" ADD COLUMN IF NOT EXISTS "last_updated_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column last_updated_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "user_mfa_settings" ADD COLUMN IF NOT EXISTS "created_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column created_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "user_mfa_settings" ADD COLUMN IF NOT EXISTS "last_updated_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column last_updated_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "mfa_otp_codes" ADD COLUMN IF NOT EXISTS "created_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column created_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "mfa_otp_codes" ADD COLUMN IF NOT EXISTS "last_updated_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column last_updated_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "broker_clients" ADD COLUMN IF NOT EXISTS "created_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column created_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "broker_clients" ADD COLUMN IF NOT EXISTS "last_updated_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column last_updated_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "broker_commissions" ADD COLUMN IF NOT EXISTS "created_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column created_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "broker_commissions" ADD COLUMN IF NOT EXISTS "last_updated_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column last_updated_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "push_subscriptions" ADD COLUMN IF NOT EXISTS "created_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column created_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "push_subscriptions" ADD COLUMN IF NOT EXISTS "last_updated_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column last_updated_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "warehouse_messages" ADD COLUMN IF NOT EXISTS "created_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column created_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "warehouse_messages" ADD COLUMN IF NOT EXISTS "last_updated_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column last_updated_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "fixed_income_instruments" ADD COLUMN IF NOT EXISTS "created_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column created_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "fixed_income_instruments" ADD COLUMN IF NOT EXISTS "last_updated_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column last_updated_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "fixed_income_trades" ADD COLUMN IF NOT EXISTS "created_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column created_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "fixed_income_trades" ADD COLUMN IF NOT EXISTS "last_updated_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column last_updated_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "commodity_indexes" ADD COLUMN IF NOT EXISTS "created_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column created_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "commodity_indexes" ADD COLUMN IF NOT EXISTS "last_updated_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column last_updated_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "commodity_index_history" ADD COLUMN IF NOT EXISTS "created_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column created_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "commodity_index_history" ADD COLUMN IF NOT EXISTS "last_updated_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column last_updated_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "workbench_farms" ADD COLUMN IF NOT EXISTS "created_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column created_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "workbench_farms" ADD COLUMN IF NOT EXISTS "last_updated_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column last_updated_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "workbench_crop_plans" ADD COLUMN IF NOT EXISTS "created_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column created_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "workbench_crop_plans" ADD COLUMN IF NOT EXISTS "last_updated_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column last_updated_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "workbench_soil_tests" ADD COLUMN IF NOT EXISTS "created_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column created_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "workbench_soil_tests" ADD COLUMN IF NOT EXISTS "last_updated_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column last_updated_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "bank_financing_applications" ADD COLUMN IF NOT EXISTS "created_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column created_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "bank_financing_applications" ADD COLUMN IF NOT EXISTS "last_updated_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column last_updated_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "abcp_programs" ADD COLUMN IF NOT EXISTS "created_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column created_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "abcp_programs" ADD COLUMN IF NOT EXISTS "last_updated_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column last_updated_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "crop_production_reports" ADD COLUMN IF NOT EXISTS "created_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column created_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "crop_production_reports" ADD COLUMN IF NOT EXISTS "last_updated_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column last_updated_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "input_financing_loans" ADD COLUMN IF NOT EXISTS "created_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column created_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "input_financing_loans" ADD COLUMN IF NOT EXISTS "last_updated_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column last_updated_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "input_financing_repayments" ADD COLUMN IF NOT EXISTS "created_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column created_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "input_financing_repayments" ADD COLUMN IF NOT EXISTS "last_updated_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column last_updated_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "field_agents" ADD COLUMN IF NOT EXISTS "created_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column created_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "field_agents" ADD COLUMN IF NOT EXISTS "last_updated_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column last_updated_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "field_visits" ADD COLUMN IF NOT EXISTS "created_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column created_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "field_visits" ADD COLUMN IF NOT EXISTS "last_updated_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column last_updated_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "push_tokens" ADD COLUMN IF NOT EXISTS "created_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column created_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "push_tokens" ADD COLUMN IF NOT EXISTS "last_updated_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column last_updated_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "ussd_sessions" ADD COLUMN IF NOT EXISTS "created_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column created_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "ussd_sessions" ADD COLUMN IF NOT EXISTS "last_updated_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column last_updated_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "ussd_pins" ADD COLUMN IF NOT EXISTS "created_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column created_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "ussd_pins" ADD COLUMN IF NOT EXISTS "last_updated_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column last_updated_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "whatsapp_contacts" ADD COLUMN IF NOT EXISTS "created_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column created_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "whatsapp_contacts" ADD COLUMN IF NOT EXISTS "last_updated_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column last_updated_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "whatsapp_messages" ADD COLUMN IF NOT EXISTS "created_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column created_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "whatsapp_messages" ADD COLUMN IF NOT EXISTS "last_updated_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column last_updated_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "telegram_contacts" ADD COLUMN IF NOT EXISTS "created_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column created_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "telegram_contacts" ADD COLUMN IF NOT EXISTS "last_updated_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column last_updated_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "telegram_messages" ADD COLUMN IF NOT EXISTS "created_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column created_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "telegram_messages" ADD COLUMN IF NOT EXISTS "last_updated_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column last_updated_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "bank_accounts" ADD COLUMN IF NOT EXISTS "created_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column created_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "bank_accounts" ADD COLUMN IF NOT EXISTS "last_updated_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column last_updated_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "bank_transactions" ADD COLUMN IF NOT EXISTS "created_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column created_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "bank_transactions" ADD COLUMN IF NOT EXISTS "last_updated_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column last_updated_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "stripe_payments" ADD COLUMN IF NOT EXISTS "created_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column created_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "stripe_payments" ADD COLUMN IF NOT EXISTS "last_updated_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column last_updated_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "credit_scores" ADD COLUMN IF NOT EXISTS "created_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column created_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "credit_scores" ADD COLUMN IF NOT EXISTS "last_updated_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column last_updated_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "collateral_registry" ADD COLUMN IF NOT EXISTS "created_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column created_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "collateral_registry" ADD COLUMN IF NOT EXISTS "last_updated_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column last_updated_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "loan_repayment_schedules" ADD COLUMN IF NOT EXISTS "created_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column created_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "loan_repayment_schedules" ADD COLUMN IF NOT EXISTS "last_updated_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column last_updated_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "crop_insurance_policies" ADD COLUMN IF NOT EXISTS "created_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column created_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "crop_insurance_policies" ADD COLUMN IF NOT EXISTS "last_updated_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column last_updated_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "loan_lifecycle_events" ADD COLUMN IF NOT EXISTS "created_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column created_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "loan_lifecycle_events" ADD COLUMN IF NOT EXISTS "last_updated_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column last_updated_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "instruments" ADD COLUMN IF NOT EXISTS "created_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column created_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "instruments" ADD COLUMN IF NOT EXISTS "last_updated_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column last_updated_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "warehouses" ADD COLUMN IF NOT EXISTS "created_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column created_by skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "warehouses" ADD COLUMN IF NOT EXISTS "last_updated_by" integer;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column last_updated_by skipped: %', SQLERRM;
END $$;

-- ---- 0052_pbac_policies.sql ----
-- Migration 0052: PBAC Policies persistence table
-- Allows policy store to survive server restarts

CREATE TABLE IF NOT EXISTS "pbac_policies" (
  "id"          varchar(128) PRIMARY KEY,
  "name"        varchar(200) NOT NULL,
  "description" text,
  "effect"      varchar(8)   NOT NULL CHECK (effect IN ('allow', 'deny')),
  "principals"  jsonb        NOT NULL DEFAULT '[]',
  "resources"   jsonb        NOT NULL DEFAULT '[]',
  "actions"     jsonb        NOT NULL DEFAULT '[]',
  "conditions"  jsonb,
  "priority"    integer      NOT NULL DEFAULT 500,
  "enabled"     boolean      NOT NULL DEFAULT true,
  "created_at"  timestamp    NOT NULL DEFAULT now(),
  "updated_at"  timestamp    NOT NULL DEFAULT now()
);
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS "pbac_policies_effect_idx"   ON "pbac_policies" ("effect");
EXCEPTION WHEN duplicate_table OR duplicate_object OR undefined_column OR undefined_table THEN
  RAISE NOTICE 'index pbac_policies_effect_idx skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS "pbac_policies_enabled_idx"  ON "pbac_policies" ("enabled");
EXCEPTION WHEN duplicate_table OR duplicate_object OR undefined_column OR undefined_table THEN
  RAISE NOTICE 'index pbac_policies_enabled_idx skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS "pbac_policies_priority_idx" ON "pbac_policies" ("priority" DESC);
EXCEPTION WHEN duplicate_table OR duplicate_object OR undefined_column OR undefined_table THEN
  RAISE NOTICE 'index pbac_policies_priority_idx skipped: %', SQLERRM;
END $$;

-- ---- 0053_lovely_spitfire.sql ----
CREATE TABLE IF NOT EXISTS "pbac_policies" (
	"id" varchar(128) PRIMARY KEY NOT NULL,
	"name" varchar(200) NOT NULL,
	"description" text,
	"effect" varchar(8) NOT NULL,
	"principals" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"resources" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"actions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"conditions" jsonb,
	"priority" integer DEFAULT 500 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

-- ---- 0054_next_wildside.sql ----
DO $$ BEGIN
  CREATE TYPE "public"."liveness_session_status" AS ENUM('PENDING', 'COMPLETE', 'EXPIRED', 'FAILED');
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'type liveness_session_status already exists, skipping';
END $$;
DO $$ BEGIN
  CREATE TYPE "public"."spoof_type" AS ENUM('NONE', 'PRINTED_PHOTO', 'SCREEN_REPLAY', 'PAPER_MASK', '3D_MASK', 'DEEPFAKE', 'HIGH_QUALITY_PHOTO', 'UNKNOWN');
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'type spoof_type already exists, skipping';
END $$;
ALTER TYPE "public"."collateral_type" ADD VALUE IF NOT EXISTS 'LAND_TITLE';
ALTER TYPE "public"."collateral_type" ADD VALUE IF NOT EXISTS 'VEHICLE';
ALTER TYPE "public"."collateral_type" ADD VALUE IF NOT EXISTS 'EQUIPMENT';
ALTER TYPE "public"."collateral_type" ADD VALUE IF NOT EXISTS 'LIVESTOCK';
ALTER TYPE "public"."collateral_type" ADD VALUE IF NOT EXISTS 'CROP_STANDING';
ALTER TYPE "public"."collateral_type" ADD VALUE IF NOT EXISTS 'BANK_GUARANTEE';
ALTER TYPE "public"."collateral_type" ADD VALUE IF NOT EXISTS 'CASH_DEPOSIT';
ALTER TYPE "public"."collateral_type" ADD VALUE IF NOT EXISTS 'OTHER';
ALTER TYPE "public"."security_event_type" ADD VALUE IF NOT EXISTS 'LIVENESS_PASS';
ALTER TYPE "public"."security_event_type" ADD VALUE IF NOT EXISTS 'LIVENESS_FAIL';
ALTER TYPE "public"."security_event_type" ADD VALUE IF NOT EXISTS 'LIVENESS_SPOOF_DETECTED';
ALTER TYPE "public"."security_event_type" ADD VALUE IF NOT EXISTS 'FACE_MATCH_PASS';
ALTER TYPE "public"."security_event_type" ADD VALUE IF NOT EXISTS 'FACE_MATCH_FAIL';
ALTER TYPE "public"."security_event_type" ADD VALUE IF NOT EXISTS 'PASSIVE_LIVENESS_FAIL';
CREATE TABLE IF NOT EXISTS "kyc_liveness_sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"session_id" varchar(64) NOT NULL,
	"application_id" varchar(64),
	"user_id" integer,
	"challenges" text DEFAULT '[]' NOT NULL,
	"current_challenge_index" integer DEFAULT 0 NOT NULL,
	"results" text DEFAULT '[]' NOT NULL,
	"overall_result" varchar(16),
	"face_match_score" real,
	"spoof_type" "spoof_type" DEFAULT 'UNKNOWN',
	"spoof_confidence" real DEFAULT 0,
	"landmarks_json" text,
	"status" "liveness_session_status" DEFAULT 'PENDING' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "kyc_liveness_sessions_session_id_unique" UNIQUE("session_id")
);
ALTER TABLE "collateral_registry" ALTER COLUMN "status" SET DEFAULT 'ACTIVE';
DO $$ BEGIN
  ALTER TABLE "user_preferences" ADD COLUMN IF NOT EXISTS "surv_alert_position_breach" boolean DEFAULT true NOT NULL;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column surv_alert_position_breach skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "user_preferences" ADD COLUMN IF NOT EXISTS "surv_alert_wash_trading" boolean DEFAULT true NOT NULL;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column surv_alert_wash_trading skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "user_preferences" ADD COLUMN IF NOT EXISTS "surv_alert_price_manipulation" boolean DEFAULT true NOT NULL;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column surv_alert_price_manipulation skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "user_preferences" ADD COLUMN IF NOT EXISTS "surv_alert_volume_spike" boolean DEFAULT true NOT NULL;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column surv_alert_volume_spike skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "user_preferences" ADD COLUMN IF NOT EXISTS "surv_alert_circuit_breaker" boolean DEFAULT true NOT NULL;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column surv_alert_circuit_breaker skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "user_preferences" ADD COLUMN IF NOT EXISTS "surv_notif_email" boolean DEFAULT true NOT NULL;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column surv_notif_email skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "user_preferences" ADD COLUMN IF NOT EXISTS "surv_notif_sms" boolean DEFAULT false NOT NULL;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column surv_notif_sms skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "kyc_liveness_sessions" ADD CONSTRAINT "kyc_liveness_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object OR duplicate_table OR undefined_column OR undefined_table
  OR datatype_mismatch OR foreign_key_violation OR feature_not_supported THEN
  RAISE NOTICE 'constraint kyc_liveness_sessions_user_id_users_id_fk skipped: %', SQLERRM;
END $$;

-- ---- 0055_margin_alert_thresholds.sql ----
DO $$ BEGIN
  -- Migration 0055: Per-user margin alert thresholds
-- Adds marginWarningPct and marginCriticalPct to user_preferences.
-- Defaults match the global constants (80% warning, 95% critical).

ALTER TABLE "user_preferences"
  ADD COLUMN IF NOT EXISTS "margin_warning_pct"  integer NOT NULL DEFAULT 80,
  ADD COLUMN IF NOT EXISTS "margin_critical_pct" integer NOT NULL DEFAULT 95;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column margin_warning_pct skipped: %', SQLERRM;
END $$;

-- ---- 0055_thin_bedlam.sql ----
DO $$ BEGIN
  ALTER TABLE "user_preferences" ADD COLUMN IF NOT EXISTS "margin_warning_pct" integer DEFAULT 80 NOT NULL;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column margin_warning_pct skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "user_preferences" ADD COLUMN IF NOT EXISTS "margin_critical_pct" integer DEFAULT 95 NOT NULL;
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column margin_critical_pct skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "aml_flags" ADD CONSTRAINT "aml_flags_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object OR duplicate_table OR undefined_column OR undefined_table
  OR datatype_mismatch OR foreign_key_violation OR feature_not_supported THEN
  RAISE NOTICE 'constraint aml_flags_user_id_users_id_fk skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object OR duplicate_table OR undefined_column OR undefined_table
  OR datatype_mismatch OR foreign_key_violation OR feature_not_supported THEN
  RAISE NOTICE 'constraint api_keys_user_id_users_id_fk skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object OR duplicate_table OR undefined_column OR undefined_table
  OR datatype_mismatch OR foreign_key_violation OR feature_not_supported THEN
  RAISE NOTICE 'constraint audit_log_user_id_users_id_fk skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "auto_liquidation_orders" ADD CONSTRAINT "auto_liquidation_orders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object OR duplicate_table OR undefined_column OR undefined_table
  OR datatype_mismatch OR foreign_key_violation OR feature_not_supported THEN
  RAISE NOTICE 'constraint auto_liquidation_orders_user_id_users_id_fk skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object OR duplicate_table OR undefined_column OR undefined_table
  OR datatype_mismatch OR foreign_key_violation OR feature_not_supported THEN
  RAISE NOTICE 'constraint bank_accounts_user_id_users_id_fk skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "bank_financing_applications" ADD CONSTRAINT "bank_financing_applications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object OR duplicate_table OR undefined_column OR undefined_table
  OR datatype_mismatch OR foreign_key_violation OR feature_not_supported THEN
  RAISE NOTICE 'constraint bank_financing_applications_user_id_users_id_fk skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object OR duplicate_table OR undefined_column OR undefined_table
  OR datatype_mismatch OR foreign_key_violation OR feature_not_supported THEN
  RAISE NOTICE 'constraint bank_transactions_user_id_users_id_fk skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "broker_profiles" ADD CONSTRAINT "broker_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object OR duplicate_table OR undefined_column OR undefined_table
  OR datatype_mismatch OR foreign_key_violation OR feature_not_supported THEN
  RAISE NOTICE 'constraint broker_profiles_user_id_users_id_fk skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "clearing_accounts" ADD CONSTRAINT "clearing_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object OR duplicate_table OR undefined_column OR undefined_table
  OR datatype_mismatch OR foreign_key_violation OR feature_not_supported THEN
  RAISE NOTICE 'constraint clearing_accounts_user_id_users_id_fk skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "collateral_items" ADD CONSTRAINT "collateral_items_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object OR duplicate_table OR undefined_column OR undefined_table
  OR datatype_mismatch OR foreign_key_violation OR feature_not_supported THEN
  RAISE NOTICE 'constraint collateral_items_user_id_users_id_fk skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "collateral_ledger" ADD CONSTRAINT "collateral_ledger_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object OR duplicate_table OR undefined_column OR undefined_table
  OR datatype_mismatch OR foreign_key_violation OR feature_not_supported THEN
  RAISE NOTICE 'constraint collateral_ledger_user_id_users_id_fk skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "credit_scores" ADD CONSTRAINT "credit_scores_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object OR duplicate_table OR undefined_column OR undefined_table
  OR datatype_mismatch OR foreign_key_violation OR feature_not_supported THEN
  RAISE NOTICE 'constraint credit_scores_user_id_users_id_fk skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "crop_insurance_policies" ADD CONSTRAINT "crop_insurance_policies_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object OR duplicate_table OR undefined_column OR undefined_table
  OR datatype_mismatch OR foreign_key_violation OR feature_not_supported THEN
  RAISE NOTICE 'constraint crop_insurance_policies_user_id_users_id_fk skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "crop_listings" ADD CONSTRAINT "crop_listings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object OR duplicate_table OR undefined_column OR undefined_table
  OR datatype_mismatch OR foreign_key_violation OR feature_not_supported THEN
  RAISE NOTICE 'constraint crop_listings_user_id_users_id_fk skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "delivery_orders" ADD CONSTRAINT "delivery_orders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object OR duplicate_table OR undefined_column OR undefined_table
  OR datatype_mismatch OR foreign_key_violation OR feature_not_supported THEN
  RAISE NOTICE 'constraint delivery_orders_user_id_users_id_fk skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "deposit_requests" ADD CONSTRAINT "deposit_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object OR duplicate_table OR undefined_column OR undefined_table
  OR datatype_mismatch OR foreign_key_violation OR feature_not_supported THEN
  RAISE NOTICE 'constraint deposit_requests_user_id_users_id_fk skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "device_sessions" ADD CONSTRAINT "device_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object OR duplicate_table OR undefined_column OR undefined_table
  OR datatype_mismatch OR foreign_key_violation OR feature_not_supported THEN
  RAISE NOTICE 'constraint device_sessions_user_id_users_id_fk skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "farm_profiles" ADD CONSTRAINT "farm_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object OR duplicate_table OR undefined_column OR undefined_table
  OR datatype_mismatch OR foreign_key_violation OR feature_not_supported THEN
  RAISE NOTICE 'constraint farm_profiles_user_id_users_id_fk skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "farmer_earnings" ADD CONSTRAINT "farmer_earnings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object OR duplicate_table OR undefined_column OR undefined_table
  OR datatype_mismatch OR foreign_key_violation OR feature_not_supported THEN
  RAISE NOTICE 'constraint farmer_earnings_user_id_users_id_fk skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "farmer_onboarding_drafts" ADD CONSTRAINT "farmer_onboarding_drafts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object OR duplicate_table OR undefined_column OR undefined_table
  OR datatype_mismatch OR foreign_key_violation OR feature_not_supported THEN
  RAISE NOTICE 'constraint farmer_onboarding_drafts_user_id_users_id_fk skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "farmer_profiles" ADD CONSTRAINT "farmer_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object OR duplicate_table OR undefined_column OR undefined_table
  OR datatype_mismatch OR foreign_key_violation OR feature_not_supported THEN
  RAISE NOTICE 'constraint farmer_profiles_user_id_users_id_fk skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "field_agents" ADD CONSTRAINT "field_agents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object OR duplicate_table OR undefined_column OR undefined_table
  OR datatype_mismatch OR foreign_key_violation OR feature_not_supported THEN
  RAISE NOTICE 'constraint field_agents_user_id_users_id_fk skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "futures_positions" ADD CONSTRAINT "futures_positions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object OR duplicate_table OR undefined_column OR undefined_table
  OR datatype_mismatch OR foreign_key_violation OR feature_not_supported THEN
  RAISE NOTICE 'constraint futures_positions_user_id_users_id_fk skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "ir_subscriptions" ADD CONSTRAINT "ir_subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object OR duplicate_table OR undefined_column OR undefined_table
  OR datatype_mismatch OR foreign_key_violation OR feature_not_supported THEN
  RAISE NOTICE 'constraint ir_subscriptions_user_id_users_id_fk skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "kyc_analysis_results" ADD CONSTRAINT "kyc_analysis_results_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object OR duplicate_table OR undefined_column OR undefined_table
  OR datatype_mismatch OR foreign_key_violation OR feature_not_supported THEN
  RAISE NOTICE 'constraint kyc_analysis_results_user_id_users_id_fk skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "kyc_queue" ADD CONSTRAINT "kyc_queue_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object OR duplicate_table OR undefined_column OR undefined_table
  OR datatype_mismatch OR foreign_key_violation OR feature_not_supported THEN
  RAISE NOTICE 'constraint kyc_queue_user_id_users_id_fk skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "margin_accounts" ADD CONSTRAINT "margin_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object OR duplicate_table OR undefined_column OR undefined_table
  OR datatype_mismatch OR foreign_key_violation OR feature_not_supported THEN
  RAISE NOTICE 'constraint margin_accounts_user_id_users_id_fk skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "margin_calls" ADD CONSTRAINT "margin_calls_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object OR duplicate_table OR undefined_column OR undefined_table
  OR datatype_mismatch OR foreign_key_violation OR feature_not_supported THEN
  RAISE NOTICE 'constraint margin_calls_user_id_users_id_fk skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "market_maker_onboarding_profiles" ADD CONSTRAINT "market_maker_onboarding_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object OR duplicate_table OR undefined_column OR undefined_table
  OR datatype_mismatch OR foreign_key_violation OR feature_not_supported THEN
  RAISE NOTICE 'constraint market_maker_onboarding_profiles_user_id_users_id_fk skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "market_maker_profiles" ADD CONSTRAINT "market_maker_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object OR duplicate_table OR undefined_column OR undefined_table
  OR datatype_mismatch OR foreign_key_violation OR feature_not_supported THEN
  RAISE NOTICE 'constraint market_maker_profiles_user_id_users_id_fk skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "mfa_otp_codes" ADD CONSTRAINT "mfa_otp_codes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object OR duplicate_table OR undefined_column OR undefined_table
  OR datatype_mismatch OR foreign_key_violation OR feature_not_supported THEN
  RAISE NOTICE 'constraint mfa_otp_codes_user_id_users_id_fk skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object OR duplicate_table OR undefined_column OR undefined_table
  OR datatype_mismatch OR foreign_key_violation OR feature_not_supported THEN
  RAISE NOTICE 'constraint notifications_user_id_users_id_fk skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "options_positions" ADD CONSTRAINT "options_positions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object OR duplicate_table OR undefined_column OR undefined_table
  OR datatype_mismatch OR foreign_key_violation OR feature_not_supported THEN
  RAISE NOTICE 'constraint options_positions_user_id_users_id_fk skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "order_amendments" ADD CONSTRAINT "order_amendments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object OR duplicate_table OR undefined_column OR undefined_table
  OR datatype_mismatch OR foreign_key_violation OR feature_not_supported THEN
  RAISE NOTICE 'constraint order_amendments_user_id_users_id_fk skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "orders" ADD CONSTRAINT "orders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object OR duplicate_table OR undefined_column OR undefined_table
  OR datatype_mismatch OR foreign_key_violation OR feature_not_supported THEN
  RAISE NOTICE 'constraint orders_user_id_users_id_fk skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "participant_performance_metrics" ADD CONSTRAINT "participant_performance_metrics_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object OR duplicate_table OR undefined_column OR undefined_table
  OR datatype_mismatch OR foreign_key_violation OR feature_not_supported THEN
  RAISE NOTICE 'constraint participant_performance_metrics_user_id_users_id_fk skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "portfolio_equity_snapshots" ADD CONSTRAINT "portfolio_equity_snapshots_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object OR duplicate_table OR undefined_column OR undefined_table
  OR datatype_mismatch OR foreign_key_violation OR feature_not_supported THEN
  RAISE NOTICE 'constraint portfolio_equity_snapshots_user_id_users_id_fk skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "portfolio_snapshots" ADD CONSTRAINT "portfolio_snapshots_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object OR duplicate_table OR undefined_column OR undefined_table
  OR datatype_mismatch OR foreign_key_violation OR feature_not_supported THEN
  RAISE NOTICE 'constraint portfolio_snapshots_user_id_users_id_fk skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "positions" ADD CONSTRAINT "positions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object OR duplicate_table OR undefined_column OR undefined_table
  OR datatype_mismatch OR foreign_key_violation OR feature_not_supported THEN
  RAISE NOTICE 'constraint positions_user_id_users_id_fk skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "pre_trade_risk_checks" ADD CONSTRAINT "pre_trade_risk_checks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object OR duplicate_table OR undefined_column OR undefined_table
  OR datatype_mismatch OR foreign_key_violation OR feature_not_supported THEN
  RAISE NOTICE 'constraint pre_trade_risk_checks_user_id_users_id_fk skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "price_alerts" ADD CONSTRAINT "price_alerts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object OR duplicate_table OR undefined_column OR undefined_table
  OR datatype_mismatch OR foreign_key_violation OR feature_not_supported THEN
  RAISE NOTICE 'constraint price_alerts_user_id_users_id_fk skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "profiles" ADD CONSTRAINT "profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object OR duplicate_table OR undefined_column OR undefined_table
  OR datatype_mismatch OR foreign_key_violation OR feature_not_supported THEN
  RAISE NOTICE 'constraint profiles_user_id_users_id_fk skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object OR duplicate_table OR undefined_column OR undefined_table
  OR datatype_mismatch OR foreign_key_violation OR feature_not_supported THEN
  RAISE NOTICE 'constraint push_subscriptions_user_id_users_id_fk skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "push_tokens" ADD CONSTRAINT "push_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object OR duplicate_table OR undefined_column OR undefined_table
  OR datatype_mismatch OR foreign_key_violation OR feature_not_supported THEN
  RAISE NOTICE 'constraint push_tokens_user_id_users_id_fk skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "rate_limit_counters" ADD CONSTRAINT "rate_limit_counters_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object OR duplicate_table OR undefined_column OR undefined_table
  OR datatype_mismatch OR foreign_key_violation OR feature_not_supported THEN
  RAISE NOTICE 'constraint rate_limit_counters_user_id_users_id_fk skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "re_kyc_flags" ADD CONSTRAINT "re_kyc_flags_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object OR duplicate_table OR undefined_column OR undefined_table
  OR datatype_mismatch OR foreign_key_violation OR feature_not_supported THEN
  RAISE NOTICE 'constraint re_kyc_flags_user_id_users_id_fk skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "sar_reports" ADD CONSTRAINT "sar_reports_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object OR duplicate_table OR undefined_column OR undefined_table
  OR datatype_mismatch OR foreign_key_violation OR feature_not_supported THEN
  RAISE NOTICE 'constraint sar_reports_user_id_users_id_fk skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "saved_orders" ADD CONSTRAINT "saved_orders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object OR duplicate_table OR undefined_column OR undefined_table
  OR datatype_mismatch OR foreign_key_violation OR feature_not_supported THEN
  RAISE NOTICE 'constraint saved_orders_user_id_users_id_fk skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "security_events" ADD CONSTRAINT "security_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object OR duplicate_table OR undefined_column OR undefined_table
  OR datatype_mismatch OR foreign_key_violation OR feature_not_supported THEN
  RAISE NOTICE 'constraint security_events_user_id_users_id_fk skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "settlement_positions" ADD CONSTRAINT "settlement_positions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object OR duplicate_table OR undefined_column OR undefined_table
  OR datatype_mismatch OR foreign_key_violation OR feature_not_supported THEN
  RAISE NOTICE 'constraint settlement_positions_user_id_users_id_fk skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "settlements" ADD CONSTRAINT "settlements_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object OR duplicate_table OR undefined_column OR undefined_table
  OR datatype_mismatch OR foreign_key_violation OR feature_not_supported THEN
  RAISE NOTICE 'constraint settlements_user_id_users_id_fk skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "shareholder_registry" ADD CONSTRAINT "shareholder_registry_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object OR duplicate_table OR undefined_column OR undefined_table
  OR datatype_mismatch OR foreign_key_violation OR feature_not_supported THEN
  RAISE NOTICE 'constraint shareholder_registry_user_id_users_id_fk skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "stripe_payments" ADD CONSTRAINT "stripe_payments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object OR duplicate_table OR undefined_column OR undefined_table
  OR datatype_mismatch OR foreign_key_violation OR feature_not_supported THEN
  RAISE NOTICE 'constraint stripe_payments_user_id_users_id_fk skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "telegram_contacts" ADD CONSTRAINT "telegram_contacts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object OR duplicate_table OR undefined_column OR undefined_table
  OR datatype_mismatch OR foreign_key_violation OR feature_not_supported THEN
  RAISE NOTICE 'constraint telegram_contacts_user_id_users_id_fk skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "totp_secrets" ADD CONSTRAINT "totp_secrets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object OR duplicate_table OR undefined_column OR undefined_table
  OR datatype_mismatch OR foreign_key_violation OR feature_not_supported THEN
  RAISE NOTICE 'constraint totp_secrets_user_id_users_id_fk skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "trader_profiles" ADD CONSTRAINT "trader_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object OR duplicate_table OR undefined_column OR undefined_table
  OR datatype_mismatch OR foreign_key_violation OR feature_not_supported THEN
  RAISE NOTICE 'constraint trader_profiles_user_id_users_id_fk skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "user_mfa_settings" ADD CONSTRAINT "user_mfa_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object OR duplicate_table OR undefined_column OR undefined_table
  OR datatype_mismatch OR foreign_key_violation OR feature_not_supported THEN
  RAISE NOTICE 'constraint user_mfa_settings_user_id_users_id_fk skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "user_preferences" ADD CONSTRAINT "user_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object OR duplicate_table OR undefined_column OR undefined_table
  OR datatype_mismatch OR foreign_key_violation OR feature_not_supported THEN
  RAISE NOTICE 'constraint user_preferences_user_id_users_id_fk skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "ussd_pins" ADD CONSTRAINT "ussd_pins_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object OR duplicate_table OR undefined_column OR undefined_table
  OR datatype_mismatch OR foreign_key_violation OR feature_not_supported THEN
  RAISE NOTICE 'constraint ussd_pins_user_id_users_id_fk skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "ussd_sessions" ADD CONSTRAINT "ussd_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object OR duplicate_table OR undefined_column OR undefined_table
  OR datatype_mismatch OR foreign_key_violation OR feature_not_supported THEN
  RAISE NOTICE 'constraint ussd_sessions_user_id_users_id_fk skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "velocity_ledger" ADD CONSTRAINT "velocity_ledger_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object OR duplicate_table OR undefined_column OR undefined_table
  OR datatype_mismatch OR foreign_key_violation OR feature_not_supported THEN
  RAISE NOTICE 'constraint velocity_ledger_user_id_users_id_fk skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "velocity_limit_config" ADD CONSTRAINT "velocity_limit_config_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object OR duplicate_table OR undefined_column OR undefined_table
  OR datatype_mismatch OR foreign_key_violation OR feature_not_supported THEN
  RAISE NOTICE 'constraint velocity_limit_config_user_id_users_id_fk skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "warehouse_messages" ADD CONSTRAINT "warehouse_messages_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object OR duplicate_table OR undefined_column OR undefined_table
  OR datatype_mismatch OR foreign_key_violation OR feature_not_supported THEN
  RAISE NOTICE 'constraint warehouse_messages_user_id_users_id_fk skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "warehouse_operator_profiles" ADD CONSTRAINT "warehouse_operator_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object OR duplicate_table OR undefined_column OR undefined_table
  OR datatype_mismatch OR foreign_key_violation OR feature_not_supported THEN
  RAISE NOTICE 'constraint warehouse_operator_profiles_user_id_users_id_fk skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "warehouse_receipts" ADD CONSTRAINT "warehouse_receipts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object OR duplicate_table OR undefined_column OR undefined_table
  OR datatype_mismatch OR foreign_key_violation OR feature_not_supported THEN
  RAISE NOTICE 'constraint warehouse_receipts_user_id_users_id_fk skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "wash_trade_flags" ADD CONSTRAINT "wash_trade_flags_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object OR duplicate_table OR undefined_column OR undefined_table
  OR datatype_mismatch OR foreign_key_violation OR feature_not_supported THEN
  RAISE NOTICE 'constraint wash_trade_flags_user_id_users_id_fk skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "watchlist" ADD CONSTRAINT "watchlist_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object OR duplicate_table OR undefined_column OR undefined_table
  OR datatype_mismatch OR foreign_key_violation OR feature_not_supported THEN
  RAISE NOTICE 'constraint watchlist_user_id_users_id_fk skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "webauthn_challenges" ADD CONSTRAINT "webauthn_challenges_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object OR duplicate_table OR undefined_column OR undefined_table
  OR datatype_mismatch OR foreign_key_violation OR feature_not_supported THEN
  RAISE NOTICE 'constraint webauthn_challenges_user_id_users_id_fk skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "webauthn_credentials" ADD CONSTRAINT "webauthn_credentials_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object OR duplicate_table OR undefined_column OR undefined_table
  OR datatype_mismatch OR foreign_key_violation OR feature_not_supported THEN
  RAISE NOTICE 'constraint webauthn_credentials_user_id_users_id_fk skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "whatsapp_contacts" ADD CONSTRAINT "whatsapp_contacts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object OR duplicate_table OR undefined_column OR undefined_table
  OR datatype_mismatch OR foreign_key_violation OR feature_not_supported THEN
  RAISE NOTICE 'constraint whatsapp_contacts_user_id_users_id_fk skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "withdrawal_verifications" ADD CONSTRAINT "withdrawal_verifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object OR duplicate_table OR undefined_column OR undefined_table
  OR datatype_mismatch OR foreign_key_violation OR feature_not_supported THEN
  RAISE NOTICE 'constraint withdrawal_verifications_user_id_users_id_fk skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "workbench_crop_plans" ADD CONSTRAINT "workbench_crop_plans_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object OR duplicate_table OR undefined_column OR undefined_table
  OR datatype_mismatch OR foreign_key_violation OR feature_not_supported THEN
  RAISE NOTICE 'constraint workbench_crop_plans_user_id_users_id_fk skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "workbench_farms" ADD CONSTRAINT "workbench_farms_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object OR duplicate_table OR undefined_column OR undefined_table
  OR datatype_mismatch OR foreign_key_violation OR feature_not_supported THEN
  RAISE NOTICE 'constraint workbench_farms_user_id_users_id_fk skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "workbench_soil_tests" ADD CONSTRAINT "workbench_soil_tests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object OR duplicate_table OR undefined_column OR undefined_table
  OR datatype_mismatch OR foreign_key_violation OR feature_not_supported THEN
  RAISE NOTICE 'constraint workbench_soil_tests_user_id_users_id_fk skipped: %', SQLERRM;
END $$;

-- ---- 0056_furry_namora.sql ----
DO $$ BEGIN
  ALTER TABLE "bank_transactions" ADD COLUMN IF NOT EXISTS "idempotency_key" varchar(128);
EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN
  RAISE NOTICE 'add column idempotency_key skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_idempotency_key_unique" UNIQUE("idempotency_key");
EXCEPTION WHEN duplicate_object OR duplicate_table OR undefined_column OR undefined_table
  OR datatype_mismatch OR foreign_key_violation OR feature_not_supported THEN
  RAISE NOTICE 'constraint bank_transactions_idempotency_key_unique skipped: %', SQLERRM;
END $$;
DO $$ BEGIN
  ALTER TABLE "settlements" ADD CONSTRAINT "settlements_order_id_unique" UNIQUE("order_id");
EXCEPTION WHEN duplicate_object OR duplicate_table OR undefined_column OR undefined_table
  OR datatype_mismatch OR foreign_key_violation OR feature_not_supported THEN
  RAISE NOTICE 'constraint settlements_order_id_unique skipped: %', SQLERRM;
END $$;
-- ============================================================
-- Post-migration: record this migration in the audit log
-- ============================================================
DO $$
BEGIN
  INSERT INTO audit_log (id, action, entity_type, entity_id, actor_id, metadata, created_at)
  VALUES (
    gen_random_uuid()::text,
    'SCHEMA_MIGRATION',
    'DATABASE',
    'nexcom_exchange',
    'system',
    jsonb_build_object(
      'generator', 'generate_migration.py',
      'applied_at', now()::text,
      'version', 'v62'
    ),
    now()
  ) ON CONFLICT DO NOTHING;
EXCEPTION WHEN others THEN
  RAISE NOTICE 'Could not write to audit_log: %', SQLERRM;
END $$;

COMMIT;

-- ============================================================
-- Migration complete
-- ============================================================
