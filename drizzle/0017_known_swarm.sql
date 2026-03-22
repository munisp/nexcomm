CREATE TYPE "public"."crop_status_v2" AS ENUM('ACTIVE', 'SOLD', 'EXPIRED', 'WITHDRAWN');--> statement-breakpoint
CREATE TYPE "public"."farmer_kyc_status" AS ENUM('PENDING', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED');--> statement-breakpoint
CREATE TYPE "public"."soil_type" AS ENUM('LOAMY', 'CLAY', 'SANDY', 'SILT', 'PEAT', 'CHALK', 'OTHER');--> statement-breakpoint
CREATE TABLE "crop_listings" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"farm_id" integer NOT NULL,
	"crop_type" varchar(100) NOT NULL,
	"variety" varchar(100),
	"quantity_kg" numeric(14, 2) NOT NULL,
	"asking_price_per_kg" numeric(14, 4) NOT NULL,
	"currency" varchar(10) DEFAULT 'NGN' NOT NULL,
	"expected_harvest_date" timestamp NOT NULL,
	"description" text,
	"status" "crop_status_v2" DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "farm_profiles" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"farm_name" varchar(200) NOT NULL,
	"size_hectares" numeric(10, 2) NOT NULL,
	"latitude" numeric(10, 7),
	"longitude" numeric(10, 7),
	"state" varchar(100) NOT NULL,
	"lga" varchar(100) NOT NULL,
	"soil_type" "soil_type" DEFAULT 'LOAMY' NOT NULL,
	"description" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "farmer_profiles" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"full_name" varchar(200) NOT NULL,
	"phone" varchar(20) NOT NULL,
	"nin" varchar(30),
	"bvn" varchar(30),
	"state" varchar(100) NOT NULL,
	"lga" varchar(100) NOT NULL,
	"kyc_status" "farmer_kyc_status" DEFAULT 'PENDING' NOT NULL,
	"kyc_documents" text,
	"kyc_reviewed_at" timestamp,
	"kyc_reviewed_by" integer,
	"kyc_notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "farmer_profiles_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "portfolio_equity_snapshots" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"snapshot_date" timestamp NOT NULL,
	"spot_pnl" numeric(20, 8) DEFAULT '0' NOT NULL,
	"futures_pnl" numeric(20, 8) DEFAULT '0' NOT NULL,
	"options_pnl" numeric(20, 8) DEFAULT '0' NOT NULL,
	"cash_balance" numeric(20, 8) DEFAULT '0' NOT NULL,
	"total_equity" numeric(20, 8) DEFAULT '0' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
