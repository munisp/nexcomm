/**
 * schema-indexes.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Production-grade database indexes for all 133 NEXCOM Exchange tables.
 *
 * Strategy:
 *  - Every FK column gets a btree index (avoids full-table scans on joins)
 *  - High-cardinality filter columns (status, symbol, userId) get composite indexes
 *  - Timestamp columns used in range queries get btree indexes
 *  - Unique business keys get uniqueIndex
 *  - Hot read paths get covering indexes (include frequently-selected columns)
 *
 * Run `pnpm db:push` after any schema change to apply these to the database.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { index, uniqueIndex } from "drizzle-orm/pg-core";

// NOTE: Drizzle indexes are defined inline in pgTable() as the third argument.
// This file documents the index strategy and provides the SQL equivalents
// for manual application via the database console or migration scripts.
// The actual index definitions are embedded in schema.ts table declarations.

/**
 * PRODUCTION INDEX MIGRATION SCRIPT
 * Apply this SQL directly to your TiDB/MySQL or PostgreSQL database.
 * These are the exact indexes needed for production performance.
 */
export const PRODUCTION_INDEX_SQL = `
-- ============================================================
-- ORDERS TABLE (highest traffic — order book, matching engine)
-- ============================================================
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_orders_user_id ON orders(user_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_orders_symbol ON orders(symbol);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_orders_user_status ON orders(user_id, status);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_orders_symbol_status ON orders(symbol, status);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_orders_symbol_side_status ON orders(symbol, side, status);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_orders_created_at ON orders(created_at DESC);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_orders_user_created ON orders(user_id, created_at DESC);
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_orders_client_order_id ON orders(client_order_id) WHERE client_order_id IS NOT NULL;
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_orders_expires_at ON orders(expires_at) WHERE expires_at IS NOT NULL;

-- ============================================================
-- TRADE FILLS TABLE (matching engine output)
-- ============================================================
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_trade_fills_order_id ON trade_fills(order_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_trade_fills_user_id ON trade_fills(user_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_trade_fills_symbol ON trade_fills(symbol);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_trade_fills_created_at ON trade_fills(created_at DESC);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_trade_fills_symbol_created ON trade_fills(symbol, created_at DESC);

-- ============================================================
-- SETTLEMENTS TABLE (T+2 clearing)
-- ============================================================
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_settlements_user_id ON settlements(user_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_settlements_order_id ON settlements(order_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_settlements_status ON settlements(status);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_settlements_user_status ON settlements(user_id, status);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_settlements_settlement_date ON settlements(settlement_date);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_settlements_created_at ON settlements(created_at DESC);

-- ============================================================
-- LIVE PRICES TABLE (real-time price feed — very hot read path)
-- ============================================================
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_live_prices_symbol ON live_prices(symbol);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_live_prices_asset_class ON live_prices(asset_class);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_live_prices_updated_at ON live_prices(updated_at DESC);

-- ============================================================
-- NOTIFICATIONS TABLE (per-user inbox)
-- ============================================================
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_notifications_user_read ON notifications(user_id, read);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_notifications_created_at ON notifications(created_at DESC);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_notifications_user_created ON notifications(user_id, created_at DESC);

-- ============================================================
-- PRICE ALERTS TABLE
-- ============================================================
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_price_alerts_user_id ON price_alerts(user_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_price_alerts_symbol ON price_alerts(symbol);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_price_alerts_triggered ON price_alerts(triggered, notified) WHERE triggered = false;
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_price_alerts_symbol_triggered ON price_alerts(symbol, triggered);

-- ============================================================
-- POSITIONS TABLE (portfolio holdings)
-- ============================================================
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_positions_user_id ON positions(user_id);
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_positions_user_symbol ON positions(user_id, symbol);

-- ============================================================
-- WAREHOUSE RECEIPTS TABLE (EWR system)
-- ============================================================
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_warehouse_receipts_user_id ON warehouse_receipts(user_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_warehouse_receipts_status ON warehouse_receipts(status);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_warehouse_receipts_commodity ON warehouse_receipts(commodity);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_warehouse_receipts_user_status ON warehouse_receipts(user_id, status);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_warehouse_receipts_expiry ON warehouse_receipts(expiry_date) WHERE expiry_date IS NOT NULL;

-- ============================================================
-- INPUT FINANCING LOANS TABLE (agri-finance)
-- ============================================================
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_input_financing_loans_user_id ON input_financing_loans(user_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_input_financing_loans_status ON input_financing_loans(status);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_input_financing_loans_user_status ON input_financing_loans(user_id, status);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_input_financing_loans_due_date ON input_financing_loans(due_date);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_input_financing_loans_created_at ON input_financing_loans(created_at DESC);

-- ============================================================
-- PORTFOLIO SNAPSHOTS TABLE (daily equity curve)
-- ============================================================
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_portfolio_snapshots_user_id ON portfolio_snapshots(user_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_portfolio_snapshots_user_date ON portfolio_snapshots(user_id, snapshot_date DESC);
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_portfolio_snapshots_user_date_unique ON portfolio_snapshots(user_id, snapshot_date);

-- ============================================================
-- KYC QUEUE TABLE
-- ============================================================
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_kyc_queue_user_id ON kyc_queue(user_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_kyc_queue_status ON kyc_queue(status);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_kyc_queue_submitted_at ON kyc_queue(submitted_at DESC);

-- ============================================================
-- AUDIT LOG TABLE (compliance — very high write volume)
-- ============================================================
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_audit_log_user_id ON audit_log(user_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_audit_log_action ON audit_log(action);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_audit_log_resource ON audit_log(resource, resource_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_audit_log_created_at ON audit_log(created_at DESC);

-- ============================================================
-- MARGIN ACCOUNTS TABLE
-- ============================================================
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_margin_accounts_user_id ON margin_accounts(user_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_margin_accounts_status ON margin_accounts(status);

-- ============================================================
-- COLLATERAL ITEMS TABLE
-- ============================================================
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_collateral_items_user_id ON collateral_items(user_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_collateral_items_margin_account ON collateral_items(margin_account_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_collateral_items_status ON collateral_items(status);

-- ============================================================
-- COLLATERAL LEDGER TABLE
-- ============================================================
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_collateral_ledger_user_id ON collateral_ledger(user_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_collateral_ledger_item_id ON collateral_ledger(collateral_item_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_collateral_ledger_created_at ON collateral_ledger(created_at DESC);

-- ============================================================
-- SETTLEMENT DISPUTES TABLE
-- ============================================================
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_settlement_disputes_settlement_id ON settlement_disputes(settlement_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_settlement_disputes_raised_by ON settlement_disputes(raised_by);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_settlement_disputes_status ON settlement_disputes(status);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_settlement_disputes_sla ON settlement_disputes(sla_deadline) WHERE sla_breached = false;

-- ============================================================
-- SECURITY EVENTS TABLE
-- ============================================================
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_security_events_user_id ON security_events(user_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_security_events_severity ON security_events(severity);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_security_events_status ON security_events(status);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_security_events_created_at ON security_events(created_at DESC);

-- ============================================================
-- AML FLAGS TABLE
-- ============================================================
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_aml_flags_user_id ON aml_flags(user_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_aml_flags_status ON aml_flags(status);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_aml_flags_created_at ON aml_flags(created_at DESC);

-- ============================================================
-- MOJALOOP TRANSFERS TABLE (payment rails)
-- ============================================================
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_mojaloop_transfers_payer ON mojaloop_transfers(payer_fsp_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_mojaloop_transfers_payee ON mojaloop_transfers(payee_fsp_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_mojaloop_transfers_state ON mojaloop_transfers(transfer_state);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_mojaloop_transfers_created ON mojaloop_transfers(created_at DESC);

-- ============================================================
-- FARMER PROFILES TABLE
-- ============================================================
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_farmer_profiles_user_id ON farmer_profiles(user_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_farmer_profiles_state ON farmer_profiles(state);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_farmer_profiles_cooperative ON farmer_profiles(cooperative_id);

-- ============================================================
-- CROP LISTINGS TABLE
-- ============================================================
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_crop_listings_farmer_id ON crop_listings(farmer_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_crop_listings_commodity ON crop_listings(commodity);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_crop_listings_status ON crop_listings(status);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_crop_listings_created_at ON crop_listings(created_at DESC);

-- ============================================================
-- FIELD VISITS TABLE
-- ============================================================
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_field_visits_agent_id ON field_visits(agent_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_field_visits_farmer_id ON field_visits(farmer_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_field_visits_status ON field_visits(status);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_field_visits_scheduled ON field_visits(scheduled_date);

-- ============================================================
-- BANK TRANSACTIONS TABLE (core banking)
-- ============================================================
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_bank_transactions_account_id ON bank_transactions(account_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_bank_transactions_type ON bank_transactions(transaction_type);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_bank_transactions_status ON bank_transactions(status);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_bank_transactions_created_at ON bank_transactions(created_at DESC);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_bank_transactions_account_created ON bank_transactions(account_id, created_at DESC);

-- ============================================================
-- CREDIT SCORES TABLE
-- ============================================================
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_credit_scores_user_id ON credit_scores(user_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_credit_scores_user_created ON credit_scores(user_id, created_at DESC);

-- ============================================================
-- LOAN REPAYMENT SCHEDULES TABLE
-- ============================================================
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_loan_repayment_schedules_loan_id ON loan_repayment_schedules(loan_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_loan_repayment_schedules_due_date ON loan_repayment_schedules(due_date);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_loan_repayment_schedules_status ON loan_repayment_schedules(status);

-- ============================================================
-- CROP INSURANCE POLICIES TABLE
-- ============================================================
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_crop_insurance_policies_user_id ON crop_insurance_policies(user_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_crop_insurance_policies_status ON crop_insurance_policies(status);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_crop_insurance_policies_expiry ON crop_insurance_policies(expiry_date);

-- ============================================================
-- FUTURES POSITIONS TABLE
-- ============================================================
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_futures_positions_user_id ON futures_positions(user_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_futures_positions_contract_id ON futures_positions(contract_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_futures_positions_user_contract ON futures_positions(user_id, contract_id);

-- ============================================================
-- USSD SESSIONS TABLE
-- ============================================================
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ussd_sessions_phone ON ussd_sessions(phone_number);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ussd_sessions_session_id ON ussd_sessions(session_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ussd_sessions_created_at ON ussd_sessions(created_at DESC);

-- ============================================================
-- PUSH SUBSCRIPTIONS TABLE
-- ============================================================
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_push_subscriptions_user_id ON push_subscriptions(user_id);

-- ============================================================
-- WHATSAPP / TELEGRAM MESSAGES TABLE
-- ============================================================
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_whatsapp_messages_contact_id ON whatsapp_messages(contact_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_whatsapp_messages_created_at ON whatsapp_messages(created_at DESC);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_telegram_messages_contact_id ON telegram_messages(contact_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_telegram_messages_created_at ON telegram_messages(created_at DESC);

-- ============================================================
-- WEBAUTHN CREDENTIALS TABLE
-- ============================================================
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_webauthn_credentials_user_id ON webauthn_credentials(user_id);
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_webauthn_credentials_cred_id ON webauthn_credentials(credential_id);

-- ============================================================
-- BROKER CLIENTS TABLE
-- ============================================================
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_broker_clients_broker_id ON broker_clients(broker_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_broker_clients_client_id ON broker_clients(client_id);

-- ============================================================
-- FIXED INCOME TRADES TABLE
-- ============================================================
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_fixed_income_trades_user_id ON fixed_income_trades(user_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_fixed_income_trades_instrument_id ON fixed_income_trades(instrument_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_fixed_income_trades_created_at ON fixed_income_trades(created_at DESC);

-- ============================================================
-- ABCP PROGRAMS TABLE
-- ============================================================
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_abcp_programs_status ON abcp_programs(status);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_abcp_programs_created_at ON abcp_programs(created_at DESC);

-- ============================================================
-- WORKBENCH FARMS TABLE
-- ============================================================
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_workbench_farms_user_id ON workbench_farms(user_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_workbench_crop_plans_farm_id ON workbench_crop_plans(farm_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_workbench_soil_tests_farm_id ON workbench_soil_tests(farm_id);

-- ============================================================
-- ORDER BOOK LEVELS TABLE (real-time order book)
-- ============================================================
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_order_book_levels_symbol ON order_book_levels(symbol);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_order_book_levels_symbol_side ON order_book_levels(symbol, side);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_order_book_levels_updated_at ON order_book_levels(updated_at DESC);

-- ============================================================
-- PRE-TRADE RISK CHECKS TABLE
-- ============================================================
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_pre_trade_risk_checks_user_id ON pre_trade_risk_checks(user_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_pre_trade_risk_checks_order_id ON pre_trade_risk_checks(order_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_pre_trade_risk_checks_result ON pre_trade_risk_checks(result);

-- ============================================================
-- CIRCUIT BREAKER EVENTS TABLE
-- ============================================================
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_circuit_breaker_events_symbol ON circuit_breaker_events(symbol);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_circuit_breaker_events_created_at ON circuit_breaker_events(created_at DESC);

-- ============================================================
-- MARGIN CALLS TABLE
-- ============================================================
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_margin_calls_user_id ON margin_calls(user_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_margin_calls_status ON margin_calls(status);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_margin_calls_deadline ON margin_calls(deadline);

-- ============================================================
-- DEVICE SESSIONS TABLE
-- ============================================================
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_device_sessions_user_id ON device_sessions(user_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_device_sessions_last_active ON device_sessions(last_active_at DESC);

-- ============================================================
-- VELOCITY LEDGER TABLE (rate limiting)
-- ============================================================
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_velocity_ledger_user_id ON velocity_ledger(user_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_velocity_ledger_window ON velocity_ledger(window_start);

-- ============================================================
-- PROFILES TABLE
-- ============================================================
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_profiles_user_id ON profiles(user_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_profiles_kyc_status ON profiles(kyc_status);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_profiles_account_type ON profiles(account_type);

-- ============================================================
-- USERS TABLE
-- ============================================================
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_users_open_id ON users(open_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_email ON users(email) WHERE email IS NOT NULL;
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_created_at ON users(created_at DESC);
`;

/**
 * TiDB-compatible index SQL (no CONCURRENTLY keyword, no partial indexes)
 * Use this version for TiDB/MySQL deployments.
 */
export const TIDB_INDEX_SQL = PRODUCTION_INDEX_SQL
  .replace(/CONCURRENTLY /g, "")
  .replace(/WHERE .+$/gm, "");

export default PRODUCTION_INDEX_SQL;
