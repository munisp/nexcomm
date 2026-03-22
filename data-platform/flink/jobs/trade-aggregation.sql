-- NEXCOM Exchange - Flink SQL Job: Trade Aggregation
-- Consumes trade events from Kafka, deduplicates, and writes to Delta Lake silver layer.

-- Source: Kafka trade events
CREATE TABLE kafka_trades (
    trade_id STRING,
    symbol STRING,
    buyer_order_id STRING,
    seller_order_id STRING,
    buyer_id STRING,
    seller_id STRING,
    price DECIMAL(18, 8),
    quantity DECIMAL(18, 8),
    total_value DECIMAL(18, 8),
    executed_at TIMESTAMP(3),
    WATERMARK FOR executed_at AS executed_at - INTERVAL '5' SECOND
) WITH (
    'connector' = 'kafka',
    'topic' = 'nexcom.trades.executed',
    'properties.bootstrap.servers' = 'kafka:9092',
    'properties.group.id' = 'flink-trade-aggregation',
    'format' = 'json',
    'scan.startup.mode' = 'latest-offset'
);

-- Sink: Delta Lake silver table
CREATE TABLE delta_trades (
    trade_id STRING,
    symbol STRING,
    buyer_order_id STRING,
    seller_order_id STRING,
    buyer_id STRING,
    seller_id STRING,
    price DECIMAL(18, 8),
    quantity DECIMAL(18, 8),
    total_value DECIMAL(18, 8),
    executed_at TIMESTAMP(3),
    trade_date DATE,
    PRIMARY KEY (trade_id) NOT ENFORCED
) WITH (
    'connector' = 'delta',
    'table-path' = 's3://nexcom-lakehouse/silver/trades',
    'sink.parallelism' = '4'
);

-- OHLCV 1-minute aggregation
CREATE TABLE ohlcv_1m (
    symbol STRING,
    window_start TIMESTAMP(3),
    window_end TIMESTAMP(3),
    open_price DECIMAL(18, 8),
    high_price DECIMAL(18, 8),
    low_price DECIMAL(18, 8),
    close_price DECIMAL(18, 8),
    volume DECIMAL(18, 8),
    trade_count BIGINT,
    vwap DECIMAL(18, 8),
    PRIMARY KEY (symbol, window_start) NOT ENFORCED
) WITH (
    'connector' = 'delta',
    'table-path' = 's3://nexcom-lakehouse/gold/ohlcv_1m',
    'sink.parallelism' = '4'
);

-- Insert deduplicated trades into silver layer
INSERT INTO delta_trades
SELECT
    trade_id,
    symbol,
    buyer_order_id,
    seller_order_id,
    buyer_id,
    seller_id,
    price,
    quantity,
    total_value,
    executed_at,
    CAST(executed_at AS DATE) AS trade_date
FROM (
    SELECT *,
        ROW_NUMBER() OVER (PARTITION BY trade_id ORDER BY executed_at DESC) AS rn
    FROM kafka_trades
) WHERE rn = 1;

-- Generate real-time OHLCV 1-minute candles
INSERT INTO ohlcv_1m
SELECT
    symbol,
    window_start,
    window_end,
    FIRST_VALUE(price) AS open_price,
    MAX(price) AS high_price,
    MIN(price) AS low_price,
    LAST_VALUE(price) AS close_price,
    SUM(quantity) AS volume,
    COUNT(*) AS trade_count,
    SUM(total_value) / SUM(quantity) AS vwap
FROM TABLE(
    TUMBLE(TABLE kafka_trades, DESCRIPTOR(executed_at), INTERVAL '1' MINUTE)
)
GROUP BY symbol, window_start, window_end;
