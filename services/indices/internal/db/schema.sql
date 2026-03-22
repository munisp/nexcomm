-- ============================================================
-- NEXCOM Commodity Indices — TimescaleDB Schema
-- ============================================================
-- Requires: PostgreSQL 14+ with TimescaleDB 2.x extension
-- Run: psql -d nexcom -f schema.sql
-- ============================================================

-- Enable TimescaleDB extension
CREATE EXTENSION IF NOT EXISTS timescaledb;

-- ─────────────────────────────────────────────────────────────
-- Reference tables (standard PostgreSQL)
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS commodities (
    symbol          TEXT PRIMARY KEY,
    name            TEXT NOT NULL,
    category        TEXT NOT NULL CHECK (category IN ('GRAIN','OILSEED','CASH_CROP','LIVESTOCK','ENERGY')),
    currency        TEXT NOT NULL DEFAULT 'NGN',
    unit            TEXT NOT NULL DEFAULT 'MT',
    exchange        TEXT NOT NULL DEFAULT 'NEXCOM SPOT',
    quality_grade   TEXT,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS indices (
    id              TEXT PRIMARY KEY,
    name            TEXT NOT NULL,
    description     TEXT,
    category        TEXT NOT NULL,
    methodology     TEXT NOT NULL,
    currency        TEXT NOT NULL DEFAULT 'NGN',
    base_date       DATE NOT NULL DEFAULT '2020-01-01',
    base_value      DOUBLE PRECISION NOT NULL DEFAULT 10000,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS index_components (
    index_id        TEXT NOT NULL REFERENCES indices(id) ON DELETE CASCADE,
    symbol          TEXT NOT NULL REFERENCES commodities(symbol),
    weight          DOUBLE PRECISION NOT NULL CHECK (weight > 0 AND weight <= 1),
    base_price      DOUBLE PRECISION,
    quantity        DOUBLE PRECISION DEFAULT 1.0,
    effective_from  DATE NOT NULL DEFAULT '2020-01-01',
    effective_to    DATE,
    PRIMARY KEY (index_id, symbol, effective_from)
);

-- ─────────────────────────────────────────────────────────────
-- Time-series tables (converted to TimescaleDB hypertables)
-- ─────────────────────────────────────────────────────────────

-- Tick-level commodity prices (raw feed data)
CREATE TABLE IF NOT EXISTS commodity_ticks (
    time            TIMESTAMPTZ NOT NULL,
    symbol          TEXT NOT NULL,
    price           DOUBLE PRECISION NOT NULL,
    bid             DOUBLE PRECISION,
    ask             DOUBLE PRECISION,
    volume          DOUBLE PRECISION DEFAULT 0,
    source          TEXT DEFAULT 'NEXCOM'
);

SELECT create_hypertable(
    'commodity_ticks',
    'time',
    chunk_time_interval => INTERVAL '1 day',
    if_not_exists => TRUE
);

-- OHLCV candles for commodities (pre-aggregated)
CREATE TABLE IF NOT EXISTS commodity_ohlcv (
    time            TIMESTAMPTZ NOT NULL,
    symbol          TEXT NOT NULL,
    timeframe       TEXT NOT NULL CHECK (timeframe IN ('1m','5m','15m','1h','4h','1d','1w')),
    open            DOUBLE PRECISION NOT NULL,
    high            DOUBLE PRECISION NOT NULL,
    low             DOUBLE PRECISION NOT NULL,
    close           DOUBLE PRECISION NOT NULL,
    volume          DOUBLE PRECISION NOT NULL DEFAULT 0,
    PRIMARY KEY (time, symbol, timeframe)
);

SELECT create_hypertable(
    'commodity_ohlcv',
    'time',
    chunk_time_interval => INTERVAL '7 days',
    if_not_exists => TRUE
);

-- Index values time-series
CREATE TABLE IF NOT EXISTS index_values (
    time            TIMESTAMPTZ NOT NULL,
    index_id        TEXT NOT NULL,
    value           DOUBLE PRECISION NOT NULL,
    open            DOUBLE PRECISION,
    high            DOUBLE PRECISION,
    low             DOUBLE PRECISION,
    change          DOUBLE PRECISION,
    change_percent  DOUBLE PRECISION
);

SELECT create_hypertable(
    'index_values',
    'time',
    chunk_time_interval => INTERVAL '7 days',
    if_not_exists => TRUE
);

-- ─────────────────────────────────────────────────────────────
-- Continuous aggregates (materialized views refreshed automatically)
-- ─────────────────────────────────────────────────────────────

-- 1-hour OHLCV from ticks
CREATE MATERIALIZED VIEW IF NOT EXISTS commodity_ohlcv_1h
WITH (timescaledb.continuous) AS
SELECT
    time_bucket('1 hour', time) AS bucket,
    symbol,
    FIRST(price, time)          AS open,
    MAX(price)                  AS high,
    MIN(price)                  AS low,
    LAST(price, time)           AS close,
    SUM(volume)                 AS volume
FROM commodity_ticks
GROUP BY bucket, symbol
WITH NO DATA;

-- 1-day OHLCV from ticks
CREATE MATERIALIZED VIEW IF NOT EXISTS commodity_ohlcv_1d
WITH (timescaledb.continuous) AS
SELECT
    time_bucket('1 day', time)  AS bucket,
    symbol,
    FIRST(price, time)          AS open,
    MAX(price)                  AS high,
    MIN(price)                  AS low,
    LAST(price, time)           AS close,
    SUM(volume)                 AS volume
FROM commodity_ticks
GROUP BY bucket, symbol
WITH NO DATA;

-- ─────────────────────────────────────────────────────────────
-- Refresh policies (auto-refresh continuous aggregates)
-- ─────────────────────────────────────────────────────────────

SELECT add_continuous_aggregate_policy('commodity_ohlcv_1h',
    start_offset => INTERVAL '3 hours',
    end_offset   => INTERVAL '1 hour',
    schedule_interval => INTERVAL '1 hour',
    if_not_exists => TRUE
);

SELECT add_continuous_aggregate_policy('commodity_ohlcv_1d',
    start_offset => INTERVAL '3 days',
    end_offset   => INTERVAL '1 day',
    schedule_interval => INTERVAL '1 day',
    if_not_exists => TRUE
);

-- ─────────────────────────────────────────────────────────────
-- Compression policies (compress old chunks to save storage)
-- ─────────────────────────────────────────────────────────────

ALTER TABLE commodity_ticks SET (
    timescaledb.compress,
    timescaledb.compress_segmentby = 'symbol',
    timescaledb.compress_orderby = 'time DESC'
);

SELECT add_compression_policy('commodity_ticks',
    compress_after => INTERVAL '7 days',
    if_not_exists => TRUE
);

ALTER TABLE index_values SET (
    timescaledb.compress,
    timescaledb.compress_segmentby = 'index_id',
    timescaledb.compress_orderby = 'time DESC'
);

SELECT add_compression_policy('index_values',
    compress_after => INTERVAL '30 days',
    if_not_exists => TRUE
);

-- ─────────────────────────────────────────────────────────────
-- Retention policies (drop data older than configured period)
-- ─────────────────────────────────────────────────────────────

SELECT add_retention_policy('commodity_ticks',
    drop_after => INTERVAL '90 days',
    if_not_exists => TRUE
);

-- ─────────────────────────────────────────────────────────────
-- Indexes for query performance
-- ─────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_ticks_symbol_time
    ON commodity_ticks (symbol, time DESC);

CREATE INDEX IF NOT EXISTS idx_ohlcv_symbol_tf_time
    ON commodity_ohlcv (symbol, timeframe, time DESC);

CREATE INDEX IF NOT EXISTS idx_index_values_id_time
    ON index_values (index_id, time DESC);

-- ─────────────────────────────────────────────────────────────
-- Seed reference data
-- ─────────────────────────────────────────────────────────────

INSERT INTO commodities (symbol, name, category, currency, unit, quality_grade) VALUES
    ('MAIZE',     'White Maize',      'GRAIN',     'NGN', 'MT', 'Grade A'),
    ('SORGHUM',   'Sorghum',          'GRAIN',     'NGN', 'MT', 'Grade A'),
    ('RICE',      'Paddy Rice',       'GRAIN',     'NGN', 'MT', 'Grade A'),
    ('WHEAT',     'Wheat',            'GRAIN',     'NGN', 'MT', 'Grade A'),
    ('MILLET',    'Pearl Millet',     'GRAIN',     'NGN', 'MT', 'Grade A'),
    ('SOYBEAN',   'Soybean',          'OILSEED',   'NGN', 'MT', 'Grade A'),
    ('SESAME',    'Sesame Seeds',     'OILSEED',   'NGN', 'MT', 'Grade A'),
    ('GROUNDNUT', 'Groundnut',        'OILSEED',   'NGN', 'MT', 'Grade A'),
    ('SUNFLOWER', 'Sunflower Seed',   'OILSEED',   'NGN', 'MT', 'Grade A'),
    ('COCOA',     'Cocoa Beans',      'CASH_CROP', 'NGN', 'MT', 'Premium'),
    ('CASHEW',    'Cashew Nuts',      'CASH_CROP', 'NGN', 'MT', 'Grade W320'),
    ('COTTON',    'Cotton Lint',      'CASH_CROP', 'NGN', 'MT', 'Grade A'),
    ('COFFEE',    'Arabica Coffee',   'CASH_CROP', 'NGN', 'MT', 'Grade A'),
    ('GINGER',    'Dried Ginger',     'CASH_CROP', 'NGN', 'MT', 'Grade A')
ON CONFLICT (symbol) DO NOTHING;

INSERT INTO indices (id, name, description, category, methodology, currency, base_value) VALUES
    ('NAXI',  'NEXCOM Agri Index',          'Composite index tracking 15 major agricultural commodities', 'COMPOSITE', 'VALUE_WEIGHTED',  'NGN', 10000),
    ('NGGI',  'Nigeria Grain Index',        'Price-weighted index of major grain commodities in Nigeria', 'GRAIN',     'PRICE_WEIGHTED',  'NGN', 5000),
    ('AOXI',  'Africa Oilseed Index',       'Equal-weighted index of oilseed commodities across SSA',    'OILSEED',   'EQUAL_WEIGHTED',  'USD', 1000),
    ('WACCI', 'West Africa Cash Crop Index','Value-weighted index of cash crops in West Africa',          'CASH_CROP', 'VALUE_WEIGHTED',  'USD', 2000)
ON CONFLICT (id) DO NOTHING;
