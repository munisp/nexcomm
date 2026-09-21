-- Stakeholder onboarding/KYC fixes (A4 audit)
-- 1. account_type enum gains ADMIN so onboarding.submit can classify
--    WAREHOUSE_OPERATOR / MARKET_MAKER / ADMIN applications correctly.
-- 2. farmer_profiles gains accountStatus lifecycle + the real KYC-service
--    application id used by the biometric liveness flow.
-- 3. dfsp_kyc_records gains userId so review decisions can notify the applicant.

ALTER TYPE "account_type" ADD VALUE IF NOT EXISTS 'ADMIN';--> statement-breakpoint

DO $$ BEGIN
	CREATE TYPE "farmer_account_status" AS ENUM('ACTIVE', 'SUSPENDED');
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint

ALTER TABLE "farmer_profiles"
	ADD COLUMN IF NOT EXISTS "kyc_application_id" varchar(80),
	ADD COLUMN IF NOT EXISTS "account_status" "farmer_account_status" DEFAULT 'ACTIVE' NOT NULL;--> statement-breakpoint

ALTER TABLE "dfsp_kyc_records"
	ADD COLUMN IF NOT EXISTS "user_id" integer REFERENCES "users"("id") ON DELETE set null;
