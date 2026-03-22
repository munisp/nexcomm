CREATE TYPE "public"."bulk_kyc_status" AS ENUM('PROCESSING', 'COMPLETED', 'FAILED', 'PARTIAL');--> statement-breakpoint
ALTER TYPE "public"."account_type" ADD VALUE 'WAREHOUSE_OPERATOR';--> statement-breakpoint
ALTER TYPE "public"."account_type" ADD VALUE 'MARKET_MAKER';--> statement-breakpoint
ALTER TYPE "public"."alert_condition" ADD VALUE 'CROSS_ABOVE';--> statement-breakpoint
ALTER TYPE "public"."alert_condition" ADD VALUE 'CROSS_BELOW';--> statement-breakpoint
CREATE TABLE "api_keys" (
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
--> statement-breakpoint
CREATE TABLE "cooperative_bulk_uploads" (
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
CREATE TABLE "delivery_orders" (
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
CREATE TABLE "deposit_requests" (
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
CREATE TABLE "portfolio_snapshots" (
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
CREATE TABLE "settlements" (
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
CREATE TABLE "user_preferences" (
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
CREATE TABLE "warehouse_receipts" (
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