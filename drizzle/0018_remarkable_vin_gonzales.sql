DO $$ BEGIN
  CREATE TYPE "public"."broker_account_status" AS ENUM('INACTIVE', 'ACTIVE', 'SUSPENDED');--> statement-breakpoint
CREATE TYPE "public"."broker_kyc_status" AS ENUM('PENDING', 'UNDER_REVIEW', 'APPROVED', 'REJECTED');--> statement-breakpoint
CREATE TYPE "public"."mm_onboarding_account_status" AS ENUM('INACTIVE', 'ACTIVE', 'SUSPENDED');--> statement-breakpoint
CREATE TYPE "public"."mm_onboarding_kyc_status" AS ENUM('PENDING', 'UNDER_REVIEW', 'APPROVED', 'REJECTED');--> statement-breakpoint
CREATE TYPE "public"."trader_account_status" AS ENUM('INACTIVE', 'ACTIVE', 'SUSPENDED');--> statement-breakpoint
CREATE TYPE "public"."trader_experience" AS ENUM('BEGINNER', 'INTERMEDIATE', 'EXPERIENCED', 'PROFESSIONAL');--> statement-breakpoint
CREATE TYPE "public"."trader_kyc_status" AS ENUM('PENDING', 'UNDER_REVIEW', 'APPROVED', 'REJECTED');--> statement-breakpoint
CREATE TYPE "public"."trader_risk_profile" AS ENUM('CONSERVATIVE', 'MODERATE', 'AGGRESSIVE');--> statement-breakpoint
CREATE TYPE "public"."warehouse_op_account_status" AS ENUM('INACTIVE', 'ACTIVE', 'SUSPENDED');--> statement-breakpoint
CREATE TYPE "public"."warehouse_op_kyc_status" AS ENUM('PENDING', 'UNDER_REVIEW', 'APPROVED', 'REJECTED');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "broker_profiles" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"firm_name" varchar(200) NOT NULL,
	"rc_number" varchar(50),
	"sec_license_number" varchar(100),
	"cbn_license_number" varchar(100),
	"regulatory_body" varchar(100),
	"contact_phone" varchar(30),
	"contact_email" varchar(200),
	"firm_address" text,
	"state" varchar(100),
	"years_in_operation" integer,
	"client_book_size" varchar(50),
	"commission_rate" numeric(6, 4),
	"sec_certificate_url" text,
	"cbn_approval_url" text,
	"cac_doc_url" text,
	"kyc_status" "broker_kyc_status" DEFAULT 'PENDING' NOT NULL,
	"kyc_notes" text,
	"account_status" "broker_account_status" DEFAULT 'INACTIVE' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "broker_profiles_user_id_unique" UNIQUE("user_id")
);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "farmer_earnings" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"listing_id" integer,
	"crop_type" varchar(100) NOT NULL,
	"quantity_kg" numeric(14, 2) NOT NULL,
	"price_per_kg" numeric(14, 4) NOT NULL,
	"total_amount" numeric(18, 2) NOT NULL,
	"currency" varchar(10) DEFAULT 'NGN' NOT NULL,
	"buyer_name" varchar(200),
	"settled_at" timestamp DEFAULT now() NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "listing_messages" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"listing_id" integer NOT NULL,
	"sender_id" integer NOT NULL,
	"recipient_id" integer NOT NULL,
	"message" text NOT NULL,
	"is_read" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "market_maker_onboarding_profiles" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"firm_name" varchar(200) NOT NULL,
	"trading_desk" varchar(200),
	"contact_phone" varchar(30),
	"contact_email" varchar(200),
	"years_of_operation" integer,
	"regulatory_registrations" text,
	"instrument_obligations" text[],
	"min_quote_size_lots" numeric(12, 2),
	"max_spread_bps" numeric(8, 2),
	"capital_commitment_ngn" numeric(18, 2),
	"performance_bond_ngn" numeric(18, 2),
	"firm_registration_url" text,
	"trading_license_url" text,
	"capital_adequacy_url" text,
	"kyc_status" "mm_onboarding_kyc_status" DEFAULT 'PENDING' NOT NULL,
	"kyc_notes" text,
	"account_status" "mm_onboarding_account_status" DEFAULT 'INACTIVE' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "market_maker_onboarding_profiles_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "trader_profiles" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"full_name" varchar(200) NOT NULL,
	"phone" varchar(30) NOT NULL,
	"nin" varchar(50),
	"bvn" varchar(50),
	"email" varchar(200),
	"address" text,
	"state" varchar(100),
	"lga" varchar(100),
	"trading_experience" "trader_experience" DEFAULT 'BEGINNER' NOT NULL,
	"preferred_markets" text[],
	"capital_range" varchar(50),
	"risk_profile" "trader_risk_profile" DEFAULT 'MODERATE' NOT NULL,
	"id_document_url" text,
	"proof_of_address_url" text,
	"bank_statement_url" text,
	"bank_name" varchar(200),
	"account_number" varchar(30),
	"kyc_status" "trader_kyc_status" DEFAULT 'PENDING' NOT NULL,
	"kyc_notes" text,
	"account_status" "trader_account_status" DEFAULT 'INACTIVE' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "trader_profiles_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "warehouse_operator_profiles" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"facility_name" varchar(200) NOT NULL,
	"facility_address" text NOT NULL,
	"state" varchar(100) NOT NULL,
	"lga" varchar(100),
	"gps_lat" numeric(10, 7),
	"gps_lng" numeric(10, 7),
	"storage_capacity_mt" numeric(12, 2),
	"commodities_handled" text[],
	"nwr_cert_number" varchar(100),
	"nwr_cert_doc_url" text,
	"facility_inspection_url" text,
	"insurance_doc_url" text,
	"grading_staff_count" integer,
	"operating_hours" varchar(100),
	"accepted_grades" text[],
	"kyc_status" "warehouse_op_kyc_status" DEFAULT 'PENDING' NOT NULL,
	"kyc_notes" text,
	"account_status" "warehouse_op_account_status" DEFAULT 'INACTIVE' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "warehouse_operator_profiles_user_id_unique" UNIQUE("user_id")
);
