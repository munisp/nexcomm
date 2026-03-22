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
