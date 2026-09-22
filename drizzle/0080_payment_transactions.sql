-- Migration: 0080_payment_transactions (PAY-RAILS)
-- Durable records for the pluggable payment-collection-rail framework:
--   payment_transactions    — one row per collection attempt (any rail)
--   payment_webhook_events  — inbound webhook dedupe log (exactly-once processing)
-- Idempotent (IF NOT EXISTS / duplicate_object guards).

-- ─── Enums ────────────────────────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE payment_status AS ENUM ('pending', 'processing', 'success', 'failed', 'abandoned', 'refunded');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE payment_purpose AS ENUM ('deposit', 'fee', 'subscription');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ─── payment_transactions ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS payment_transactions (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key    VARCHAR(128) NOT NULL UNIQUE,
  user_id            INTEGER NOT NULL REFERENCES users(id),
  provider           VARCHAR(32) NOT NULL,
  provider_ref       VARCHAR(191) NOT NULL UNIQUE,
  amount_minor       BIGINT NOT NULL,
  currency           VARCHAR(3) NOT NULL DEFAULT 'NGN',
  channel            VARCHAR(32),
  status             payment_status NOT NULL DEFAULT 'pending',
  purpose            payment_purpose NOT NULL DEFAULT 'deposit',
  authorization_url  TEXT,
  ussd_code          VARCHAR(64),
  metadata           JSONB,
  paid_at            TIMESTAMP,
  created_at         TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS payment_transactions_user_idx ON payment_transactions(user_id);
CREATE INDEX IF NOT EXISTS payment_transactions_status_idx ON payment_transactions(status);
CREATE INDEX IF NOT EXISTS payment_transactions_provider_ref_idx ON payment_transactions(provider, provider_ref);

-- ─── payment_webhook_events ───────────────────────────────────────────────────
-- unique(provider, event_id) is the dedupe anchor: the webhook route inserts
-- first and treats a unique-violation as "already seen → 200, no reprocessing".

CREATE TABLE IF NOT EXISTS payment_webhook_events (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider     VARCHAR(32) NOT NULL,
  event_id     VARCHAR(191) NOT NULL,
  payload      JSONB,
  processed    BOOLEAN NOT NULL DEFAULT FALSE,
  processed_at TIMESTAMP,
  created_at   TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS payment_webhook_events_provider_event_unique
  ON payment_webhook_events(provider, event_id);
CREATE INDEX IF NOT EXISTS payment_webhook_events_provider_idx
  ON payment_webhook_events(provider);
