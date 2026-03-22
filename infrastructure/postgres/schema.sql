-- ============================================================================
-- NEXCOM Exchange - Core Database Schema
-- PostgreSQL 16 with optimized indexes for commodity trading
-- ============================================================================

-- Enable extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================================
-- Custom Types
-- ============================================================================
DO $$ BEGIN
    CREATE TYPE order_side AS ENUM ('BUY', 'SELL');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE order_type AS ENUM ('MARKET', 'LIMIT', 'STOP', 'STOP_LIMIT', 'IOC', 'FOK');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE order_status AS ENUM ('PENDING', 'OPEN', 'PARTIAL', 'FILLED', 'CANCELLED', 'REJECTED', 'EXPIRED');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE trade_status AS ENUM ('EXECUTED', 'SETTLING', 'SETTLED', 'FAILED');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE kyc_level AS ENUM ('NONE', 'BASIC', 'INTERMEDIATE', 'ADVANCED');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE user_role AS ENUM ('FARMER', 'RETAIL_TRADER', 'INSTITUTIONAL', 'COOPERATIVE', 'ADMIN');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE commodity_category AS ENUM ('AGRICULTURAL', 'ENERGY', 'METALS', 'ENVIRONMENTAL');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- ============================================================================
-- Users & Authentication
-- ============================================================================
CREATE TABLE IF NOT EXISTS users (
    user_id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    keycloak_id     VARCHAR(255) UNIQUE,
    email           VARCHAR(255) UNIQUE NOT NULL,
    phone           VARCHAR(20) UNIQUE,
    display_name    VARCHAR(100) NOT NULL,
    role            user_role NOT NULL DEFAULT 'RETAIL_TRADER',
    kyc_level       kyc_level NOT NULL DEFAULT 'NONE',
    country_code    CHAR(2),
    currency        VARCHAR(3) DEFAULT 'USD',
    is_active       BOOLEAN NOT NULL DEFAULT true,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_phone ON users(phone);
CREATE INDEX idx_users_keycloak ON users(keycloak_id);
CREATE INDEX idx_users_role ON users(role);

-- ============================================================================
-- Commodities
-- ============================================================================
CREATE TABLE IF NOT EXISTS commodities (
    symbol          VARCHAR(20) PRIMARY KEY,
    name            VARCHAR(100) NOT NULL,
    category        commodity_category NOT NULL,
    unit            VARCHAR(20) NOT NULL,
    min_trade_qty   DECIMAL(18,8) NOT NULL DEFAULT 0.01,
    max_trade_qty   DECIMAL(18,8) NOT NULL DEFAULT 1000000,
    tick_size       DECIMAL(18,8) NOT NULL DEFAULT 0.01,
    is_active       BOOLEAN NOT NULL DEFAULT true,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed commodity data
INSERT INTO commodities (symbol, name, category, unit, tick_size) VALUES
    ('MAIZE', 'Maize (Corn)', 'AGRICULTURAL', 'MT', 0.25),
    ('WHEAT', 'Wheat', 'AGRICULTURAL', 'MT', 0.25),
    ('SOYBEAN', 'Soybeans', 'AGRICULTURAL', 'MT', 0.25),
    ('RICE', 'Rice', 'AGRICULTURAL', 'MT', 0.10),
    ('COFFEE', 'Coffee Arabica', 'AGRICULTURAL', 'LB', 0.05),
    ('COCOA', 'Cocoa', 'AGRICULTURAL', 'MT', 1.00),
    ('COTTON', 'Cotton', 'AGRICULTURAL', 'LB', 0.01),
    ('SUGAR', 'Raw Sugar', 'AGRICULTURAL', 'LB', 0.01),
    ('PALM_OIL', 'Palm Oil', 'AGRICULTURAL', 'MT', 0.50),
    ('CASHEW', 'Cashew Nuts', 'AGRICULTURAL', 'KG', 0.10),
    ('GOLD', 'Gold', 'METALS', 'OZ', 0.10),
    ('SILVER', 'Silver', 'METALS', 'OZ', 0.005),
    ('COPPER', 'Copper', 'METALS', 'MT', 0.50),
    ('CRUDE_OIL', 'WTI Crude Oil', 'ENERGY', 'BBL', 0.01),
    ('BRENT', 'Brent Crude Oil', 'ENERGY', 'BBL', 0.01),
    ('NAT_GAS', 'Natural Gas', 'ENERGY', 'MMBTU', 0.001),
    ('CARBON', 'Carbon Credits (EU ETS)', 'ENVIRONMENTAL', 'MT_CO2', 0.01)
ON CONFLICT (symbol) DO NOTHING;

-- ============================================================================
-- Orders
-- ============================================================================
CREATE TABLE IF NOT EXISTS orders (
    order_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(user_id),
    symbol          VARCHAR(20) NOT NULL REFERENCES commodities(symbol),
    side            order_side NOT NULL,
    order_type      order_type NOT NULL,
    quantity        DECIMAL(18,8) NOT NULL,
    filled_quantity DECIMAL(18,8) NOT NULL DEFAULT 0,
    price           DECIMAL(18,8),
    stop_price      DECIMAL(18,8),
    status          order_status NOT NULL DEFAULT 'PENDING',
    time_in_force   VARCHAR(10) DEFAULT 'GTC',
    client_order_id VARCHAR(64),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at      TIMESTAMPTZ,
    CONSTRAINT chk_quantity_positive CHECK (quantity > 0),
    CONSTRAINT chk_filled_lte_quantity CHECK (filled_quantity <= quantity)
);

-- Hot path indexes for order matching
CREATE INDEX CONCURRENTLY idx_orders_symbol_status
    ON orders(symbol, status) WHERE status IN ('PENDING', 'OPEN', 'PARTIAL');
CREATE INDEX CONCURRENTLY idx_orders_user_created
    ON orders(user_id, created_at DESC);
CREATE INDEX CONCURRENTLY idx_orders_client_id
    ON orders(client_order_id) WHERE client_order_id IS NOT NULL;

-- ============================================================================
-- Trades
-- ============================================================================
CREATE TABLE IF NOT EXISTS trades (
    trade_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    symbol          VARCHAR(20) NOT NULL REFERENCES commodities(symbol),
    buyer_order_id  UUID NOT NULL REFERENCES orders(order_id),
    seller_order_id UUID NOT NULL REFERENCES orders(order_id),
    buyer_id        UUID NOT NULL REFERENCES users(user_id),
    seller_id       UUID NOT NULL REFERENCES users(user_id),
    price           DECIMAL(18,8) NOT NULL,
    quantity        DECIMAL(18,8) NOT NULL,
    total_value     DECIMAL(18,8) NOT NULL,
    fee_buyer       DECIMAL(18,8) NOT NULL DEFAULT 0,
    fee_seller      DECIMAL(18,8) NOT NULL DEFAULT 0,
    status          trade_status NOT NULL DEFAULT 'EXECUTED',
    settlement_id   VARCHAR(255),
    executed_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    settled_at      TIMESTAMPTZ,
    CONSTRAINT chk_trade_qty_positive CHECK (quantity > 0),
    CONSTRAINT chk_trade_price_positive CHECK (price > 0)
);

CREATE INDEX idx_trades_symbol_time ON trades(symbol, executed_at DESC);
CREATE INDEX idx_trades_buyer ON trades(buyer_id, executed_at DESC);
CREATE INDEX idx_trades_seller ON trades(seller_id, executed_at DESC);
CREATE INDEX idx_trades_status ON trades(status) WHERE status != 'SETTLED';

-- ============================================================================
-- Positions
-- ============================================================================
CREATE TABLE IF NOT EXISTS positions (
    position_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(user_id),
    symbol          VARCHAR(20) NOT NULL REFERENCES commodities(symbol),
    quantity        DECIMAL(18,8) NOT NULL DEFAULT 0,
    avg_price       DECIMAL(18,8) NOT NULL DEFAULT 0,
    unrealized_pnl  DECIMAL(18,8) NOT NULL DEFAULT 0,
    realized_pnl    DECIMAL(18,8) NOT NULL DEFAULT 0,
    margin_used     DECIMAL(18,8) NOT NULL DEFAULT 0,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(user_id, symbol)
);

CREATE INDEX idx_positions_user ON positions(user_id);
CREATE INDEX idx_positions_symbol ON positions(symbol);

-- ============================================================================
-- Market Data (Time-Series - use TimescaleDB in production)
-- ============================================================================
CREATE TABLE IF NOT EXISTS market_data (
    timestamp       TIMESTAMPTZ NOT NULL,
    symbol          VARCHAR(20) NOT NULL,
    price           DECIMAL(18,8) NOT NULL,
    volume          DECIMAL(18,8) NOT NULL,
    bid             DECIMAL(18,8),
    ask             DECIMAL(18,8),
    PRIMARY KEY (timestamp, symbol)
);

-- ============================================================================
-- Accounts / Balances
-- ============================================================================
CREATE TABLE IF NOT EXISTS accounts (
    account_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(user_id),
    currency        VARCHAR(10) NOT NULL,
    balance         DECIMAL(18,8) NOT NULL DEFAULT 0,
    available       DECIMAL(18,8) NOT NULL DEFAULT 0,
    reserved        DECIMAL(18,8) NOT NULL DEFAULT 0,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(user_id, currency),
    CONSTRAINT chk_balance_non_negative CHECK (balance >= 0),
    CONSTRAINT chk_available_non_negative CHECK (available >= 0)
);

CREATE INDEX idx_accounts_user ON accounts(user_id);

-- ============================================================================
-- Audit Log
-- ============================================================================
CREATE TABLE IF NOT EXISTS audit_log (
    log_id          BIGSERIAL PRIMARY KEY,
    user_id         UUID,
    action          VARCHAR(100) NOT NULL,
    entity_type     VARCHAR(50) NOT NULL,
    entity_id       VARCHAR(255),
    details         JSONB,
    ip_address      INET,
    user_agent      TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_user_time ON audit_log(user_id, created_at DESC);
CREATE INDEX idx_audit_action ON audit_log(action, created_at DESC);
CREATE INDEX idx_audit_entity ON audit_log(entity_type, entity_id);

-- ============================================================================
-- Updated_at trigger function
-- ============================================================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_orders_updated_at BEFORE UPDATE ON orders
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_positions_updated_at BEFORE UPDATE ON positions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_accounts_updated_at BEFORE UPDATE ON accounts
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
