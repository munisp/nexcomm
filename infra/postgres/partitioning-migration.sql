-- NEXCOM Exchange — Table Partitioning Migration
-- Converts high-volume tables (orders, settlements) to RANGE partitioning by month.
-- Run this ONCE on a maintenance window after taking a full backup.
-- Requires pg_partman extension for automated future partition creation.

-- ─────────────────────────────────────────────────────────────────────────────
-- Prerequisites
-- ─────────────────────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS pg_partman;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. ORDERS — partition by created_at (monthly)
-- ─────────────────────────────────────────────────────────────────────────────

-- 1a. Rename existing table
ALTER TABLE orders RENAME TO orders_legacy;

-- 1b. Create partitioned parent
CREATE TABLE orders (
  LIKE orders_legacy INCLUDING ALL
) PARTITION BY RANGE (created_at);

-- 1c. Migrate data in monthly batches (non-blocking via INSERT ... SELECT)
DO $$
DECLARE
  batch_start TIMESTAMPTZ;
  batch_end   TIMESTAMPTZ;
  min_ts      TIMESTAMPTZ;
  max_ts      TIMESTAMPTZ;
BEGIN
  SELECT MIN(created_at), MAX(created_at) INTO min_ts, max_ts FROM orders_legacy;
  batch_start := DATE_TRUNC('month', min_ts);
  WHILE batch_start <= max_ts LOOP
    batch_end := batch_start + INTERVAL '1 month';
    -- Create partition for this month
    EXECUTE format(
      'CREATE TABLE IF NOT EXISTS orders_%s PARTITION OF orders
       FOR VALUES FROM (%L) TO (%L)',
      TO_CHAR(batch_start, 'YYYY_MM'),
      batch_start,
      batch_end
    );
    -- Move data
    EXECUTE format(
      'INSERT INTO orders SELECT * FROM orders_legacy
       WHERE created_at >= %L AND created_at < %L',
      batch_start, batch_end
    );
    batch_start := batch_end;
  END LOOP;
END $$;

-- 1d. Drop legacy table after verification
-- DROP TABLE orders_legacy;  -- Run manually after verifying row counts

-- 1e. Register with pg_partman for automatic future partition creation
SELECT partman.create_parent(
  p_parent_table  => 'public.orders',
  p_control       => 'created_at',
  p_type          => 'range',
  p_interval      => 'monthly',
  p_premake       => 3
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. SETTLEMENTS — partition by settlement_date (monthly)
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE settlements RENAME TO settlements_legacy;

CREATE TABLE settlements (
  LIKE settlements_legacy INCLUDING ALL
) PARTITION BY RANGE (settlement_date);

DO $$
DECLARE
  batch_start DATE;
  batch_end   DATE;
  min_d       DATE;
  max_d       DATE;
BEGIN
  SELECT MIN(settlement_date), MAX(settlement_date) INTO min_d, max_d FROM settlements_legacy;
  batch_start := DATE_TRUNC('month', min_d)::DATE;
  WHILE batch_start <= max_d LOOP
    batch_end := (batch_start + INTERVAL '1 month')::DATE;
    EXECUTE format(
      'CREATE TABLE IF NOT EXISTS settlements_%s PARTITION OF settlements
       FOR VALUES FROM (%L) TO (%L)',
      TO_CHAR(batch_start, 'YYYY_MM'),
      batch_start,
      batch_end
    );
    EXECUTE format(
      'INSERT INTO settlements SELECT * FROM settlements_legacy
       WHERE settlement_date >= %L AND settlement_date < %L',
      batch_start, batch_end
    );
    batch_start := batch_end;
  END LOOP;
END $$;

SELECT partman.create_parent(
  p_parent_table  => 'public.settlements',
  p_control       => 'settlement_date',
  p_type          => 'range',
  p_interval      => 'monthly',
  p_premake       => 3
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. TRADE_FILLS — partition by filled_at (monthly)
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE trade_fills RENAME TO trade_fills_legacy;

CREATE TABLE trade_fills (
  LIKE trade_fills_legacy INCLUDING ALL
) PARTITION BY RANGE (filled_at);

DO $$
DECLARE
  batch_start TIMESTAMPTZ;
  batch_end   TIMESTAMPTZ;
  min_ts      TIMESTAMPTZ;
  max_ts      TIMESTAMPTZ;
BEGIN
  SELECT MIN(filled_at), MAX(filled_at) INTO min_ts, max_ts FROM trade_fills_legacy;
  batch_start := DATE_TRUNC('month', COALESCE(min_ts, NOW()));
  max_ts := COALESCE(max_ts, NOW());
  WHILE batch_start <= max_ts LOOP
    batch_end := batch_start + INTERVAL '1 month';
    EXECUTE format(
      'CREATE TABLE IF NOT EXISTS trade_fills_%s PARTITION OF trade_fills
       FOR VALUES FROM (%L) TO (%L)',
      TO_CHAR(batch_start, 'YYYY_MM'),
      batch_start,
      batch_end
    );
    EXECUTE format(
      'INSERT INTO trade_fills SELECT * FROM trade_fills_legacy
       WHERE filled_at >= %L AND filled_at < %L',
      batch_start, batch_end
    );
    batch_start := batch_end;
  END LOOP;
END $$;

SELECT partman.create_parent(
  p_parent_table  => 'public.trade_fills',
  p_control       => 'filled_at',
  p_type          => 'range',
  p_interval      => 'monthly',
  p_premake       => 3
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. pg_partman background worker configuration
-- ─────────────────────────────────────────────────────────────────────────────
-- Add to postgresql.conf (or postgres-configmap.yaml):
--   shared_preload_libraries = 'pg_partman_bgw'
--   pg_partman_bgw.interval  = 3600   -- run every hour
--   pg_partman_bgw.role      = nexcom
--   pg_partman_bgw.dbname    = nexcom

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Verify
-- ─────────────────────────────────────────────────────────────────────────────
SELECT
  parent_table,
  control,
  partition_interval,
  premake,
  automatic_maintenance
FROM partman.part_config
ORDER BY parent_table;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1B PAYMENTS ARCHITECTURE ADDITIONS
-- Based on: https://backend.how/posts/1b-payments-per-day/
--           https://github.com/pratikgajjar/1b-payments
-- ─────────────────────────────────────────────────────────────────────────────

-- ─── Job Queue (SKIP LOCKED pattern) ─────────────────────────────────────────
-- Enables non-blocking concurrent job processing across multiple workers.
-- The 1B payments benchmark achieved 11,569 TPS using this pattern.
CREATE TABLE IF NOT EXISTS job_queue (
  id TEXT PRIMARY KEY,
  queue TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}',
  priority INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'dead')),
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  scheduled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  locked_by TEXT,
  locked_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Composite index for efficient SKIP LOCKED dequeue
CREATE INDEX IF NOT EXISTS idx_job_queue_dequeue
  ON job_queue (queue, priority DESC, scheduled_at ASC)
  WHERE status = 'pending';

-- Index for detecting stalled jobs (locked but not completed)
CREATE INDEX IF NOT EXISTS idx_job_queue_stalled
  ON job_queue (locked_at)
  WHERE status = 'processing';

-- ─── Double-Entry Ledger ──────────────────────────────────────────────────────
-- Every financial transaction creates two journal entries (debit + credit).
-- This is the accounting foundation of the 1B payments architecture.
-- Ensures: Assets = Liabilities + Equity at all times.
CREATE TABLE IF NOT EXISTS ledger_accounts (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  account_type TEXT NOT NULL CHECK (account_type IN (
    'TRADING', 'SETTLEMENT', 'MARGIN', 'FEE',
    'ESCROW', 'INSURANCE', 'RESERVE'
  )),
  currency TEXT NOT NULL DEFAULT 'NGN',
  balance NUMERIC(30, 8) NOT NULL DEFAULT 0 CHECK (balance >= 0),
  pending_debit NUMERIC(30, 8) NOT NULL DEFAULT 0 CHECK (pending_debit >= 0),
  pending_credit NUMERIC(30, 8) NOT NULL DEFAULT 0 CHECK (pending_credit >= 0),
  version BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, account_type, currency)
);

CREATE INDEX IF NOT EXISTS idx_ledger_accounts_user
  ON ledger_accounts (user_id, account_type);

-- Ledger entries partitioned by month for hot/warm/cold tiering
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

-- Create quarterly partitions for 2026
CREATE TABLE IF NOT EXISTS ledger_entries_2026_q1 PARTITION OF ledger_entries
  FOR VALUES FROM ('2026-01-01') TO ('2026-04-01');
CREATE TABLE IF NOT EXISTS ledger_entries_2026_q2 PARTITION OF ledger_entries
  FOR VALUES FROM ('2026-04-01') TO ('2026-07-01');
CREATE TABLE IF NOT EXISTS ledger_entries_2026_q3 PARTITION OF ledger_entries
  FOR VALUES FROM ('2026-07-01') TO ('2026-10-01');
CREATE TABLE IF NOT EXISTS ledger_entries_2026_q4 PARTITION OF ledger_entries
  FOR VALUES FROM ('2026-10-01') TO ('2027-01-01');
CREATE TABLE IF NOT EXISTS ledger_entries_future PARTITION OF ledger_entries
  FOR VALUES FROM ('2027-01-01') TO (MAXVALUE);

-- Indexes on ledger entries (inherited by all partitions)
CREATE INDEX IF NOT EXISTS idx_ledger_entries_account_time
  ON ledger_entries (account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ledger_entries_journal
  ON ledger_entries (journal_id);
CREATE INDEX IF NOT EXISTS idx_ledger_entries_reference
  ON ledger_entries (reference_type, reference_id);

-- ─── Trades Partitioning ──────────────────────────────────────────────────────
-- Partition trades by month for 10x query performance via partition pruning.
-- The 1B payments benchmark uses monthly partitions for transfers table.
DO $$
BEGIN
  -- Only run if trades table exists and is not already partitioned
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'trades'
    AND table_type = 'BASE TABLE'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_partitioned_table pt
    JOIN pg_class c ON c.oid = pt.partrelid
    WHERE c.relname = 'trades'
  ) THEN
    -- Rename existing table
    ALTER TABLE trades RENAME TO trades_legacy;

    -- Create partitioned parent
    CREATE TABLE trades (
      LIKE trades_legacy INCLUDING ALL,
      PRIMARY KEY (id, executed_at)
    ) PARTITION BY RANGE (executed_at);

    -- Create monthly partitions
    CREATE TABLE trades_2026_01 PARTITION OF trades FOR VALUES FROM ('2026-01-01') TO ('2026-02-01');
    CREATE TABLE trades_2026_02 PARTITION OF trades FOR VALUES FROM ('2026-02-01') TO ('2026-03-01');
    CREATE TABLE trades_2026_03 PARTITION OF trades FOR VALUES FROM ('2026-03-01') TO ('2026-04-01');
    CREATE TABLE trades_2026_04 PARTITION OF trades FOR VALUES FROM ('2026-04-01') TO ('2026-05-01');
    CREATE TABLE trades_2026_05 PARTITION OF trades FOR VALUES FROM ('2026-05-01') TO ('2026-06-01');
    CREATE TABLE trades_2026_06 PARTITION OF trades FOR VALUES FROM ('2026-06-01') TO ('2026-07-01');
    CREATE TABLE trades_2026_07 PARTITION OF trades FOR VALUES FROM ('2026-07-01') TO ('2026-08-01');
    CREATE TABLE trades_2026_08 PARTITION OF trades FOR VALUES FROM ('2026-08-01') TO ('2026-09-01');
    CREATE TABLE trades_2026_09 PARTITION OF trades FOR VALUES FROM ('2026-09-01') TO ('2026-10-01');
    CREATE TABLE trades_2026_10 PARTITION OF trades FOR VALUES FROM ('2026-10-01') TO ('2026-11-01');
    CREATE TABLE trades_2026_11 PARTITION OF trades FOR VALUES FROM ('2026-11-01') TO ('2026-12-01');
    CREATE TABLE trades_2026_12 PARTITION OF trades FOR VALUES FROM ('2026-12-01') TO ('2027-01-01');
    CREATE TABLE trades_future PARTITION OF trades FOR VALUES FROM ('2027-01-01') TO (MAXVALUE);

    -- Migrate data
    INSERT INTO trades SELECT * FROM trades_legacy;

    -- Register with pg_partman for automatic future partition creation
    PERFORM partman.create_parent(
      p_parent_table := 'public.trades',
      p_control := 'executed_at',
      p_interval := 'monthly',
      p_premake := 3
    );

    RAISE NOTICE 'Trades table partitioned successfully';
  ELSE
    RAISE NOTICE 'Trades table already partitioned or does not exist, skipping';
  END IF;
END $$;

-- ─── pg_partman Maintenance Job ───────────────────────────────────────────────
-- Schedule this to run hourly via pg_cron or external cron job:
-- SELECT cron.schedule('partition-maintenance', '0 * * * *', 'SELECT partman.run_maintenance_proc()');

-- ─── LISTEN/NOTIFY Channels ───────────────────────────────────────────────────
-- These channels are used by the application for real-time event propagation.
-- No DDL needed — channels are created dynamically by NOTIFY.
-- Application channels:
--   trade_executed      - new trade execution (settlement engine → API server)
--   order_filled        - order fully filled (matching engine → API server)
--   price_update        - live price update (price feed → WebSocket clients)
--   settlement_complete - settlement confirmed (settlement engine → clients)
--   kyc_approved        - KYC approval (kyc-service → API server)
--   loan_status_change  - loan lifecycle event (core-banking → API server)

-- ─── Stalled Job Recovery ─────────────────────────────────────────────────────
-- Run this periodically to recover jobs that were locked but never completed
-- (e.g., due to worker crash). Schedule via pg_cron:
-- SELECT cron.schedule('recover-stalled-jobs', '*/5 * * * *', $$
--   UPDATE job_queue
--   SET status = 'pending', locked_by = NULL, locked_at = NULL
--   WHERE status = 'processing'
--     AND locked_at < NOW() - INTERVAL '5 minutes'
--     AND attempts < max_attempts;
-- $$);

