-- Reconciles schema changes that previously existed outside the Drizzle migration journal.

-- This idempotent migration is safe for databases that received manual hotfixes.

-- Migration: 0061_missing_tables_and_columns
-- Adds tables and columns that exist in schema.ts but were missing from prior migrations.
-- This migration is idempotent (uses IF NOT EXISTS / IF EXISTS guards).

-- ─── Enums ────────────────────────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE ip_allowlist_scope AS ENUM ('ALL', 'TRADING', 'ADMIN', 'API', 'WITHDRAWAL');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE collateral_type AS ENUM ('CASH', 'GOVERNMENT_BOND', 'CORPORATE_BOND', 'EQUITY', 'WAREHOUSE_RECEIPT', 'LETTER_OF_CREDIT', 'OTHER');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE collateral_status AS ENUM ('ACTIVE', 'RELEASED', 'LIQUIDATED', 'PENDING', 'EXPIRED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE option_type AS ENUM ('CALL', 'PUT');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE option_style AS ENUM ('EUROPEAN', 'AMERICAN');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE options_contract_status AS ENUM ('ACTIVE', 'EXPIRED', 'SETTLED', 'CANCELLED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE option_position_status AS ENUM ('OPEN', 'CLOSED', 'EXERCISED', 'EXPIRED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE broker_tier AS ENUM ('STANDARD', 'PREMIUM', 'INSTITUTIONAL');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE broker_kyc_status AS ENUM ('PENDING', 'UNDER_REVIEW', 'APPROVED', 'REJECTED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE broker_account_status AS ENUM ('INACTIVE', 'ACTIVE', 'SUSPENDED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE auto_liquidation_status AS ENUM ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'FAILED', 'CANCELLED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE crop_status AS ENUM ('ACTIVE', 'SOLD', 'EXPIRED', 'CANCELLED', 'PENDING_REVIEW');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE kyc_audit_stakeholder AS ENUM ('FARMER', 'TRADER', 'BROKER', 'WAREHOUSE_OPERATOR', 'MARKET_MAKER', 'EXCHANGE_OPERATOR', 'COOPERATIVE', 'DFSP');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE kyc_audit_decision AS ENUM ('APPROVED', 'REJECTED', 'FLAGGED', 'REQUESTED_MORE_INFO');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Add SECURITY_ALERT to notification_type enum if missing
DO $$ BEGIN
  ALTER TYPE notification_type ADD VALUE 'SECURITY_ALERT';
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ─── ip_allowlist ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ip_allowlist (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  cidr TEXT NOT NULL,
  label TEXT,
  scope TEXT NOT NULL DEFAULT 'ALL',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- ─── collateral_items ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS collateral_items (
  id SERIAL PRIMARY KEY,
  margin_account_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  collateral_type collateral_type NOT NULL,
  reference_id INTEGER,
  description TEXT NOT NULL,
  face_value NUMERIC(18,2) NOT NULL,
  current_value NUMERIC(18,2) NOT NULL,
  haircut NUMERIC(5,2) NOT NULL DEFAULT 20,
  eligible_value NUMERIC(18,2) NOT NULL,
  status collateral_status NOT NULL DEFAULT 'ACTIVE',
  pledged_at TIMESTAMP NOT NULL DEFAULT NOW(),
  released_at TIMESTAMP,
  notes TEXT
);

-- ─── mfa_otp_codes ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS mfa_otp_codes (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  method TEXT NOT NULL DEFAULT 'TOTP',
  code TEXT,
  code_hash TEXT,
  purpose TEXT NOT NULL DEFAULT 'LOGIN',
  expires_at TIMESTAMP NOT NULL,
  used_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- ─── options_contracts ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS options_contracts (
  id BIGSERIAL PRIMARY KEY,
  symbol VARCHAR(50) NOT NULL UNIQUE,
  underlying_contract_id INTEGER,
  option_type option_type NOT NULL,
  strike_price NUMERIC(20,8) NOT NULL,
  expiry_date TIMESTAMP NOT NULL,
  contract_size NUMERIC(18,6) NOT NULL DEFAULT 1,
  risk_free_rate NUMERIC(10,6) NOT NULL DEFAULT 0.05,
  implied_volatility NUMERIC(10,6) NOT NULL DEFAULT 0.20,
  last_price NUMERIC(20,8),
  open_interest INTEGER NOT NULL DEFAULT 0,
  status options_contract_status NOT NULL DEFAULT 'ACTIVE',
  created_by INTEGER,
  ledger_tx_id VARCHAR(64),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- ─── broker_profiles ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS broker_profiles (
  id BIGSERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  firm_name VARCHAR(200) NOT NULL,
  rc_number VARCHAR(50),
  sec_license_number VARCHAR(100),
  cbn_license_number VARCHAR(100),
  regulatory_body VARCHAR(100),
  contact_phone VARCHAR(30),
  contact_email VARCHAR(200),
  firm_address TEXT,
  state VARCHAR(100),
  years_in_operation INTEGER,
  client_book_size VARCHAR(50),
  commission_rate NUMERIC(6,4),
  sec_certificate_url TEXT,
  cbn_approval_url TEXT,
  cac_doc_url TEXT,
  kyc_status TEXT NOT NULL DEFAULT 'PENDING',
  kyc_notes TEXT,
  account_status TEXT NOT NULL DEFAULT 'INACTIVE',
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- ─── auto_liquidation_orders ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS auto_liquidation_orders (
  id BIGSERIAL PRIMARY KEY,
  margin_call_id BIGINT NOT NULL,
  clearing_account_id BIGINT NOT NULL,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status auto_liquidation_status NOT NULL DEFAULT 'PENDING',
  instrument VARCHAR(64) NOT NULL,
  quantity NUMERIC(20,8) NOT NULL,
  estimated_value NUMERIC(20,2) NOT NULL,
  actual_proceeds NUMERIC(20,2),
  initiated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMP,
  initiated_by INTEGER,
  failure_reason TEXT,
  notes TEXT
);

-- ─── crop_listings ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS crop_listings (
  id BIGSERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  farm_id INTEGER NOT NULL,
  crop_type VARCHAR(100) NOT NULL,
  variety VARCHAR(100),
  quantity_kg NUMERIC(14,2) NOT NULL,
  asking_price_per_kg NUMERIC(14,4) NOT NULL,
  currency VARCHAR(10) NOT NULL DEFAULT 'NGN',
  expected_harvest_date TIMESTAMP NOT NULL,
  description TEXT,
  status crop_status NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- ─── kyc_audit_log ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS kyc_audit_log (
  id BIGSERIAL PRIMARY KEY,
  stakeholder_type kyc_audit_stakeholder NOT NULL,
  profile_id INTEGER NOT NULL,
  reviewer_id INTEGER NOT NULL,
  reviewer_name TEXT,
  decision kyc_audit_decision NOT NULL,
  notes TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- ─── Column additions to existing tables ──────────────────────────────────────

-- farm_profiles: add centroid and geom columns
ALTER TABLE farm_profiles ADD COLUMN IF NOT EXISTS centroid TEXT;
ALTER TABLE farm_profiles ADD COLUMN IF NOT EXISTS geom TEXT;


-- Migration: 0062_ledger_accounts_and_entries
-- Adds the double-entry ledger tables required by the ledgerRouter.
-- These tables are defined in server/pg-optimizations.ts (DOUBLE_ENTRY_DDL)
-- and are used by all fund-flow operations.
-- This migration is idempotent (uses IF NOT EXISTS guards).

-- ─── Ledger Accounts ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ledger_accounts (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  account_type TEXT NOT NULL CHECK (account_type IN (
    'TRADING', 'SETTLEMENT', 'MARGIN', 'FEE', 'ESCROW', 'INSURANCE', 'RESERVE'
  )),
  currency TEXT NOT NULL DEFAULT 'NGN',
  balance NUMERIC(30, 8) NOT NULL DEFAULT 0 CHECK (balance >= 0),
  pending_debit NUMERIC(30, 8) NOT NULL DEFAULT 0 CHECK (pending_debit >= 0),
  pending_credit NUMERIC(30, 8) NOT NULL DEFAULT 0 CHECK (pending_credit >= 0),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'frozen', 'closed')),
  version BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, account_type, currency)
);

-- ─── Ledger Entries (partitioned by quarter) ─────────────────────────────────
CREATE TABLE IF NOT EXISTS ledger_entries (
  id TEXT NOT NULL,
  journal_id TEXT NOT NULL,
  account_id TEXT NOT NULL REFERENCES ledger_accounts(id),
  entry_type TEXT NOT NULL CHECK (entry_type IN ('DEBIT', 'CREDIT')),
  amount NUMERIC(30, 8) NOT NULL CHECK (amount > 0),
  currency TEXT NOT NULL DEFAULT 'NGN',
  reference_type TEXT NOT NULL,
  reference_id TEXT NOT NULL,
  description TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

CREATE TABLE IF NOT EXISTS ledger_entries_2026_q1 PARTITION OF ledger_entries
  FOR VALUES FROM ('2026-01-01') TO ('2026-04-01');
CREATE TABLE IF NOT EXISTS ledger_entries_2026_q2 PARTITION OF ledger_entries
  FOR VALUES FROM ('2026-04-01') TO ('2026-07-01');
CREATE TABLE IF NOT EXISTS ledger_entries_2026_q3 PARTITION OF ledger_entries
  FOR VALUES FROM ('2026-07-01') TO ('2026-10-01');
CREATE TABLE IF NOT EXISTS ledger_entries_2026_q4 PARTITION OF ledger_entries
  FOR VALUES FROM ('2026-10-01') TO ('2027-01-01');
CREATE TABLE IF NOT EXISTS ledger_entries_2027_q1 PARTITION OF ledger_entries
  FOR VALUES FROM ('2027-01-01') TO ('2027-04-01');
CREATE TABLE IF NOT EXISTS ledger_entries_future PARTITION OF ledger_entries
  FOR VALUES FROM ('2027-04-01') TO (MAXVALUE);

-- ─── Ledger Job Queue (SKIP LOCKED pattern for async settlement) ─────────────
CREATE TABLE IF NOT EXISTS ledger_jobs (
  id BIGSERIAL PRIMARY KEY,
  job_type TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'done', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  scheduled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ
);

-- ─── Indexes ─────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_ledger_accounts_user ON ledger_accounts (user_id, account_type);
CREATE INDEX IF NOT EXISTS idx_ledger_accounts_currency ON ledger_accounts (currency);
CREATE INDEX IF NOT EXISTS idx_ledger_entries_account ON ledger_entries (account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ledger_entries_journal ON ledger_entries (journal_id);
CREATE INDEX IF NOT EXISTS idx_ledger_entries_reference ON ledger_entries (reference_type, reference_id);
CREATE INDEX IF NOT EXISTS idx_ledger_jobs_status ON ledger_jobs (status, scheduled_at) WHERE status = 'pending';
