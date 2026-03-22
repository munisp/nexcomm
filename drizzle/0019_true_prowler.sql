CREATE TYPE "public"."kyc_audit_decision" AS ENUM('APPROVED', 'REJECTED', 'RESET', 'UNDER_REVIEW');--> statement-breakpoint
CREATE TYPE "public"."kyc_audit_stakeholder" AS ENUM('FARMER', 'TRADER', 'BROKER', 'WAREHOUSE_OPERATOR', 'MARKET_MAKER');--> statement-breakpoint
CREATE TABLE "kyc_audit_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"stakeholder_type" "kyc_audit_stakeholder" NOT NULL,
	"profile_id" integer NOT NULL,
	"reviewer_id" integer NOT NULL,
	"reviewer_name" text,
	"decision" "kyc_audit_decision" NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
