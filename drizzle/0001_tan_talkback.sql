CREATE TYPE "public"."abcp_status" AS ENUM('STRUCTURING', 'SEC_REVIEW', 'APPROVED', 'ISSUED', 'TRADING', 'MATURED', 'DEFAULTED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."bank_financing_status" AS ENUM('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'DISBURSED', 'REPAYING', 'CLOSED', 'DEFAULTED');--> statement-breakpoint
CREATE TYPE "public"."crop_report_type" AS ENUM('PLANTING_PROGRESS', 'CROP_CONDITIONS', 'YIELD_FORECAST', 'HARVEST_PROGRESS', 'STORAGE_STOCKS', 'PRICE_OUTLOOK');--> statement-breakpoint
CREATE TYPE "public"."field_agent_status" AS ENUM('PENDING', 'ACTIVE', 'SUSPENDED', 'TERMINATED');--> statement-breakpoint
CREATE TYPE "public"."field_visit_status" AS ENUM('SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'NO_SHOW');--> statement-breakpoint
CREATE TYPE "public"."field_visit_type" AS ENUM('ONBOARDING', 'CROP_INSPECTION', 'LOAN_ASSESSMENT', 'HARVEST_VERIFICATION', 'REPAYMENT_COLLECTION', 'FOLLOW_UP');--> statement-breakpoint
CREATE TYPE "public"."fixed_income_status" AS ENUM('ACTIVE', 'MATURED', 'DEFAULTED', 'CALLED', 'SUSPENDED');--> statement-breakpoint
CREATE TYPE "public"."fixed_income_type" AS ENUM('TREASURY_BILL', 'TREASURY_BOND', 'CORPORATE_BOND', 'ABCP', 'SUKUK', 'COMMERCIAL_PAPER', 'AGRI_BOND', 'GREEN_BOND');--> statement-breakpoint
CREATE TYPE "public"."input_financing_status" AS ENUM('APPLIED', 'APPROVED', 'DISBURSED', 'IN_USE', 'REPAYING', 'REPAID', 'DEFAULTED', 'WRITTEN_OFF');--> statement-breakpoint
CREATE TYPE "public"."input_type" AS ENUM('SEEDS', 'FERTILIZER', 'PESTICIDE', 'HERBICIDE', 'EQUIPMENT', 'IRRIGATION', 'STORAGE', 'CASH');--> statement-breakpoint
CREATE TYPE "public"."workbench_crop_season" AS ENUM('WET_SEASON', 'DRY_SEASON', 'YEAR_ROUND');--> statement-breakpoint
CREATE TYPE "public"."workbench_farm_status" AS ENUM('ACTIVE', 'FALLOW', 'HARVESTED', 'ABANDONED');--> statement-breakpoint
CREATE TABLE "abcp_programs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"program_name" varchar(300) NOT NULL,
	"isin" varchar(20),
	"sponsor_name" varchar(200) NOT NULL,
	"sponsor_user_id" integer,
	"arranger_name" varchar(200),
	"program_size_ngn" numeric(22, 2) NOT NULL,
	"outstanding_ngn" numeric(22, 2) DEFAULT '0',
	"collateral_type" varchar(100) NOT NULL,
	"collateral_value_ngn" numeric(22, 2),
	"coverage_ratio_pct" numeric(6, 2),
	"yield_pct" numeric(8, 4),
	"tenor_days" integer NOT NULL,
	"issue_date" timestamp,
	"maturity_date" timestamp,
	"credit_rating" varchar(10),
	"rating_agency" varchar(50),
	"status" "abcp_status" DEFAULT 'STRUCTURING' NOT NULL,
	"sec_approval_ref" varchar(100),
	"prospectus_url" text,
	"underlying_ewr_ids" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "abcp_programs_isin_unique" UNIQUE("isin")
);
--> statement-breakpoint
CREATE TABLE "bank_financing_applications" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"bank_name" varchar(200) NOT NULL,
	"bank_code" varchar(20),
	"loan_purpose" varchar(100) NOT NULL,
	"requested_amount_ngn" numeric(18, 2) NOT NULL,
	"approved_amount_ngn" numeric(18, 2),
	"interest_rate_pct" numeric(6, 3),
	"tenor_months" integer,
	"collateral_ewr_id" integer,
	"collateral_value_ngn" numeric(18, 2),
	"status" "bank_financing_status" DEFAULT 'DRAFT' NOT NULL,
	"rejection_reason" text,
	"disbursed_at" timestamp,
	"repayment_due_date" timestamp,
	"external_reference_id" varchar(100),
	"documents" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "commodity_index_history" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"index_id" integer NOT NULL,
	"value" numeric(10, 4) NOT NULL,
	"change_percent" numeric(8, 4),
	"volume" numeric(22, 2),
	"recorded_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "commodity_indexes" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"ticker" varchar(20) NOT NULL,
	"name" varchar(200) NOT NULL,
	"description" text,
	"base_value" numeric(10, 4) DEFAULT '1000',
	"current_value" numeric(10, 4),
	"change_percent" numeric(8, 4),
	"components" jsonb,
	"calculation_method" varchar(50) DEFAULT 'PRICE_WEIGHTED',
	"rebalance_frequency" varchar(20) DEFAULT 'MONTHLY',
	"last_calculated_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "commodity_indexes_ticker_unique" UNIQUE("ticker")
);
--> statement-breakpoint
CREATE TABLE "crop_production_reports" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"report_type" "crop_report_type" NOT NULL,
	"crop_symbol" varchar(20) NOT NULL,
	"crop_name" varchar(100) NOT NULL,
	"reporting_period" varchar(50) NOT NULL,
	"coverage_region" varchar(100) DEFAULT 'NIGERIA',
	"production_mt" numeric(14, 2),
	"yield_mt_per_ha" numeric(8, 4),
	"area_harvested_ha" numeric(14, 2),
	"stocks_mt" numeric(14, 2),
	"exports_mt" numeric(14, 2),
	"imports_mt" numeric(14, 2),
	"price_ngn_per_mt" numeric(12, 2),
	"price_change_percent" numeric(8, 4),
	"outlook_summary" text,
	"spatial_data_url" text,
	"published_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "field_agents" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"agent_code" varchar(20) NOT NULL,
	"full_name" varchar(200) NOT NULL,
	"phone" varchar(20) NOT NULL,
	"state_of_operation" varchar(100),
	"lga_of_operation" varchar(100),
	"total_farmers_onboarded" integer DEFAULT 0,
	"total_loans_originated" integer DEFAULT 0,
	"total_loans_value_ngn" numeric(22, 2) DEFAULT '0',
	"commission_earned_ngn" numeric(18, 2) DEFAULT '0',
	"status" "field_agent_status" DEFAULT 'PENDING' NOT NULL,
	"supervisor_id" integer,
	"profile_photo_url" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "field_agents_user_id_unique" UNIQUE("user_id"),
	CONSTRAINT "field_agents_agent_code_unique" UNIQUE("agent_code")
);
--> statement-breakpoint
CREATE TABLE "field_visits" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"agent_id" integer NOT NULL,
	"farmer_id" integer NOT NULL,
	"farm_id" integer,
	"visit_type" "field_visit_type" NOT NULL,
	"status" "field_visit_status" DEFAULT 'SCHEDULED' NOT NULL,
	"scheduled_at" timestamp NOT NULL,
	"started_at" timestamp,
	"completed_at" timestamp,
	"gps_latitude" numeric(10, 7),
	"gps_longitude" numeric(10, 7),
	"observations" text,
	"photo_urls" jsonb,
	"crop_condition" varchar(20),
	"estimated_yield_mt" numeric(10, 3),
	"loan_recommendation_ngn" numeric(18, 2),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fixed_income_instruments" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"isin" varchar(20),
	"ticker" varchar(20) NOT NULL,
	"name" varchar(300) NOT NULL,
	"issuer_name" varchar(200) NOT NULL,
	"type" "fixed_income_type" NOT NULL,
	"status" "fixed_income_status" DEFAULT 'ACTIVE' NOT NULL,
	"face_value_ngn" numeric(18, 2) NOT NULL,
	"coupon_rate_pct" numeric(8, 4),
	"yield_pct" numeric(8, 4),
	"maturity_date" timestamp NOT NULL,
	"issue_date" timestamp NOT NULL,
	"total_issuance_ngn" numeric(22, 2),
	"outstanding_ngn" numeric(22, 2),
	"credit_rating" varchar(10),
	"rating_agency" varchar(50),
	"collateral_description" text,
	"prospectus_url" text,
	"last_price_ngn" numeric(18, 4),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "fixed_income_instruments_isin_unique" UNIQUE("isin")
);
--> statement-breakpoint
CREATE TABLE "fixed_income_trades" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"instrument_id" integer NOT NULL,
	"buyer_user_id" integer NOT NULL,
	"seller_user_id" integer,
	"face_value_ngn" numeric(18, 2) NOT NULL,
	"price_ngn" numeric(18, 4) NOT NULL,
	"yield_pct" numeric(8, 4),
	"settlement_date" timestamp,
	"trade_date" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "input_financing_loans" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"farmer_id" integer NOT NULL,
	"agent_id" integer,
	"crop_plan_id" integer,
	"input_type" "input_type" NOT NULL,
	"input_description" text NOT NULL,
	"requested_value_ngn" numeric(18, 2) NOT NULL,
	"approved_value_ngn" numeric(18, 2),
	"disbursed_value_ngn" numeric(18, 2),
	"repaid_value_ngn" numeric(18, 2) DEFAULT '0',
	"interest_rate_pct" numeric(6, 3) DEFAULT '8.5',
	"tenor_months" integer DEFAULT 6,
	"status" "input_financing_status" DEFAULT 'APPLIED' NOT NULL,
	"collateral_ewr_id" integer,
	"repayment_method" varchar(50) DEFAULT 'HARVEST_DEDUCTION',
	"disbursed_at" timestamp,
	"repayment_due_date" timestamp,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "input_financing_repayments" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"loan_id" integer NOT NULL,
	"amount_ngn" numeric(18, 2) NOT NULL,
	"method" varchar(50) NOT NULL,
	"reference" varchar(100),
	"paid_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workbench_crop_plans" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"farm_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"crop_symbol" varchar(20) NOT NULL,
	"crop_name" varchar(100) NOT NULL,
	"season" "workbench_crop_season" NOT NULL,
	"planting_date" timestamp,
	"expected_harvest_date" timestamp,
	"actual_harvest_date" timestamp,
	"planned_hectares" numeric(10, 2),
	"actual_hectares" numeric(10, 2),
	"expected_yield_mt" numeric(10, 3),
	"actual_yield_mt" numeric(10, 3),
	"input_cost_ngn" numeric(18, 2),
	"revenue_ngn" numeric(18, 2),
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workbench_farms" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"farm_name" varchar(200) NOT NULL,
	"location_state" varchar(100),
	"location_lga" varchar(100),
	"location_address" text,
	"coordinates" geometry(Point,4326),
	"total_hectares" numeric(10, 2),
	"soil_type" varchar(50),
	"irrigation_type" varchar(50),
	"status" "workbench_farm_status" DEFAULT 'ACTIVE' NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workbench_soil_tests" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"farm_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"test_date" timestamp DEFAULT now() NOT NULL,
	"ph_level" numeric(4, 2),
	"nitrogen_ppm" numeric(8, 2),
	"phosphorus_ppm" numeric(8, 2),
	"potassium_ppm" numeric(8, 2),
	"organic_matter_pct" numeric(5, 2),
	"recommendations" text,
	"lab_name" varchar(200),
	"report_url" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
