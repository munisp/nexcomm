-- Migration: 0079_channel_handoffs (INNOV-E)
-- Adds omnichannel handoff tokens (USSD ↔ web/PWA) and delivery milestone history.
-- Idempotent (IF NOT EXISTS / duplicate_object guards).

-- ─── Enums ────────────────────────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE handoff_channel AS ENUM ('WEB', 'USSD', 'WHATSAPP');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE delivery_milestone AS ENUM ('PICKUP_SCHEDULED', 'IN_TRANSIT', 'WAREHOUSE_ARRIVED', 'QUALITY_CHECKED', 'DELIVERED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ─── channel_handoffs ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS channel_handoffs (
  id            BIGSERIAL PRIMARY KEY,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  otp_hash      VARCHAR(64) NOT NULL,
  channel_from  handoff_channel NOT NULL,
  channel_to    handoff_channel NOT NULL,
  intent        JSONB,
  expires_at    TIMESTAMP NOT NULL,
  used_at       TIMESTAMP,
  created_at    TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS channel_handoffs_user_idx ON channel_handoffs(user_id);
CREATE INDEX IF NOT EXISTS channel_handoffs_expires_idx ON channel_handoffs(expires_at);

-- ─── delivery_milestones ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS delivery_milestones (
  id            BIGSERIAL PRIMARY KEY,
  delivery_id   INTEGER NOT NULL REFERENCES delivery_orders(id) ON DELETE CASCADE,
  milestone     delivery_milestone NOT NULL,
  note          TEXT,
  location      VARCHAR(200),
  reported_by   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  occurred_at   TIMESTAMP NOT NULL,
  created_at    TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS delivery_milestones_delivery_idx ON delivery_milestones(delivery_id);
