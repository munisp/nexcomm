-- ============================================================================
-- Migration 0081: Performance indexes + dashboard materialized views (PERF-DB)
-- ============================================================================
-- Goal: every hot-path query < 10ms. This migration is PURELY ADDITIVE:
--   * CREATE INDEX IF NOT EXISTS only (no CONCURRENTLY — drizzle migrations
--     run inside a transaction, where CONCURRENTLY is illegal).
--   * No table rewrites, no ALTER COLUMN TYPE, idempotent (safe to re-run).
--
-- Coverage notes (verified against drizzle/schema.ts + server/routers/*):
--   * orders/trade_fills/notifications/warehouse_receipts/crop_listings/
--     positions/kyc_queue/kyb_applications already have baseline single- and
--     two-column indexes from 0049_production_indexes; this migration only
--     adds the missing composites, partials, and the tables 0049 never touched
--     (bank_accounts, deposit_requests, withdrawal_verifications,
--     stripe_payments, api_keys, order_amendments, watchlist, saved_orders,
--     refresh_tokens, delivery_orders).
--   * "escrow accounts" in this exchange = bank_accounts (type='ESCROW').
--   * trade_fills real columns are buyer_user_id / seller_user_id /
--     aggressor_order_id / resting_order_id (see 0022/0064 DDL); the 0049
--     indexes on trade_fills(user_id)/(order_id) referenced columns that do
--     not exist and would have failed — the correct indexes are created here.
-- ============================================================================

-- ─── BANKING / ESCROW ────────────────────────────────────────────────────────
-- Target: bankingRouter.getAccounts — SELECT ... FROM bank_accounts WHERE user_id = ?
-- (called on every banking dashboard load; table had NO indexes at all).
CREATE INDEX IF NOT EXISTS idx_bank_accounts_user_id ON bank_accounts(user_id);
--> statement-breakpoint
-- Target: bankingRouter account ops — WHERE id = ? AND user_id = ? AND status = 'ACTIVE'
-- (withdrawals/deposits validate account ownership + ACTIVE status per request).
CREATE INDEX IF NOT EXISTS idx_bank_accounts_user_status ON bank_accounts(user_id, status);
--> statement-breakpoint

-- ─── DEPOSIT REQUESTS (warehouse commodity deposits) ─────────────────────────
-- Target: depositsRouter.list / onboarding / searchRouter — WHERE user_id = ?
-- ORDER BY created_at DESC LIMIT n (per-user deposit history, hot on portal).
CREATE INDEX IF NOT EXISTS idx_deposit_requests_user_created ON deposit_requests(user_id, created_at DESC);
--> statement-breakpoint
-- Target: warehouse ops intake queue — status scans for in-flight deposits.
-- Partial: terminal states (STORED/REJECTED) dominate the table over time.
CREATE INDEX IF NOT EXISTS idx_deposit_requests_status_inflight ON deposit_requests(status) WHERE status IN ('PENDING', 'RECEIVED', 'GRADED');
--> statement-breakpoint

-- ─── WITHDRAWAL VERIFICATIONS ────────────────────────────────────────────────
-- Target: withdrawalVerificationRouter.submitAnswer/status — WHERE user_id = ?
-- AND status = 'PENDING' (challenge lookup on every withdrawal attempt).
CREATE INDEX IF NOT EXISTS idx_withdrawal_verifications_user_status ON withdrawal_verifications(user_id, status);
--> statement-breakpoint
-- Target: expiry sweep — find PENDING challenges past expires_at. Partial so
-- the sweep index stays tiny (only live challenges are indexed).
CREATE INDEX IF NOT EXISTS idx_withdrawal_verifications_expires_pending ON withdrawal_verifications(expires_at) WHERE status = 'PENDING';
--> statement-breakpoint

-- ─── STRIPE PAYMENTS (fiat on/off-ramp) ──────────────────────────────────────
-- Target: stripeRouter.list — WHERE user_id = ? ORDER BY created_at DESC.
-- (Webhook lookups by stripe_payment_intent_id / checkout_session_id are
-- already served by their UNIQUE constraints.)
CREATE INDEX IF NOT EXISTS idx_stripe_payments_user_created ON stripe_payments(user_id, created_at DESC);
--> statement-breakpoint

-- ─── API KEYS ────────────────────────────────────────────────────────────────
-- Target: apiKeysRouter.list — WHERE user_id = ? (developer settings page).
CREATE INDEX IF NOT EXISTS idx_api_keys_user_id ON api_keys(user_id);
--> statement-breakpoint

-- ─── TRADE FILLS (matching engine output) ────────────────────────────────────
-- Target: orders.listFills / exportFillsCsv / profile trade history —
-- WHERE (buyer_user_id = ? OR seller_user_id = ?) ORDER BY created_at DESC.
-- Two indexes so the OR can bitmap-union two index scans instead of seq scan.
CREATE INDEX IF NOT EXISTS idx_trade_fills_buyer_created ON trade_fills(buyer_user_id, created_at DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_trade_fills_seller_created ON trade_fills(seller_user_id, created_at DESC);
--> statement-breakpoint
-- Target: order-detail fill lookup — WHERE aggressor_order_id = ? / resting_order_id = ?
CREATE INDEX IF NOT EXISTS idx_trade_fills_aggressor_order ON trade_fills(aggressor_order_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_trade_fills_resting_order ON trade_fills(resting_order_id);
--> statement-breakpoint
-- Target: settlement reconciliation — WHERE settlement_id = ?. Partial: most
-- recent fills are unsettled (NULL) and never probed by settlement_id.
CREATE INDEX IF NOT EXISTS idx_trade_fills_settlement_id ON trade_fills(settlement_id) WHERE settlement_id IS NOT NULL;
--> statement-breakpoint
-- (idx_trade_fills_symbol_created from 0049 already covers the
-- marketStream.recentTrades pattern: WHERE symbol = ? ORDER BY created_at DESC.)

-- ─── ORDERS ──────────────────────────────────────────────────────────────────
-- Target: orders.list with status filter — WHERE user_id = ? AND status = ?
-- ORDER BY created_at DESC (single index serves equality + sort, no sort node).
CREATE INDEX IF NOT EXISTS idx_orders_user_status_created ON orders(user_id, status, created_at DESC);
--> statement-breakpoint
-- Target: matching engine / order-book rebuild — live orders per symbol+side.
-- Partial: FILLED/CANCELLED/EXPIRED rows (the vast majority over time) are
-- excluded, keeping the book index small and cache-resident.
CREATE INDEX IF NOT EXISTS idx_orders_open_book ON orders(symbol, side, created_at) WHERE status IN ('OPEN', 'PARTIALLY_FILLED');
--> statement-breakpoint

-- ─── ORDER AMENDMENTS (audit trail) ──────────────────────────────────────────
-- Target: order detail "amendment history" — WHERE order_id = ?.
CREATE INDEX IF NOT EXISTS idx_order_amendments_order_id ON order_amendments(order_id);
--> statement-breakpoint
-- Target: compliance/user activity reports — WHERE user_id = ?.
CREATE INDEX IF NOT EXISTS idx_order_amendments_user_id ON order_amendments(user_id);
--> statement-breakpoint

-- ─── WATCHLIST / SAVED ORDERS ────────────────────────────────────────────────
-- Target: watchlist.get/add/remove — WHERE user_id = ? AND symbol = ?
-- (fires on every market page load; table had no indexes).
CREATE INDEX IF NOT EXISTS idx_watchlist_user_symbol ON watchlist(user_id, symbol);
--> statement-breakpoint
-- Target: saved order templates list — WHERE user_id = ?.
CREATE INDEX IF NOT EXISTS idx_saved_orders_user_id ON saved_orders(user_id);
--> statement-breakpoint

-- ─── REFRESH TOKENS (auth hot path) ──────────────────────────────────────────
-- Target: logout-all / session admin — WHERE user_id = ?.
-- (Per-request token lookup by token_hash is already served by its UNIQUE constraint.)
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user_id ON refresh_tokens(user_id);
--> statement-breakpoint
-- Target: refresh-token reuse detection — WHERE family = ? (revokes whole
-- family on suspected token theft).
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_family ON refresh_tokens(family);
--> statement-breakpoint

-- ─── NOTIFICATIONS ───────────────────────────────────────────────────────────
-- Target: notificationsRouter unread inbox + unread badge count —
-- WHERE user_id = ? AND read = false ORDER BY created_at DESC. Partial: read
-- rows (the long tail) are excluded; badge query becomes a tiny index scan.
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread ON notifications(user_id, created_at DESC) WHERE read = false;
--> statement-breakpoint

-- ─── KYC QUEUE ───────────────────────────────────────────────────────────────
-- Target: compliance ops queue — WHERE status = 'PENDING' ORDER BY submitted_at
-- (cooperative.ts filters inArray(status, ['PENDING','UNDER_REVIEW'])).
CREATE INDEX IF NOT EXISTS idx_kyc_queue_status_submitted ON kyc_queue(status, submitted_at);
--> statement-breakpoint

-- ─── DELIVERY ORDERS (logistics) ─────────────────────────────────────────────
-- Target: deliveryRouter.list — WHERE user_id = ? (my deliveries page).
CREATE INDEX IF NOT EXISTS idx_delivery_orders_user_id ON delivery_orders(user_id);
--> statement-breakpoint
-- Target: logistics ops board — active deliveries by status. Partial excludes
-- DELIVERED/CANCELLED history.
CREATE INDEX IF NOT EXISTS idx_delivery_orders_status_active ON delivery_orders(status) WHERE status IN ('PENDING', 'SCHEDULED', 'IN_TRANSIT');
--> statement-breakpoint

-- ─── CHANNEL HANDOFFS (INNOV-E) ──────────────────────────────────────────────
-- Target: channelBridgeRouter.redeem — WHERE user_id = ? AND otp_hash = ?
-- AND used_at IS NULL AND expires_at > now(). Partial on live tokens only.
CREATE INDEX IF NOT EXISTS idx_channel_handoffs_user_otp_active ON channel_handoffs(user_id, otp_hash) WHERE used_at IS NULL;
--> statement-breakpoint

-- ─── OFFLINE OPERATIONS (INNOV-C) ────────────────────────────────────────────
-- Target: offlineSync.submitQueued replay sweep — queued ops per user.
-- (idempotency_key unique + user/status single-col indexes exist from 0077.)
CREATE INDEX IF NOT EXISTS idx_offline_operations_user_status ON offline_operations(user_id, status);
--> statement-breakpoint

-- ─── AUDIT LOG ───────────────────────────────────────────────────────────────
-- Target: compliance "all actions by user X over time" reports —
-- WHERE user_id = ? ORDER BY created_at DESC. audit_log is one of the largest
-- tables and only had single-column indexes (0049); this composite removes the
-- filter+sort over a user's full history.
CREATE INDEX IF NOT EXISTS idx_audit_log_user_created ON audit_log(user_id, created_at DESC);
--> statement-breakpoint

-- ============================================================================
-- MATERIALIZED VIEWS (dashboard / analytics aggregations)
-- ============================================================================
-- Guarded with DO blocks: if a base table name ever diverges, the migration
-- logs a NOTICE instead of hard-failing (table names verified: trade_fills,
-- positions, live_prices — all present in drizzle/schema.ts).

-- mv_market_summary_24h — per-symbol 24h OHLC + volume + trade count.
-- Replaces the per-request 24h GROUP BY over trade_fills in
-- marketStreamRouter.tickerSnapshot / marketAssistantRouter (full 24h window
-- scan per dashboard load → single-row MV lookup).
DO $$
BEGIN
  EXECUTE '
    CREATE MATERIALIZED VIEW IF NOT EXISTS mv_market_summary_24h AS
    SELECT
      symbol,
      (array_agg(fill_price ORDER BY created_at DESC))[1] AS last_price,
      (array_agg(fill_price ORDER BY created_at ASC))[1]  AS open_price_24h,
      max(fill_price)  AS high_24h,
      min(fill_price)  AS low_24h,
      sum(filled_qty)  AS volume_24h,
      sum(gross_value) AS turnover_24h,
      count(*)         AS trade_count_24h,
      max(created_at)  AS last_trade_at,
      now()            AS refreshed_at
    FROM trade_fills
    WHERE created_at >= now() - interval ''24 hours''
    GROUP BY symbol
  ';
EXCEPTION
  WHEN undefined_table THEN
    RAISE NOTICE 'mv_market_summary_24h skipped: base table trade_fills not found';
END $$;
--> statement-breakpoint
-- UNIQUE index on the MV key enables REFRESH MATERIALIZED VIEW CONCURRENTLY.
DO $$
BEGIN
  EXECUTE 'CREATE UNIQUE INDEX IF NOT EXISTS mv_market_summary_24h_symbol_uq ON mv_market_summary_24h(symbol)';
EXCEPTION
  WHEN undefined_table THEN
    RAISE NOTICE 'mv_market_summary_24h_symbol_uq skipped: MV not found';
END $$;
--> statement-breakpoint

-- mv_trader_portfolio_summary — per-user holdings rollup (position count,
-- cost basis, realized PnL, mark-to-market value via live_prices).
-- Serves portfolio dashboard cards without a positions x live_prices join
-- per page load.
DO $$
BEGIN
  EXECUTE '
    CREATE MATERIALIZED VIEW IF NOT EXISTS mv_trader_portfolio_summary AS
    SELECT
      p.user_id,
      count(*)                       AS position_count,
      sum(p.quantity)                AS total_quantity,
      sum(p.quantity * p.avg_cost)   AS cost_basis,
      sum(p.realized_pnl)            AS realized_pnl,
      sum(p.quantity * COALESCE(lp.price, p.avg_cost)) AS market_value,
      max(p.updated_at)              AS last_position_update,
      now()                          AS refreshed_at
    FROM positions p
    LEFT JOIN live_prices lp ON lp.symbol = p.symbol
    GROUP BY p.user_id
  ';
EXCEPTION
  WHEN undefined_table THEN
    RAISE NOTICE 'mv_trader_portfolio_summary skipped: base table positions/live_prices not found';
END $$;
--> statement-breakpoint
DO $$
BEGIN
  EXECUTE 'CREATE UNIQUE INDEX IF NOT EXISTS mv_trader_portfolio_summary_user_uq ON mv_trader_portfolio_summary(user_id)';
EXCEPTION
  WHEN undefined_table THEN
    RAISE NOTICE 'mv_trader_portfolio_summary_user_uq skipped: MV not found';
END $$;
