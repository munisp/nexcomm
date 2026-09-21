-- Migration: 0075_kyb_workflows (renumbered from 0070_kyb_workflows during integration merge) (FIX-KYB)
-- Adds KYB (Know Your Business) workflow tables and KYC tier lifecycle tables.
-- This migration is idempotent (uses IF NOT EXISTS / duplicate_object guards).

-- ─── Enums ────────────────────────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE kyb_business_type AS ENUM ('SOLE_PROP', 'LLC', 'PLC', 'COOPERATIVE', 'PARTNERSHIP', 'NGO');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE kyb_application_status AS ENUM ('DRAFT', 'SUBMITTED', 'SCREENING', 'UNDER_REVIEW', 'EDD_REQUIRED', 'APPROVED', 'REJECTED', 'SUSPENDED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE kyb_risk_level AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'PROHIBITED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE kyb_verification_status AS ENUM ('PENDING', 'VERIFIED', 'FAILED', 'MANUAL_REVIEW');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE kyc_tier AS ENUM ('TIER_1', 'TIER_2', 'TIER_3');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE kyc_tier_upgrade_status AS ENUM ('PENDING', 'UNDER_REVIEW', 'APPROVED', 'REJECTED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ─── kyb_applications ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS kyb_applications (
  id BIGSERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  business_name VARCHAR(256) NOT NULL,
  business_type kyb_business_type NOT NULL,
  cac_rc_number VARCHAR(32),
  tin_number VARCHAR(20),
  incorporation_date TIMESTAMP,
  registered_address TEXT,
  operating_states JSONB,
  website_url VARCHAR(256),
  contact_email VARCHAR(200),
  contact_phone VARCHAR(30),
  expected_monthly_volume NUMERIC(20,2),
  documents JSONB NOT NULL DEFAULT '{}',
  status kyb_application_status NOT NULL DEFAULT 'DRAFT',
  risk_level kyb_risk_level,
  screening_result JSONB,
  screening_completed_at TIMESTAMP,
  edd_checklist JSONB,
  reviewed_by INTEGER,
  reviewed_at TIMESTAMP,
  review_notes TEXT,
  rejection_reason TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_kyb_applications_user ON kyb_applications (user_id);
CREATE INDEX IF NOT EXISTS idx_kyb_applications_status ON kyb_applications (status);
CREATE INDEX IF NOT EXISTS idx_kyb_applications_risk ON kyb_applications (risk_level);
CREATE INDEX IF NOT EXISTS idx_kyb_applications_rc ON kyb_applications (cac_rc_number);

-- ─── kyb_beneficial_owners ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS kyb_beneficial_owners (
  id BIGSERIAL PRIMARY KEY,
  kyb_application_id INTEGER NOT NULL REFERENCES kyb_applications(id) ON DELETE CASCADE,
  full_name VARCHAR(200) NOT NULL,
  date_of_birth TIMESTAMP,
  nationality VARCHAR(100) NOT NULL DEFAULT 'Nigerian',
  bvn_hash VARCHAR(64),
  nin_hash VARCHAR(64),
  ownership_percent NUMERIC(5,2) NOT NULL,
  is_ubo BOOLEAN NOT NULL DEFAULT FALSE,
  is_pep BOOLEAN NOT NULL DEFAULT FALSE,
  pep_details TEXT,
  id_document_url TEXT,
  verification_status kyb_verification_status NOT NULL DEFAULT 'PENDING',
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_kyb_ubos_application ON kyb_beneficial_owners (kyb_application_id);

-- ─── kyb_directors ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS kyb_directors (
  id BIGSERIAL PRIMARY KEY,
  kyb_application_id INTEGER NOT NULL REFERENCES kyb_applications(id) ON DELETE CASCADE,
  full_name VARCHAR(200) NOT NULL,
  role VARCHAR(100) NOT NULL DEFAULT 'Director',
  appointment_date TIMESTAMP,
  bvn_hash VARCHAR(64),
  nin_hash VARCHAR(64),
  linked_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  id_document_url TEXT,
  verification_status kyb_verification_status NOT NULL DEFAULT 'PENDING',
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_kyb_directors_application ON kyb_directors (kyb_application_id);

-- ─── kyb_audit_log ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS kyb_audit_log (
  id BIGSERIAL PRIMARY KEY,
  kyb_application_id INTEGER NOT NULL REFERENCES kyb_applications(id) ON DELETE CASCADE,
  action VARCHAR(64) NOT NULL,
  performed_by INTEGER,
  previous_status VARCHAR(32),
  new_status VARCHAR(32),
  notes TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_kyb_audit_log_application ON kyb_audit_log (kyb_application_id);

-- ─── kyc_tier_upgrade_requests ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS kyc_tier_upgrade_requests (
  id BIGSERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  from_tier kyc_tier NOT NULL,
  to_tier kyc_tier NOT NULL,
  documents JSONB NOT NULL DEFAULT '{}',
  kyb_application_id INTEGER REFERENCES kyb_applications(id) ON DELETE SET NULL,
  status kyc_tier_upgrade_status NOT NULL DEFAULT 'PENDING',
  reviewed_by INTEGER,
  reviewed_at TIMESTAMP,
  review_notes TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_kyc_tier_upgrades_user ON kyc_tier_upgrade_requests (user_id);
CREATE INDEX IF NOT EXISTS idx_kyc_tier_upgrades_status ON kyc_tier_upgrade_requests (status);
CREATE UNIQUE INDEX IF NOT EXISTS uq_kyc_tier_upgrades_user_target ON kyc_tier_upgrade_requests (user_id, to_tier);

-- ─── user_kyc_tiers ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS user_kyc_tiers (
  id BIGSERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  tier kyc_tier NOT NULL DEFAULT 'TIER_1',
  reason TEXT,
  updated_by INTEGER,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_kyc_tiers_tier ON user_kyc_tiers (tier);
