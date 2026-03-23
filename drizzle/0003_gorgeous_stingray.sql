DO $$ BEGIN
  CREATE TYPE "public"."auto_liquidation_status" AS ENUM('PENDING', 'EXECUTING', 'COMPLETED', 'FAILED', 'CANCELLED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE TYPE "public"."broker_account_status" AS ENUM('INACTIVE', 'ACTIVE', 'SUSPENDED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE TYPE "public"."broker_client_status" AS ENUM('ACTIVE', 'INACTIVE', 'SUSPENDED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE TYPE "public"."broker_commission_status" AS ENUM('PENDING', 'PAID', 'CANCELLED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE TYPE "public"."broker_kyc_status" AS ENUM('PENDING', 'UNDER_REVIEW', 'APPROVED', 'REJECTED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE TYPE "public"."bulk_listing_approval_status" AS ENUM('PENDING', 'COUNTERSIGNED', 'REJECTED', 'EXPIRED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE TYPE "public"."clearing_account_status" AS ENUM('ACTIVE', 'SUSPENDED', 'CLOSED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE TYPE "public"."collateral_ledger_action" AS ENUM('PLEDGE', 'RELEASE', 'LIQUIDATE', 'REVALUE');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE TYPE "public"."collateral_status" AS ENUM('ACTIVE', 'RELEASED', 'LIQUIDATED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE TYPE "public"."collateral_type" AS ENUM('WAREHOUSE_RECEIPT', 'CASH', 'BOND', 'EQUITY');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE TYPE "public"."corporate_action_status" AS ENUM('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'CANCELLED', 'COMPLETED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE TYPE "public"."corporate_action_type" AS ENUM('DIVIDEND', 'STOCK_SPLIT', 'RIGHTS_ISSUE', 'BONUS_ISSUE', 'MERGER', 'DELISTING', 'IPO');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE TYPE "public"."crop_status_v2" AS ENUM('ACTIVE', 'SOLD', 'EXPIRED', 'WITHDRAWN');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE TYPE "public"."delivery_status" AS ENUM('PENDING', 'SCHEDULED', 'IN_TRANSIT', 'DELIVERED', 'CANCELLED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE TYPE "public"."deposit_status" AS ENUM('PENDING', 'RECEIVED', 'GRADED', 'STORED', 'REJECTED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE TYPE "public"."dfsp_kyc_status" AS ENUM('PENDING', 'APPROVED', 'REJECTED', 'EDD_REQUIRED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE TYPE "public"."dfsp_tier" AS ENUM('STANDARD', 'PREMIUM', 'INSTITUTIONAL', 'CORRESPONDENT');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE TYPE "public"."dispute_resolution" AS ENUM('SETTLED', 'FAILED', 'WITHDRAWN');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE TYPE "public"."dispute_status" AS ENUM('OPEN', 'UNDER_REVIEW', 'RESOLVED_SETTLED', 'RESOLVED_FAILED', 'WITHDRAWN');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE TYPE "public"."farmer_kyc_status" AS ENUM('PENDING', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE TYPE "public"."ip_allowlist_scope" AS ENUM('GLOBAL_ADMIN', 'BULK_OPERATIONS', 'LIQUIDATION_OVERRIDE', 'WITHDRAWAL_APPROVAL');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE TYPE "public"."ir_document_type" AS ENUM('ANNUAL_REPORT', 'INTERIM_REPORT', 'QUARTERLY_REPORT', 'PROSPECTUS', 'CIRCULAR', 'PRESS_RELEASE', 'PRESENTATION', 'FINANCIAL_STATEMENT', 'REGULATORY_FILING', 'OTHER');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE TYPE "public"."ir_event_type" AS ENUM('EARNINGS_RELEASE', 'DIVIDEND_ANNOUNCEMENT', 'AGM', 'EGM', 'RIGHTS_ISSUE', 'BONUS_ISSUE', 'STOCK_SPLIT', 'MERGER_ACQUISITION', 'REGULATORY_FILING', 'INVESTOR_PRESENTATION', 'ROADSHOW', 'OTHER');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE TYPE "public"."kyc_audit_decision" AS ENUM('APPROVED', 'REJECTED', 'RESET', 'UNDER_REVIEW');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE TYPE "public"."kyc_audit_stakeholder" AS ENUM('FARMER', 'TRADER', 'BROKER', 'WAREHOUSE_OPERATOR', 'MARKET_MAKER');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE TYPE "public"."kyc_risk_level" AS ENUM('LOW', 'MEDIUM', 'HIGH', 'CRITICAL', 'UNKNOWN');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE TYPE "public"."margin_account_status" AS ENUM('ACTIVE', 'SUSPENDED', 'CLOSED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE TYPE "public"."margin_call_event_type" AS ENUM('ISSUED', 'DEPOSIT_RECEIVED', 'PARTIALLY_MET', 'MET', 'DEFAULTED', 'CANCELLED', 'GRACE_EXTENDED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE TYPE "public"."margin_call_status" AS ENUM('OPEN', 'PARTIALLY_MET', 'MET', 'DEFAULTED', 'CANCELLED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE TYPE "public"."mfa_method" AS ENUM('totp', 'webauthn', 'sms', 'email_otp');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE TYPE "public"."mm_onboarding_account_status" AS ENUM('INACTIVE', 'ACTIVE', 'SUSPENDED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE TYPE "public"."mm_onboarding_kyc_status" AS ENUM('PENDING', 'UNDER_REVIEW', 'APPROVED', 'REJECTED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE TYPE "public"."mojaloop_quote_status" AS ENUM('PENDING', 'ACCEPTED', 'REJECTED', 'EXPIRED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE TYPE "public"."mojaloop_transfer_status" AS ENUM('PENDING', 'RESERVED', 'COMMITTED', 'ABORTED', 'EXPIRED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE TYPE "public"."option_position_status" AS ENUM('OPEN', 'EXERCISED', 'EXPIRED', 'CLOSED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE TYPE "public"."option_status" AS ENUM('ACTIVE', 'EXPIRED', 'SETTLED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE TYPE "public"."option_type" AS ENUM('CALL', 'PUT');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE TYPE "public"."re_kyc_stakeholder_type" AS ENUM('FARMER', 'TRADER', 'BROKER', 'WAREHOUSE_OPERATOR', 'MARKET_MAKER');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE TYPE "public"."security_event_severity" AS ENUM('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE TYPE "public"."security_event_status" AS ENUM('OPEN', 'INVESTIGATING', 'RESOLVED', 'FALSE_POSITIVE');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE TYPE "public"."security_event_type" AS ENUM('RATE_LIMIT_BREACH', 'ANOMALOUS_ORDER', 'LARGE_WITHDRAWAL', 'REPEATED_AUTH_FAILURE', 'ADMIN_BULK_ACTION', 'SUSPICIOUS_IP', 'UNUSUAL_TRADE_PATTERN', 'ACCOUNT_TAKEOVER_ATTEMPT');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE TYPE "public"."settlement_status" AS ENUM('PENDING', 'MATCHED', 'SETTLED', 'FAILED', 'DISPUTED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE TYPE "public"."soil_type" AS ENUM('LOAMY', 'CLAY', 'SANDY', 'SILT', 'PEAT', 'CHALK', 'OTHER');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE TYPE "public"."stakeholder_type" AS ENUM('FARMER', 'TRADER', 'BROKER', 'WAREHOUSE_OPERATOR', 'MARKET_MAKER', 'ADMIN');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE TYPE "public"."trader_account_status" AS ENUM('INACTIVE', 'ACTIVE', 'SUSPENDED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE TYPE "public"."trader_experience" AS ENUM('BEGINNER', 'INTERMEDIATE', 'EXPERIENCED', 'PROFESSIONAL');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE TYPE "public"."trader_kyc_status" AS ENUM('PENDING', 'UNDER_REVIEW', 'APPROVED', 'REJECTED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE TYPE "public"."trader_risk_profile" AS ENUM('CONSERVATIVE', 'MODERATE', 'AGGRESSIVE');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE TYPE "public"."warehouse_message_status" AS ENUM('SENT', 'READ', 'REPLIED', 'CLOSED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE TYPE "public"."warehouse_op_account_status" AS ENUM('INACTIVE', 'ACTIVE', 'SUSPENDED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE TYPE "public"."warehouse_op_kyc_status" AS ENUM('PENDING', 'UNDER_REVIEW', 'APPROVED', 'REJECTED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE TYPE "public"."warehouse_receipt_status" AS ENUM('ACTIVE', 'PLEDGED', 'REDEEMED', 'CANCELLED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE TYPE "public"."webhook_event_filter" AS ENUM('ALL', 'HIGH_AND_CRITICAL', 'CRITICAL_ONLY');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE TYPE "public"."withdrawal_verification_status" AS ENUM('PENDING', 'PASSED', 'FAILED', 'EXPIRED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "public"."bulk_kyc_status" AS ENUM('PROCESSING', 'COMPLETED', 'FAILED', 'PARTIAL');--> statement-breakpoint
ALTER TYPE "public"."account_type" ADD VALUE 'WAREHOUSE_OPERATOR';--> statement-breakpoint
ALTER TYPE "public"."account_type" ADD VALUE 'MARKET_MAKER';--> statement-breakpoint
ALTER TYPE "public"."alert_condition" ADD VALUE 'CROSS_ABOVE';--> statement-breakpoint
ALTER TYPE "public"."alert_condition" ADD VALUE 'CROSS_BELOW';--> statement-breakpoint
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
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
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
--> statement-breakpoint
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
--> statement-breakpoint
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
--> statement-breakpoint
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
--> statement-breakpoint
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
--> statement-breakpoint
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
--> statement-breakpoint
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
--> statement-breakpoint
ALTER TABLE "profiles" ALTER COLUMN "account_type" SET DEFAULT 'TRADER';--> statement-breakpoint
ALTER TABLE "kyc_queue" ADD COLUMN "documents" json;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "first_name" varchar(64);--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "last_name" varchar(64);--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "address" text;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "company_name" varchar(256);--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "rc_number" varchar(64);--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "tax_id" varchar(64);--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "stakeholder_type" "stakeholder_type";--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "metadata" json;--> statement-breakpoint
ALTER TABLE "kyc_queue" DROP COLUMN "profile_id";--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_user_id_unique" UNIQUE("user_id");