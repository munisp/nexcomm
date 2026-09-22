-- ============================================================================
-- scripts/check-indexes.sql — PERF-DB weekly index health report
-- Usage: psql $DATABASE_URL -f scripts/check-indexes.sql
-- Safe: read-only (pg_stats / catalogs only).
-- ============================================================================

\echo '=================================================================='
\echo '1. MISSING-INDEX CANDIDATES — big tables with heavy sequential scans'
\echo '   (seq_scans > idx_scans and table > 10k rows => investigate)'
\echo '=================================================================='
SELECT relname,
       seq_scan,
       idx_scan,
       n_live_tup                                                AS rows,
       pg_size_pretty(pg_total_relation_size(relid))             AS total_size,
       round(100.0 * seq_scan / nullif(seq_scan + idx_scan, 0), 1) AS seq_pct
FROM pg_stat_user_tables
WHERE n_live_tup > 10000
  AND seq_scan > coalesce(idx_scan, 0)
ORDER BY seq_scan DESC
LIMIT 25;

\echo ''
\echo '=================================================================='
\echo '2. INDEX SIZES — largest indexes first (watch for bloat)'
\echo '=================================================================='
SELECT schemaname,
       relname                                                    AS table_name,
       indexrelname                                               AS index_name,
       pg_size_pretty(pg_relation_size(indexrelid))               AS index_size,
       idx_scan,
       idx_tup_read,
       idx_tup_fetch
FROM pg_stat_user_indexes
ORDER BY pg_relation_size(indexrelid) DESC
LIMIT 30;

\echo ''
\echo '=================================================================='
\echo '3. UNUSED INDEXES — zero scans, not unique, not PK (drop candidates;'
\echo '   check across a full weekly cycle before dropping!)'
\echo '=================================================================='
SELECT s.schemaname,
       s.relname                                                  AS table_name,
       s.indexrelname                                             AS index_name,
       pg_size_pretty(pg_relation_size(s.indexrelid))             AS wasted_size
FROM pg_stat_user_indexes s
JOIN pg_index i ON i.indexrelid = s.indexrelid
WHERE s.idx_scan = 0
  AND NOT i.indisunique
  AND NOT i.indisprimary
  AND pg_relation_size(s.indexrelid) > 1024 * 1024  -- > 1MB only
ORDER BY pg_relation_size(s.indexrelid) DESC
LIMIT 30;

\echo ''
\echo '=================================================================='
\echo '4. MATERIALIZED VIEW FRESHNESS — data age vs the 60s staleness budget'
\echo '   (needs pg_stat_statements off; uses the refreshed_at column exposed'
\echo '    by migration 0081 MVs)'
\echo '=================================================================='
SELECT 'mv_market_summary_24h' AS mv,
       count(*) AS rows,
       max(refreshed_at) AS refreshed_at,
       round(EXTRACT(EPOCH FROM (now() - max(refreshed_at)))::numeric, 0) AS age_seconds
FROM mv_market_summary_24h
UNION ALL
SELECT 'mv_trader_portfolio_summary',
       count(*),
       max(refreshed_at),
       round(EXTRACT(EPOCH FROM (now() - max(refreshed_at)))::numeric, 0)
FROM mv_trader_portfolio_summary;

\echo ''
\echo '=================================================================='
\echo '5. MV LAST REFRESH (pg_catalog) — confirms the refresh job is running'
\echo '=================================================================='
SELECT matviewname, ispopulated
FROM pg_matviews
WHERE matviewname LIKE 'mv_%'
ORDER BY matviewname;

\echo ''
\echo '=================================================================='
\echo '6. TABLE BLOAT WATCH — dead tuple ratio on hot tables'
\echo '=================================================================='
SELECT relname,
       n_live_tup,
       n_dead_tup,
       round(100.0 * n_dead_tup / nullif(n_live_tup, 0), 1) AS dead_pct,
       last_autovacuum,
       last_autoanalyze
FROM pg_stat_user_tables
WHERE relname IN ('orders', 'trade_fills', 'notifications', 'positions',
                  'deposit_requests', 'bank_transactions', 'offline_operations')
ORDER BY n_dead_tup DESC;

\echo ''
\echo 'Done. Escalate: any §1 row on a hot-path table, §4 age > 300s, or §6 dead_pct > 20.'
