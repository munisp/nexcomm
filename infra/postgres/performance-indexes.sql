-- =============================================================================
-- NEXCOM Commodity Exchange — PostgreSQL Performance Indexes & Partitioning
-- Apply with: psql $DATABASE_URL -f performance-indexes.sql
-- =============================================================================
-- These indexes are designed for the NEXCOM trading workload:
--   - High-frequency ORDER queries (open order book, user order history)
--   - Settlement queries (pending settlements, by symbol)
--   - Position queries (by user, by symbol)
--   - Notification queries (unread by user)
-- All indexes use CONCURRENTLY to avoid locking production tables.
-- =============================================================================

-- ── Enable extensions ─────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
CREATE EXTENSION IF NOT EXISTS pgaudit;
CREATE EXTENSION IF NOT EXISTS pg_partman;  -- Automated partition management

-- ── Orders table indexes ──────────────────────────────────────────────────────

-- 1. Open order book: partial index for active orders by symbol and side
-- Used by: matching engine order book queries, market data depth queries
-- Covers: WHERE status = 'OPEN' ORDER BY price DESC/ASC
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_orders_open_book_bids
  ON orders (symbol, price DESC, created_at ASC)
  WHERE status = 'OPEN' AND side = 'BUY';

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_orders_open_book_asks
  ON orders (symbol, price ASC, created_at ASC)
  WHERE status = 'OPEN' AND side = 'SELL';

-- 2. User order history: composite index for paginated order history
-- Used by: trpc.orders.list (by user, sorted by created_at DESC)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_orders_user_history
  ON orders (user_id, created_at DESC, status)
  INCLUDE (symbol, side, quantity, price, filled_quantity);

-- 3. Order lookup by ID (for cancel and fill operations)
-- The primary key covers this, but include status for partial index benefit
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_orders_id_status
  ON orders (id, status)
  WHERE status IN ('OPEN', 'PARTIAL');

-- 4. Symbol + status for market surveillance
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_orders_symbol_status_time
  ON orders (symbol, status, created_at DESC);

-- ── Settlements table indexes ─────────────────────────────────────────────────

-- 5. Pending settlements: partial index for unsettled trades
-- Used by: settlement engine batch processing
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_settlements_pending
  ON settlements (settlement_date ASC, symbol)
  WHERE status = 'PENDING';

-- 6. Settlement lookup by order ID (for DVP matching)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_settlements_order_id
  ON settlements (buy_order_id, sell_order_id);

-- 7. Settlement history by user
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_settlements_user_history
  ON settlements (buyer_id, created_at DESC)
  INCLUDE (symbol, quantity, price, status);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_settlements_seller_history
  ON settlements (seller_id, created_at DESC)
  INCLUDE (symbol, quantity, price, status);

-- ── Positions table indexes ───────────────────────────────────────────────────

-- 8. Portfolio view: user's all positions
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_positions_user
  ON positions (user_id, symbol)
  INCLUDE (quantity, average_price, unrealized_pnl);

-- 9. Risk management: positions by symbol (for margin calculations)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_positions_symbol
  ON positions (symbol, quantity DESC)
  WHERE quantity != 0;

-- ── Notifications table indexes ───────────────────────────────────────────────

-- 10. Unread notifications: partial index for unread count badge
-- Used by: DashboardLayout unread badge, notification center
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_notifications_unread
  ON notifications (user_id, created_at DESC)
  WHERE read = false;

-- 11. All notifications by user (for notification center pagination)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_notifications_user_time
  ON notifications (user_id, created_at DESC)
  INCLUDE (type, title, read);

-- ── Push subscriptions table indexes ─────────────────────────────────────────

-- 12. Push subscriptions by user (for sending notifications)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_push_subscriptions_user
  ON push_subscriptions (user_id)
  WHERE enable_price_alerts = true OR enable_trade_fills = true OR enable_system_alerts = true;

-- 13. Push subscription by endpoint (for deduplication on subscribe)
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_push_subscriptions_endpoint
  ON push_subscriptions (endpoint);

-- ── Price alerts table indexes ────────────────────────────────────────────────

-- 14. Active price alerts by symbol (for the price polling job)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_price_alerts_active_symbol
  ON price_alerts (symbol, target_price, direction)
  WHERE triggered = false;

-- 15. User's price alerts
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_price_alerts_user
  ON price_alerts (user_id, created_at DESC);

-- ── Profiles / Users table indexes ───────────────────────────────────────────

-- 16. KYC queue: pending approvals sorted by submission time
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_profiles_kyc_pending
  ON profiles (kyc_status, created_at ASC)
  WHERE kyc_status = 'PENDING';

-- 17. Broker's clients lookup
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_profiles_broker_clients
  ON profiles (broker_id, account_type)
  WHERE broker_id IS NOT NULL;

-- ── Warehouse receipts table indexes ─────────────────────────────────────────

-- 18. Active receipts by owner
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_warehouse_receipts_owner
  ON warehouse_receipts (owner_id, created_at DESC)
  WHERE status = 'ACTIVE';

-- ── Audit log table indexes ───────────────────────────────────────────────────

-- 19. Audit log by user and time (for compliance queries)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_audit_log_user_time
  ON audit_log (user_id, created_at DESC)
  INCLUDE (action, resource_type, resource_id);

-- 20. Audit log by resource (for entity-level audit trail)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_audit_log_resource
  ON audit_log (resource_type, resource_id, created_at DESC);

-- =============================================================================
-- Table Statistics Updates
-- Update statistics on all indexed tables for optimal query planning
-- =============================================================================
ANALYZE orders;
ANALYZE settlements;
ANALYZE positions;
ANALYZE notifications;
ANALYZE push_subscriptions;
ANALYZE price_alerts;
ANALYZE profiles;
ANALYZE warehouse_receipts;

-- =============================================================================
-- Row-Level Security (RLS) Policies
-- Enable RLS on all user-data tables for defence-in-depth
-- =============================================================================

-- Enable RLS on orders
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;

-- Application role can only see its own user's orders
-- (The app sets app.current_user_id via SET LOCAL before each query)
CREATE POLICY IF NOT EXISTS orders_user_isolation ON orders
  FOR ALL
  TO app_role
  USING (user_id::text = current_setting('app.current_user_id', true))
  WITH CHECK (user_id::text = current_setting('app.current_user_id', true));

-- Admin role can see all orders
CREATE POLICY IF NOT EXISTS orders_admin_access ON orders
  FOR ALL
  TO admin_role
  USING (true);

-- Enable RLS on settlements
ALTER TABLE settlements ENABLE ROW LEVEL SECURITY;

CREATE POLICY IF NOT EXISTS settlements_user_isolation ON settlements
  FOR SELECT
  TO app_role
  USING (
    buyer_id::text = current_setting('app.current_user_id', true)
    OR seller_id::text = current_setting('app.current_user_id', true)
  );

CREATE POLICY IF NOT EXISTS settlements_admin_access ON settlements
  FOR ALL
  TO admin_role
  USING (true);

-- Enable RLS on positions
ALTER TABLE positions ENABLE ROW LEVEL SECURITY;

CREATE POLICY IF NOT EXISTS positions_user_isolation ON positions
  FOR ALL
  TO app_role
  USING (user_id::text = current_setting('app.current_user_id', true));

CREATE POLICY IF NOT EXISTS positions_admin_access ON positions
  FOR ALL
  TO admin_role
  USING (true);

-- Enable RLS on notifications
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY IF NOT EXISTS notifications_user_isolation ON notifications
  FOR ALL
  TO app_role
  USING (user_id::text = current_setting('app.current_user_id', true));

-- Enable RLS on push_subscriptions
ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY IF NOT EXISTS push_subscriptions_user_isolation ON push_subscriptions
  FOR ALL
  TO app_role
  USING (user_id::text = current_setting('app.current_user_id', true));

-- =============================================================================
-- Verify index creation
-- =============================================================================
SELECT
  schemaname,
  tablename,
  indexname,
  pg_size_pretty(pg_relation_size(indexrelid)) AS index_size
FROM pg_stat_user_indexes
WHERE schemaname = 'public'
ORDER BY tablename, indexname;
