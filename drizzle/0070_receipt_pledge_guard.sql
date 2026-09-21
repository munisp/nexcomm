-- Migration: 0070_receipt_pledge_guard (renumbered from 0064_receipt_pledge_guard during integration merge)
-- Prevents warehouse-receipt double-pledging at the database level.
--
-- Application-level fix (server/routers/receipts.ts): pledge/redeem now use
-- conditional UPDATEs (WHERE status='ACTIVE' / <>'REDEEMED') inside a
-- transaction with a row-count check, closing the check-then-act race.
--
-- This migration adds belt-and-braces: at most one ACTIVE collateral item may
-- reference a given warehouse receipt, so even a future code path that inserts
-- collateral directly cannot create a second active pledge for the same receipt.

CREATE UNIQUE INDEX IF NOT EXISTS collateral_items_one_active_pledge_per_receipt
  ON collateral_items (reference_id)
  WHERE collateral_type = 'WAREHOUSE_RECEIPT' AND status = 'ACTIVE';
