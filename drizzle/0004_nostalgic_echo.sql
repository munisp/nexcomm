DO $$ BEGIN
  CREATE TYPE "public"."collateral_ledger_action" AS ENUM('PLEDGE', 'RELEASE', 'LIQUIDATE', 'REVALUE');--> statement-breakpoint
CREATE TYPE "public"."collateral_status" AS ENUM('ACTIVE', 'RELEASED', 'LIQUIDATED');--> statement-breakpoint
CREATE TYPE "public"."collateral_type" AS ENUM('WAREHOUSE_RECEIPT', 'CASH', 'BOND', 'EQUITY');--> statement-breakpoint
CREATE TYPE "public"."dispute_resolution" AS ENUM('SETTLED', 'FAILED', 'WITHDRAWN');--> statement-breakpoint
CREATE TYPE "public"."dispute_status" AS ENUM('OPEN', 'UNDER_REVIEW', 'RESOLVED_SETTLED', 'RESOLVED_FAILED', 'WITHDRAWN');--> statement-breakpoint
CREATE TYPE "public"."margin_account_status" AS ENUM('ACTIVE', 'SUSPENDED', 'CLOSED');--> statement-breakpoint
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
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
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
--> statement-breakpoint
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
--> statement-breakpoint
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
--> statement-breakpoint
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
