CREATE TYPE "public"."fee_type" AS ENUM('MAKER', 'TAKER', 'SETTLEMENT', 'WITHDRAWAL', 'DEPOSIT', 'LISTING');--> statement-breakpoint
CREATE TYPE "public"."operator_status" AS ENUM('PENDING', 'ACTIVE', 'SUSPENDED', 'TERMINATED');--> statement-breakpoint
CREATE TYPE "public"."operator_tier" AS ENUM('BASIC', 'STANDARD', 'PREMIUM', 'ENTERPRISE');--> statement-breakpoint
CREATE TYPE "public"."settlement_model" AS ENUM('DVP', 'FOP', 'CASH_ONLY', 'BILATERAL');--> statement-breakpoint
CREATE TABLE "exchange_operators" (
	"id" serial PRIMARY KEY NOT NULL,
	"operator_code" varchar(20) NOT NULL,
	"legal_name" varchar(255) NOT NULL,
	"trading_name" varchar(255),
	"registration_number" varchar(100),
	"regulatory_license_no" varchar(100),
	"status" "operator_status" DEFAULT 'PENDING' NOT NULL,
	"tier" "operator_tier" DEFAULT 'BASIC' NOT NULL,
	"admin_user_id" integer,
	"contact_email" varchar(255) NOT NULL,
	"contact_phone" varchar(50),
	"country" varchar(3) DEFAULT 'NGA' NOT NULL,
	"logo_url" text,
	"website_url" text,
	"onboarding_step" integer DEFAULT 1 NOT NULL,
	"onboarding_completed_at" timestamp,
	"activated_at" timestamp,
	"suspended_at" timestamp,
	"suspension_reason" text,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "exchange_operators_operator_code_unique" UNIQUE("operator_code")
);
--> statement-breakpoint
CREATE TABLE "operator_fees" (
	"id" serial PRIMARY KEY NOT NULL,
	"operator_id" integer NOT NULL,
	"fee_type" "fee_type" NOT NULL,
	"instrument_id" integer,
	"rate_bps" integer NOT NULL,
	"min_fee_ngn" numeric(18, 2) DEFAULT '0',
	"max_fee_ngn" numeric(18, 2),
	"is_active" boolean DEFAULT true NOT NULL,
	"effective_from" timestamp DEFAULT now() NOT NULL,
	"effective_to" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "operator_instruments" (
	"id" serial PRIMARY KEY NOT NULL,
	"operator_id" integer NOT NULL,
	"instrument_id" integer NOT NULL,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"min_order_size" numeric(18, 6),
	"max_order_size" numeric(18, 6),
	"max_daily_volume" numeric(24, 6),
	"price_band_pct" numeric(5, 2),
	"tick_size" numeric(18, 8),
	"lot_size" numeric(18, 6),
	"listing_date" timestamp,
	"delisting_date" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "operator_settlement_rules" (
	"id" serial PRIMARY KEY NOT NULL,
	"operator_id" integer NOT NULL,
	"settlement_model" "settlement_model" DEFAULT 'DVP' NOT NULL,
	"settlement_cycle_days" integer DEFAULT 2 NOT NULL,
	"cutoff_time_utc" varchar(8) DEFAULT '14:00:00' NOT NULL,
	"auto_net_enabled" boolean DEFAULT true NOT NULL,
	"failed_trade_policy" varchar(50) DEFAULT 'RETRY_ONCE' NOT NULL,
	"margin_required_pct" numeric(5, 2) DEFAULT '10',
	"custodian_bank_code" varchar(20),
	"clearing_house_code" varchar(20),
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trace_snapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"trace_id" varchar(64) NOT NULL,
	"span_id" varchar(32) NOT NULL,
	"parent_span_id" varchar(32),
	"operation_name" varchar(255) NOT NULL,
	"service_name" varchar(100) NOT NULL,
	"start_time_ms" bigint NOT NULL,
	"duration_ms" integer NOT NULL,
	"status_code" varchar(20) DEFAULT 'OK' NOT NULL,
	"error_message" text,
	"attributes" jsonb,
	"events" jsonb,
	"captured_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "exchange_operators" ADD CONSTRAINT "exchange_operators_admin_user_id_users_id_fk" FOREIGN KEY ("admin_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operator_fees" ADD CONSTRAINT "operator_fees_operator_id_exchange_operators_id_fk" FOREIGN KEY ("operator_id") REFERENCES "public"."exchange_operators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operator_fees" ADD CONSTRAINT "operator_fees_instrument_id_instruments_id_fk" FOREIGN KEY ("instrument_id") REFERENCES "public"."instruments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operator_instruments" ADD CONSTRAINT "operator_instruments_operator_id_exchange_operators_id_fk" FOREIGN KEY ("operator_id") REFERENCES "public"."exchange_operators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operator_instruments" ADD CONSTRAINT "operator_instruments_instrument_id_instruments_id_fk" FOREIGN KEY ("instrument_id") REFERENCES "public"."instruments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operator_settlement_rules" ADD CONSTRAINT "operator_settlement_rules_operator_id_exchange_operators_id_fk" FOREIGN KEY ("operator_id") REFERENCES "public"."exchange_operators"("id") ON DELETE no action ON UPDATE no action;