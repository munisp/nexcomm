CREATE TYPE "public"."security_event_severity" AS ENUM('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');--> statement-breakpoint
CREATE TYPE "public"."security_event_status" AS ENUM('OPEN', 'INVESTIGATING', 'RESOLVED', 'FALSE_POSITIVE');--> statement-breakpoint
CREATE TYPE "public"."security_event_type" AS ENUM('RATE_LIMIT_BREACH', 'ANOMALOUS_ORDER', 'LARGE_WITHDRAWAL', 'REPEATED_AUTH_FAILURE', 'ADMIN_BULK_ACTION', 'SUSPICIOUS_IP', 'UNUSUAL_TRADE_PATTERN', 'ACCOUNT_TAKEOVER_ATTEMPT');--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'LIQUIDATED';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'SECURITY_ALERT';--> statement-breakpoint
CREATE TABLE "rate_limit_counters" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"action" varchar(64) NOT NULL,
	"window_start" timestamp NOT NULL,
	"count" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "security_events" (
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
--> statement-breakpoint
ALTER TABLE "settlement_disputes" ADD COLUMN "sla_deadline" timestamp;--> statement-breakpoint
ALTER TABLE "settlement_disputes" ADD COLUMN "sla_breached" boolean DEFAULT false NOT NULL;