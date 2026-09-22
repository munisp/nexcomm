-- Migration: 0082_market_feeds (DATA-FEEDS)
-- Durable snapshot store for the pluggable external data-feed framework
-- (weather, reference prices, official statistics). Idempotent (IF NOT EXISTS).

CREATE TABLE IF NOT EXISTS market_feed_snapshots (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  feed         VARCHAR(64) NOT NULL,
  symbol       VARCHAR(64),
  region       VARCHAR(128),
  payload      JSONB NOT NULL,
  fetched_at   TIMESTAMP NOT NULL DEFAULT NOW(),
  valid_until  TIMESTAMP
);

CREATE INDEX IF NOT EXISTS market_feed_snapshots_feed_idx
  ON market_feed_snapshots(feed);

CREATE INDEX IF NOT EXISTS market_feed_snapshots_feed_symbol_fetched_idx
  ON market_feed_snapshots(feed, symbol, fetched_at DESC);
