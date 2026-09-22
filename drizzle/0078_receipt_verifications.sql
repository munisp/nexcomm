-- Migration: 0078_receipt_verifications (INNOV-D)
-- Public QR/code verification for warehouse-receipt digital twins.
-- Pairs with server/routers/receiptTwinRouter.ts and drizzle/schema-transparency.ts.
-- This migration is idempotent (uses IF NOT EXISTS).

-- ─── receipt_verifications ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS receipt_verifications (
  id SERIAL PRIMARY KEY,
  receipt_id INTEGER NOT NULL REFERENCES warehouse_receipts(id) ON DELETE CASCADE,
  code VARCHAR(96) NOT NULL,
  created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  expires_at TIMESTAMP,
  view_count INTEGER NOT NULL DEFAULT 0
);

CREATE UNIQUE INDEX IF NOT EXISTS receipt_verifications_code_uq ON receipt_verifications (code);
CREATE INDEX IF NOT EXISTS receipt_verifications_receipt_idx ON receipt_verifications (receipt_id);
