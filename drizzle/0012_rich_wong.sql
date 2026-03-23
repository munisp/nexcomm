DO $$ BEGIN
  CREATE TYPE "public"."auto_liquidation_status" AS ENUM('PENDING', 'EXECUTING', 'COMPLETED', 'FAILED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."clearing_account_status" AS ENUM('ACTIVE', 'SUSPENDED', 'CLOSED');--> statement-breakpoint
CREATE TYPE "public"."ir_document_type" AS ENUM('ANNUAL_REPORT', 'INTERIM_REPORT', 'QUARTERLY_REPORT', 'PROSPECTUS', 'CIRCULAR', 'PRESS_RELEASE', 'PRESENTATION', 'FINANCIAL_STATEMENT', 'REGULATORY_FILING', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."ir_event_type" AS ENUM('EARNINGS_RELEASE', 'DIVIDEND_ANNOUNCEMENT', 'AGM', 'EGM', 'RIGHTS_ISSUE', 'BONUS_ISSUE', 'STOCK_SPLIT', 'MERGER_ACQUISITION', 'REGULATORY_FILING', 'INVESTOR_PRESENTATION', 'ROADSHOW', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."margin_call_event_type" AS ENUM('ISSUED', 'DEPOSIT_RECEIVED', 'PARTIALLY_MET', 'MET', 'DEFAULTED', 'CANCELLED', 'GRACE_EXTENDED');--> statement-breakpoint
CREATE TYPE "public"."margin_call_status" AS ENUM('OPEN', 'PARTIALLY_MET', 'MET', 'DEFAULTED', 'CANCELLED');--> statement-breakpoint
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
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
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
--> statement-breakpoint
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
--> statement-breakpoint
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
--> statement-breakpoint
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
--> statement-breakpoint
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
--> statement-breakpoint
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
--> statement-breakpoint
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
