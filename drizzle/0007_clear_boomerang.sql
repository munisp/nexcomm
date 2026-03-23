DO $$ BEGIN
  CREATE TYPE "public"."ip_allowlist_scope" AS ENUM('GLOBAL_ADMIN', 'BULK_OPERATIONS', 'LIQUIDATION_OVERRIDE', 'WITHDRAWAL_APPROVAL');--> statement-breakpoint
CREATE TYPE "public"."webhook_event_filter" AS ENUM('ALL', 'HIGH_AND_CRITICAL', 'CRITICAL_ONLY');--> statement-breakpoint
CREATE TYPE "public"."withdrawal_verification_status" AS ENUM('PENDING', 'PASSED', 'FAILED', 'EXPIRED');--> statement-breakpoint
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
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "platform_settings" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"key" varchar(128) NOT NULL,
	"value" text NOT NULL,
	"description" text,
	"updated_by" integer,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "platform_settings_key_unique" UNIQUE("key")
);
--> statement-breakpoint
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
--> statement-breakpoint
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
