-- NEXCOM Exchange - DataFusion Query Engine
-- High-performance SQL queries on Delta Lake tables using Apache DataFusion.
-- Used for ad-hoc analytics, reporting, and API-driven queries.

-- Register Delta tables
CREATE EXTERNAL TABLE trades
STORED AS DELTA
LOCATION 's3://nexcom-lakehouse/silver/trades';

CREATE EXTERNAL TABLE market_data
STORED AS DELTA
LOCATION 's3://nexcom-lakehouse/silver/market_data';

CREATE EXTERNAL TABLE ohlcv_1d
STORED AS DELTA
LOCATION 's3://nexcom-lakehouse/gold/ohlcv_1d';

CREATE EXTERNAL TABLE daily_summary
STORED AS DELTA
LOCATION 's3://nexcom-lakehouse/gold/daily_trading_summary';

-- Top traded commodities by volume (last 30 days)
SELECT
    symbol,
    COUNT(*) AS trade_count,
    SUM(quantity) AS total_volume,
    SUM(total_value) AS total_notional,
    AVG(price) AS avg_price,
    MIN(price) AS low,
    MAX(price) AS high
FROM trades
WHERE executed_at >= NOW() - INTERVAL '30 days'
GROUP BY symbol
ORDER BY total_notional DESC;

-- Market depth analysis
SELECT
    symbol,
    trade_date,
    trade_count,
    total_volume,
    total_value,
    unique_buyers,
    unique_sellers,
    vwap,
    (high_price - low_price) / avg_price * 100 AS daily_range_pct
FROM daily_summary
WHERE trade_date >= CURRENT_DATE - INTERVAL '7 days'
ORDER BY symbol, trade_date;

-- Price correlation between commodities
SELECT
    a.symbol AS symbol_a,
    b.symbol AS symbol_b,
    CORR(a.close_price, b.close_price) AS price_correlation
FROM ohlcv_1d a
JOIN ohlcv_1d b ON a.window_start = b.window_start AND a.symbol < b.symbol
WHERE a.window_start >= NOW() - INTERVAL '90 days'
GROUP BY a.symbol, b.symbol
HAVING ABS(CORR(a.close_price, b.close_price)) > 0.5
ORDER BY ABS(price_correlation) DESC;
