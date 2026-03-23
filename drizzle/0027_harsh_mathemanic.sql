DO $$ BEGIN
  CREATE TYPE "public"."dfsp_kyc_status" AS ENUM('PENDING', 'APPROVED', 'REJECTED', 'EDD_REQUIRED');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "dfsp_kyc_records" (
	"id" serial PRIMARY KEY NOT NULL,
	"fsp_id" varchar(64) NOT NULL,
	"legal_entity_name" varchar(256) NOT NULL,
	"registration_number" varchar(128) NOT NULL,
	"tax_id" varchar(64),
	"regulatory_body" varchar(128) NOT NULL,
	"license_number" varchar(128) NOT NULL,
	"aml_risk_level" varchar(16) DEFAULT 'LOW' NOT NULL,
	"pep_exposure" boolean DEFAULT false NOT NULL,
	"sanctions_screening_passed" boolean DEFAULT false NOT NULL,
	"beneficial_owners" text NOT NULL,
	"compliance_officer_name" varchar(256) NOT NULL,
	"compliance_officer_email" varchar(256) NOT NULL,
	"documents_provided" json DEFAULT '[]'::json NOT NULL,
	"acknowledged_aml_policy" boolean DEFAULT false NOT NULL,
	"acknowledged_data_processing" boolean DEFAULT false NOT NULL,
	"status" "dfsp_kyc_status" DEFAULT 'PENDING' NOT NULL,
	"reviewed_by" varchar(128),
	"reviewed_at" timestamp,
	"review_notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "dfsp_kyc_records_fsp_id_unique" UNIQUE("fsp_id")
);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
