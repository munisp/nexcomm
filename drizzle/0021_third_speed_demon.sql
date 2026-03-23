DO $$ BEGIN
  CREATE TYPE "public"."corporate_action_status" AS ENUM('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'CANCELLED', 'COMPLETED');--> statement-breakpoint
CREATE TYPE "public"."corporate_action_type" AS ENUM('DIVIDEND', 'STOCK_SPLIT', 'RIGHTS_ISSUE', 'BONUS_ISSUE', 'MERGER', 'DELISTING', 'IPO');--> statement-breakpoint
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
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
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
--> statement-breakpoint
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
