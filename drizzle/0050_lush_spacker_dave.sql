CREATE TYPE "public"."instrument_asset_class" AS ENUM('COMMODITY', 'FOREX', 'EQUITY', 'DIGITAL_ASSET', 'INDEX', 'FIXED_INCOME', 'DERIVATIVE');--> statement-breakpoint
CREATE TYPE "public"."instrument_status" AS ENUM('ACTIVE', 'SUSPENDED', 'DELISTED', 'PENDING');--> statement-breakpoint
CREATE TYPE "public"."warehouse_accreditation_status" AS ENUM('PENDING', 'ACCREDITED', 'SUSPENDED', 'REVOKED');--> statement-breakpoint
CREATE TABLE "instruments" (
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
--> statement-breakpoint
CREATE TABLE "warehouses" (
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
--> statement-breakpoint
ALTER TABLE "audit_log" ALTER COLUMN "details" SET DATA TYPE jsonb;--> statement-breakpoint
ALTER TABLE "cooperative_bulk_uploads" ALTER COLUMN "errors" SET DATA TYPE jsonb;--> statement-breakpoint
ALTER TABLE "cooperative_bulk_uploads" ALTER COLUMN "created_application_ids" SET DATA TYPE jsonb;--> statement-breakpoint
ALTER TABLE "kyc_analysis_results" ALTER COLUMN "ocr_avg_confidence" SET DATA TYPE numeric(8, 4);--> statement-breakpoint
ALTER TABLE "kyc_analysis_results" ALTER COLUMN "document_authenticity_score" SET DATA TYPE numeric(8, 4);--> statement-breakpoint
ALTER TABLE "kyc_analysis_results" ALTER COLUMN "selfie_overall_score" SET DATA TYPE numeric(8, 4);--> statement-breakpoint
ALTER TABLE "kyc_analysis_results" ALTER COLUMN "passive_liveness_score" SET DATA TYPE numeric(8, 4);--> statement-breakpoint
ALTER TABLE "kyc_analysis_results" ALTER COLUMN "overall_score" SET DATA TYPE numeric(8, 4);--> statement-breakpoint
ALTER TABLE "kyc_queue" ALTER COLUMN "documents" SET DATA TYPE jsonb;--> statement-breakpoint
ALTER TABLE "mojaloop_parties" ALTER COLUMN "supported_currencies" SET DATA TYPE jsonb;--> statement-breakpoint
ALTER TABLE "mojaloop_parties" ALTER COLUMN "supported_currencies" SET DEFAULT '[]'::jsonb;--> statement-breakpoint
ALTER TABLE "notifications" ALTER COLUMN "metadata" SET DATA TYPE jsonb;--> statement-breakpoint
ALTER TABLE "profiles" ALTER COLUMN "metadata" SET DATA TYPE jsonb;--> statement-breakpoint
ALTER TABLE "security_events" ALTER COLUMN "metadata" SET DATA TYPE jsonb;--> statement-breakpoint
ALTER TABLE "stripe_payments" ALTER COLUMN "metadata" SET DATA TYPE jsonb;