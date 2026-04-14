CREATE TYPE "public"."credit_score_model" AS ENUM('NEXCOM_AGRI_V1', 'BUREAU_CREDITCHEK', 'BUREAU_FIRSTCENTRAL', 'MANUAL');--> statement-breakpoint
CREATE TYPE "public"."insurance_coverage_type" AS ENUM('YIELD_PROTECTION', 'REVENUE_PROTECTION', 'MULTI_PERIL', 'DROUGHT', 'FLOOD', 'PEST_DISEASE', 'FIRE', 'COMPREHENSIVE');--> statement-breakpoint
CREATE TYPE "public"."insurance_policy_status" AS ENUM('DRAFT', 'ACTIVE', 'EXPIRED', 'CANCELLED', 'CLAIMED', 'SETTLED');--> statement-breakpoint
CREATE TYPE "public"."loan_event_type" AS ENUM('APPLIED', 'CREDIT_CHECKED', 'APPROVED', 'REJECTED', 'DISBURSED', 'REPAYMENT_RECEIVED', 'OVERDUE_NOTICE', 'DEFAULT_NOTICE', 'WRITTEN_OFF', 'RESTRUCTURED', 'CLOSED');--> statement-breakpoint
CREATE TYPE "public"."repayment_status" AS ENUM('SCHEDULED', 'DUE', 'PAID', 'OVERDUE', 'WAIVED', 'WRITTEN_OFF');--> statement-breakpoint
CREATE TABLE "collateral_registry" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"loan_id" bigint,
	"owner_id" integer NOT NULL,
	"type" "collateral_type" NOT NULL,
	"status" "collateral_status" DEFAULT 'REGISTERED' NOT NULL,
	"description" text NOT NULL,
	"valuation_ngn" numeric(18, 2) NOT NULL,
	"ltv_pct" numeric(6, 3) DEFAULT '70',
	"registry_ref" varchar(100) NOT NULL,
	"ewr_id" integer,
	"land_title_ref" varchar(100),
	"document_urls" jsonb DEFAULT '[]',
	"valuation_date" timestamp,
	"expires_at" timestamp,
	"pledged_at" timestamp,
	"released_at" timestamp,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "collateral_registry_registry_ref_unique" UNIQUE("registry_ref")
);
--> statement-breakpoint
CREATE TABLE "credit_scores" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"farmer_id" integer,
	"model" "credit_score_model" DEFAULT 'NEXCOM_AGRI_V1' NOT NULL,
	"score" integer NOT NULL,
	"band" varchar(20) NOT NULL,
	"max_loan_ngn" numeric(18, 2),
	"interest_rate_pct" numeric(6, 3),
	"factors" jsonb,
	"bureau_ref" varchar(100),
	"valid_until" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crop_insurance_policies" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"farmer_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"policy_ref" varchar(50) NOT NULL,
	"coverage_type" "insurance_coverage_type" NOT NULL,
	"status" "insurance_policy_status" DEFAULT 'DRAFT' NOT NULL,
	"crop_type" varchar(100) NOT NULL,
	"farm_id" integer,
	"covered_area_hectares" numeric(10, 4) NOT NULL,
	"sum_insured_ngn" numeric(18, 2) NOT NULL,
	"premium_ngn" numeric(18, 2) NOT NULL,
	"premium_paid_ngn" numeric(18, 2) DEFAULT '0',
	"deductible_pct" numeric(6, 3) DEFAULT '10',
	"season" varchar(50),
	"start_date" timestamp,
	"end_date" timestamp,
	"provider_name" varchar(100) DEFAULT 'NEXCOM Agri Insurance',
	"provider_policy_ref" varchar(100),
	"claim_amount_ngn" numeric(18, 2),
	"claim_settled_ngn" numeric(18, 2),
	"claimed_at" timestamp,
	"settled_at" timestamp,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "crop_insurance_policies_policy_ref_unique" UNIQUE("policy_ref")
);
--> statement-breakpoint
CREATE TABLE "loan_lifecycle_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"loan_id" bigint NOT NULL,
	"event_type" "loan_event_type" NOT NULL,
	"performed_by" integer,
	"notes" text,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "loan_repayment_schedules" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"loan_id" bigint NOT NULL,
	"installment_no" integer NOT NULL,
	"due_date" timestamp NOT NULL,
	"principal_ngn" numeric(18, 2) NOT NULL,
	"interest_ngn" numeric(18, 2) NOT NULL,
	"total_ngn" numeric(18, 2) NOT NULL,
	"paid_ngn" numeric(18, 2) DEFAULT '0',
	"status" "repayment_status" DEFAULT 'SCHEDULED' NOT NULL,
	"paid_at" timestamp,
	"payment_ref" varchar(100),
	"penalty_ngn" numeric(18, 2) DEFAULT '0',
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
