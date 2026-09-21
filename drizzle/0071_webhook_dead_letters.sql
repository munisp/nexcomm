-- Migration: 0071_webhook_dead_letters (renumbered from 0065_webhook_dead_letters during integration merge)
-- Dead-letter log for outbound webhook deliveries that exhausted retries.
-- Pairs with the retry loop (3 attempts, exponential backoff) added to
-- server/routers/webhookRouter.ts dispatchSecurityEventWebhooks.

CREATE TABLE IF NOT EXISTS webhook_dead_letters (
  id SERIAL PRIMARY KEY,
  webhook_config_id INTEGER,
  url VARCHAR(2048) NOT NULL,
  event VARCHAR(64) NOT NULL,
  payload TEXT NOT NULL,
  attempts INTEGER NOT NULL,
  last_status_code INTEGER,
  last_error TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS webhook_dead_letters_config_idx
  ON webhook_dead_letters (webhook_config_id);
