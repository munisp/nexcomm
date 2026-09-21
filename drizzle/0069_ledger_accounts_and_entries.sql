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
