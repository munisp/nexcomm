CREATE TYPE "public"."bulk_listing_approval_status" AS ENUM('PENDING', 'COUNTERSIGNED', 'REJECTED', 'EXPIRED');--> statement-breakpoint
CREATE TYPE "public"."kyc_risk_level" AS ENUM('LOW', 'MEDIUM', 'HIGH', 'CRITICAL', 'UNKNOWN');--> statement-breakpoint
CREATE TYPE "public"."re_kyc_stakeholder_type" AS ENUM('FARMER', 'TRADER', 'BROKER', 'WAREHOUSE_OPERATOR', 'MARKET_MAKER');--> statement-breakpoint
CREATE TABLE "bulk_listing_approvals" (
	"id" serial PRIMARY KEY NOT NULL,
	"upload_id" integer NOT NULL,
	"cooperative_user_id" integer NOT NULL,
	"counter_signer_id" integer,
	"status" "bulk_listing_approval_status" DEFAULT 'PENDING' NOT NULL,
	"member_count" integer DEFAULT 0 NOT NULL,
	"crop_type" text NOT NULL,
	"total_quantity_kg" integer DEFAULT 0 NOT NULL,
	"price_per_kg" integer DEFAULT 0 NOT NULL,
	"harvest_date" timestamp,
	"description" text,
	"initiator_notes" text,
	"counter_signer_notes" text,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kyc_analysis_results" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"stakeholder_type" text NOT NULL,
	"document_url" text NOT NULL,
	"selfie_url" text,
	"is_pdf" boolean DEFAULT false,
	"ocr_extracted_fields" text,
	"ocr_avg_confidence" real,
	"ocr_line_count" integer,
	"document_authenticity_score" real,
	"document_type" text,
	"document_risk_flags" text,
	"selfie_overall_score" real,
	"selfie_liveness_assessment" text,
	"passive_liveness_score" real,
	"passive_liveness_flags" text,
	"overall_score" real,
	"overall_risk_level" "kyc_risk_level" DEFAULT 'UNKNOWN',
	"all_risk_flags" text,
	"recommendation" text,
	"analysed_at" timestamp DEFAULT now() NOT NULL,
	"service_version" text DEFAULT '1.0.0'
);
--> statement-breakpoint
CREATE TABLE "re_kyc_flags" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"stakeholder_type" "re_kyc_stakeholder_type" NOT NULL,
	"profile_id" integer NOT NULL,
	"reason" text NOT NULL,
	"kyc_approved_at" timestamp,
	"notified_at" timestamp,
	"resolved_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
