# PERF-DB — Query Performance & Indexing Guide

Delivered by migration `drizzle/0081_performance_indexes.sql` (28 indexes, 2 materialized views) and `server/jobs/refreshMaterializedViewsJob.ts`.

## 1. Index rationale (query → index → expected latency)

Baseline indexes from `0049_production_indexes` are not repeated. All latencies assume a warmed buffer cache and table sizes of 10⁵–10⁷ rows.

| Hot query (router) | Table / access pattern | Index (0081) | Before | Expected |
|---|---|---|---|---|
| `bankingRouter.getAccounts` | `bank_accounts WHERE user_id = ?` (no prior index) | `idx_bank_accounts_user_id` | seq scan, 50–500ms | <1ms |
| `bankingRouter` withdraw/deposit | `bank_accounts WHERE id = ? AND user_id = ? AND status = 'ACTIVE'` | `idx_bank_accounts_user_status` | seq scan | <1ms |
| `depositsRouter.list` | `deposit_requests WHERE user_id = ? ORDER BY created_at DESC` | `idx_deposit_requests_user_created` | seq scan + sort | <2ms |
| Warehouse intake ops queue | `deposit_requests WHERE status IN ('PENDING','RECEIVED','GRADED')` | `idx_deposit_requests_status_inflight` (partial) | seq scan | <2ms |
| `withdrawalVerificationRouter` challenge | `withdrawal_verifications WHERE user_id = ? AND status = 'PENDING'` | `idx_withdrawal_verifications_user_status` | seq scan | <1ms |
| Withdrawal challenge expiry sweep | `... WHERE status='PENDING' AND expires_at < now()` | `idx_withdrawal_verifications_expires_pending` (partial) | full table sweep | <2ms |
| `stripeRouter.list` | `stripe_payments WHERE user_id = ? ORDER BY created_at DESC` | `idx_stripe_payments_user_created` | seq scan + sort | <2ms |
| `apiKeysRouter.list` | `api_keys WHERE user_id = ?` | `idx_api_keys_user_id` | seq scan | <1ms |
| `orders.listFills` / `exportFillsCsv` / profile trade history | `trade_fills WHERE buyer_user_id = ? OR seller_user_id = ? ORDER BY created_at DESC` | `idx_trade_fills_buyer_created` + `idx_trade_fills_seller_created` (bitmap OR) | seq scan + sort, 100ms–2s | <5ms |
| Order detail → fills | `trade_fills WHERE aggressor_order_id = ?` / `resting_order_id = ?` | `idx_trade_fills_aggressor_order`, `idx_trade_fills_resting_order` | seq scan | <1ms |
| Settlement reconciliation | `trade_fills WHERE settlement_id = ?` | `idx_trade_fills_settlement_id` (partial) | seq scan | <2ms |
| `orders.list` (status-filtered history) | `orders WHERE user_id = ? AND status = ? ORDER BY created_at DESC` | `idx_orders_user_status_created` | 2 indexes + sort | <3ms |
| Matching engine book rebuild | `orders WHERE symbol = ? AND side = ? AND status IN ('OPEN','PARTIALLY_FILLED')` | `idx_orders_open_book` (partial) | filter over all statuses | <2ms |
| Order amendment history | `order_amendments WHERE order_id = ?` / `user_id = ?` | `idx_order_amendments_order_id`, `idx_order_amendments_user_id` | seq scan | <1ms |
| `watchlist.get/add/remove` | `watchlist WHERE user_id = ? AND symbol = ?` | `idx_watchlist_user_symbol` | seq scan | <1ms |
| Saved order templates | `saved_orders WHERE user_id = ?` | `idx_saved_orders_user_id` | seq scan | <1ms |
| Logout-all / session admin | `refresh_tokens WHERE user_id = ?` | `idx_refresh_tokens_user_id` | seq scan | <1ms |
| Refresh-token reuse detection | `refresh_tokens WHERE family = ?` | `idx_refresh_tokens_family` | seq scan | <1ms |
| Notification unread badge | `notifications WHERE user_id = ? AND read = false ORDER BY created_at DESC` | `idx_notifications_user_unread` (partial) | filter over all read rows | <2ms |
| Compliance KYC queue | `kyc_queue WHERE status = ? ORDER BY submitted_at` | `idx_kyc_queue_status_submitted` | sort of status filter | <2ms |
| `deliveryRouter.list` | `delivery_orders WHERE user_id = ?` | `idx_delivery_orders_user_id` | seq scan | <1ms |
| Logistics ops board | `delivery_orders WHERE status IN ('PENDING','SCHEDULED','IN_TRANSIT')` | `idx_delivery_orders_status_active` (partial) | seq scan | <2ms |
| `channelBridgeRouter.redeem` | `channel_handoffs WHERE user_id = ? AND otp_hash = ? AND used_at IS NULL` | `idx_channel_handoffs_user_otp_active` (partial) | scan of all user tokens | <1ms |
| `offlineSync.submitQueued` replay | `offline_operations WHERE user_id = ? AND status = 'queued'` | `idx_offline_operations_user_status` | two single-col scans | <2ms |
| `marketStream.tickerSnapshot` (dashboard) | 24h `GROUP BY symbol` over `trade_fills` per request | **MV `mv_market_summary_24h`** (60s refresh) | 50–500ms aggregate scan | <2ms |
| Portfolio dashboard cards | `positions ⋈ live_prices GROUP BY user_id` per request | **MV `mv_trader_portfolio_summary`** (60s refresh) | join + aggregate per load | <2ms |

Already covered by 0049 (verified, not duplicated): `orders(symbol,status)`, `orders(user_id,created_at DESC)`, `trade_fills(symbol,created_at DESC)`, `live_prices(symbol)` UNIQUE, `notifications(user_id,created_at DESC)`, `warehouse_receipts(user_id,status)`, `crop_listings(commodity,status)`, `positions(user_id,symbol)` UNIQUE, `kyc_queue(user_id)`, `kyb_applications(status)`, `audit_log(created_at)`, `settlements(user_id,status)`.

## 2. EXPLAIN (ANALYZE, BUFFERS) how-to

Verify any query above before/after the migration:

```sql
-- 1. Grab the exact SQL from the app logs (or pg_stat_statements, see §3).
-- 2. Run with buffers to see cache vs disk hits:
EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT * FROM trade_fills
WHERE (buyer_user_id = 42 OR seller_user_id = 42)
ORDER BY created_at DESC LIMIT 50;

-- What "good" looks like:
--   Bitmap Heap Scan on trade_fills ... (actual time=0.05..0.4 rows=50)
--     Recheck Cond: ((buyer_user_id = 42) OR (seller_user_id = 42))
--     Buffers: shared hit=12            <- all cache hits, no read=
-- "Bad" signs: Seq Scan on big tables, rows removed by filter >> rows,
--              Buffers: read= (disk) dominating, Sort Method: external.
```

Rules of thumb: hot-path queries should show an Index Scan / Bitmap Scan with `shared hit` buffers and total actual time < 10ms. A query reading > ~1000 buffers for a <100-row result needs a better index.

## 3. pg_stat_statements setup (find the real top-N slow queries)

```sql
-- postgresql.conf: shared_preload_libraries = 'pg_stat_statements'
--   pg_stat_statements.track = all
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;

-- Top 20 by total time — optimize these first:
SELECT calls,
       round(total_exec_time::numeric, 1)        AS total_ms,
       round(mean_exec_time::numeric, 2)         AS mean_ms,
       round((100.0 * total_exec_time / sum(total_exec_time) OVER ())::numeric, 1) AS pct,
       left(regexp_replace(query, '\s+', ' ', 'g'), 120) AS query
FROM pg_stat_statements
ORDER BY total_exec_time DESC
LIMIT 20;

-- Reset after a deploy to measure the new baseline:
SELECT pg_stat_statements_reset();
```

## 4. Materialized view refresh strategy

| MV | Source | Refresh | Staleness budget |
|---|---|---|---|
| `mv_market_summary_24h` | `trade_fills` (24h window) | `REFRESH ... CONCURRENTLY` every 60s (`MV_REFRESH_SECONDS`) by `server/jobs/refreshMaterializedViewsJob.ts` | ≤ 60s + refresh duration |
| `mv_trader_portfolio_summary` | `positions ⋈ live_prices` | same job | ≤ 60s |

* CONCURRENT refresh requires a UNIQUE index on the MV (`mv_market_summary_24h_symbol_uq`, `mv_trader_portfolio_summary_user_uq`) and that the MV has been refreshed at least once non-concurrently. The job falls back to plain `REFRESH` (blocking writes only) if CONCURRENTLY fails, and logs it once.
* Both MVs are small (one row per symbol / per user) — refresh cost is the underlying aggregate scan, bounded by the 24h window and by `idx_trade_fills_created_at`.
* Consumers should read the MV for dashboards and fall back to live tables only for trade-critical paths. `refreshed_at` is exposed on each MV so the UI can display data age.
* If refresh ever needs to be on-demand (e.g. after a bulk import): `REFRESH MATERIALIZED VIEW CONCURRENTLY mv_market_summary_24h;`

## 5. Bloat / vacuum notes

`orders` and `trade_fills` are high-churn (status updates / inserts every trade). Default autovacuum is too lax at exchange volumes:

```sql
-- Run once (DDL, outside the migration so it is explicit in ops review):
ALTER TABLE orders      SET (autovacuum_vacuum_scale_factor = 0.05,
                             autovacuum_analyze_scale_factor = 0.02);
ALTER TABLE trade_fills SET (autovacuum_vacuum_scale_factor = 0.05,
                             autovacuum_analyze_scale_factor = 0.02);
ALTER TABLE notifications SET (autovacuum_vacuum_scale_factor = 0.05);

-- Watch bloat:
SELECT relname, n_dead_tup, n_live_tup,
       round(100.0 * n_dead_tup / nullif(n_live_tup, 0), 1) AS dead_pct,
       last_autovacuum, last_autoanalyze
FROM pg_stat_user_tables
WHERE relname IN ('orders', 'trade_fills', 'notifications', 'positions');
```

* Dead-tuple ratio consistently > 20% → autovacuum is not keeping up: lower scale factors further or increase `autovacuum_vacuum_cost_limit`.
* Partial indexes (`WHERE status IN (...)`, `WHERE read = false`) shrink dramatically after vacuuming removes dead terminal-state rows.
* `REINDEX INDEX CONCURRENTLY idx_...` quarterly on the hottest indexes if `pg_stat_user_indexes.idx_scan` is high and index size grows without row growth.

## 6. Connection-count guidance

* App pool: `server/db.ts` uses `postgres` with `max: 20` per Node process. With N app replicas the worst case is `20 × N` connections to the primary.
* Keep `max_connections` (Postgres) ≥ `20 × N + 20` headroom for migrations, jobs (MV refresh uses one pooled connection briefly), psql admin, and monitoring.
* Above ~4 replicas / ~100 concurrent connections, put PgBouncer in **transaction** pooling mode in front of Postgres and point `DATABASE_URL` at it. Note: `REFRESH MATERIALIZED VIEW` and drizzle migrations must go to the **primary direct** connection, not through transaction pooling (they hold locks across statements).
* `idle_timeout: 30` + `max_lifetime: 1800` (already set) recycle connections — do not raise `max` before checking `pg_stat_activity` for idle-in-transaction leaks:

```sql
SELECT state, count(*) FROM pg_stat_activity
WHERE datname = current_database() GROUP BY state ORDER BY 2 DESC;
```

## 7. Operational checks

Run `scripts/check-indexes.sql` weekly (and after every migration) — it reports seq-scan-heavy tables missing indexes, index sizes, unused indexes, and MV freshness.
