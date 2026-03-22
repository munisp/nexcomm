CREATE TYPE "public"."account_type" AS ENUM('FARMER', 'TRADER', 'PROCESSOR', 'BROKER', 'WAREHOUSE_OPERATOR', 'MARKET_MAKER');--> statement-breakpoint
CREATE TYPE "public"."alert_condition" AS ENUM('ABOVE', 'BELOW', 'CROSS_ABOVE', 'CROSS_BELOW');--> statement-breakpoint
CREATE TYPE "public"."asset_class" AS ENUM('COMMODITY', 'FOREX', 'EQUITY', 'DIGITAL_ASSET', 'INDEX');--> statement-breakpoint
CREATE TYPE "public"."auto_liquidation_status" AS ENUM('PENDING', 'EXECUTING', 'COMPLETED', 'FAILED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."broker_account_status" AS ENUM('INACTIVE', 'ACTIVE', 'SUSPENDED');--> statement-breakpoint
CREATE TYPE "public"."broker_client_status" AS ENUM('ACTIVE', 'INACTIVE', 'SUSPENDED');--> statement-breakpoint
CREATE TYPE "public"."broker_commission_status" AS ENUM('PENDING', 'PAID', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."broker_kyc_status" AS ENUM('PENDING', 'UNDER_REVIEW', 'APPROVED', 'REJECTED');--> statement-breakpoint
CREATE TYPE "public"."bulk_kyc_status" AS ENUM('PROCESSING', 'COMPLETED', 'FAILED', 'PARTIAL');--> statement-breakpoint
CREATE TYPE "public"."bulk_listing_approval_status" AS ENUM('PENDING', 'COUNTERSIGNED', 'REJECTED', 'EXPIRED');--> statement-breakpoint
CREATE TYPE "public"."clearing_account_status" AS ENUM('ACTIVE', 'SUSPENDED', 'CLOSED');--> statement-breakpoint
CREATE TYPE "public"."collateral_ledger_action" AS ENUM('PLEDGE', 'RELEASE', 'LIQUIDATE', 'REVALUE');--> statement-breakpoint
CREATE TYPE "public"."collateral_status" AS ENUM('ACTIVE', 'RELEASED', 'LIQUIDATED');--> statement-breakpoint
CREATE TYPE "public"."collateral_type" AS ENUM('WAREHOUSE_RECEIPT', 'CASH', 'BOND', 'EQUITY');--> statement-breakpoint
CREATE TYPE "public"."corporate_action_status" AS ENUM('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'CANCELLED', 'COMPLETED');--> statement-breakpoint
CREATE TYPE "public"."corporate_action_type" AS ENUM('DIVIDEND', 'STOCK_SPLIT', 'RIGHTS_ISSUE', 'BONUS_ISSUE', 'MERGER', 'DELISTING', 'IPO');--> statement-breakpoint
CREATE TYPE "public"."crop_status_v2" AS ENUM('ACTIVE', 'SOLD', 'EXPIRED', 'WITHDRAWN');--> statement-breakpoint
CREATE TYPE "public"."delivery_status" AS ENUM('PENDING', 'SCHEDULED', 'IN_TRANSIT', 'DELIVERED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."deposit_status" AS ENUM('PENDING', 'RECEIVED', 'GRADED', 'STORED', 'REJECTED');--> statement-breakpoint
CREATE TYPE "public"."dfsp_kyc_status" AS ENUM('PENDING', 'APPROVED', 'REJECTED', 'EDD_REQUIRED');--> statement-breakpoint
CREATE TYPE "public"."dfsp_tier" AS ENUM('STANDARD', 'PREMIUM', 'INSTITUTIONAL', 'CORRESPONDENT');--> statement-breakpoint
CREATE TYPE "public"."dispute_resolution" AS ENUM('SETTLED', 'FAILED', 'WITHDRAWN');--> statement-breakpoint
CREATE TYPE "public"."dispute_status" AS ENUM('OPEN', 'UNDER_REVIEW', 'RESOLVED_SETTLED', 'RESOLVED_FAILED', 'WITHDRAWN');--> statement-breakpoint
CREATE TYPE "public"."farmer_kyc_status" AS ENUM('PENDING', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED');--> statement-breakpoint
CREATE TYPE "public"."ip_allowlist_scope" AS ENUM('GLOBAL_ADMIN', 'BULK_OPERATIONS', 'LIQUIDATION_OVERRIDE', 'WITHDRAWAL_APPROVAL');--> statement-breakpoint
CREATE TYPE "public"."ir_document_type" AS ENUM('ANNUAL_REPORT', 'INTERIM_REPORT', 'QUARTERLY_REPORT', 'PROSPECTUS', 'CIRCULAR', 'PRESS_RELEASE', 'PRESENTATION', 'FINANCIAL_STATEMENT', 'REGULATORY_FILING', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."ir_event_type" AS ENUM('EARNINGS_RELEASE', 'DIVIDEND_ANNOUNCEMENT', 'AGM', 'EGM', 'RIGHTS_ISSUE', 'BONUS_ISSUE', 'STOCK_SPLIT', 'MERGER_ACQUISITION', 'REGULATORY_FILING', 'INVESTOR_PRESENTATION', 'ROADSHOW', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."kyc_audit_decision" AS ENUM('APPROVED', 'REJECTED', 'RESET', 'UNDER_REVIEW');--> statement-breakpoint
CREATE TYPE "public"."kyc_audit_stakeholder" AS ENUM('FARMER', 'TRADER', 'BROKER', 'WAREHOUSE_OPERATOR', 'MARKET_MAKER');--> statement-breakpoint
CREATE TYPE "public"."kyc_queue_status" AS ENUM('PENDING', 'UNDER_REVIEW', 'APPROVED', 'REJECTED');--> statement-breakpoint
CREATE TYPE "public"."kyc_risk_level" AS ENUM('LOW', 'MEDIUM', 'HIGH', 'CRITICAL', 'UNKNOWN');--> statement-breakpoint
CREATE TYPE "public"."kyc_status" AS ENUM('PENDING', 'VERIFIED', 'REJECTED');--> statement-breakpoint
CREATE TYPE "public"."margin_account_status" AS ENUM('ACTIVE', 'SUSPENDED', 'CLOSED');--> statement-breakpoint
CREATE TYPE "public"."margin_call_event_type" AS ENUM('ISSUED', 'DEPOSIT_RECEIVED', 'PARTIALLY_MET', 'MET', 'DEFAULTED', 'CANCELLED', 'GRACE_EXTENDED');--> statement-breakpoint
CREATE TYPE "public"."margin_call_status" AS ENUM('OPEN', 'PARTIALLY_MET', 'MET', 'DEFAULTED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."mfa_method" AS ENUM('totp', 'webauthn', 'sms', 'email_otp');--> statement-breakpoint
CREATE TYPE "public"."mm_onboarding_account_status" AS ENUM('INACTIVE', 'ACTIVE', 'SUSPENDED');--> statement-breakpoint
CREATE TYPE "public"."mm_onboarding_kyc_status" AS ENUM('PENDING', 'UNDER_REVIEW', 'APPROVED', 'REJECTED');--> statement-breakpoint
CREATE TYPE "public"."mojaloop_quote_status" AS ENUM('PENDING', 'ACCEPTED', 'REJECTED', 'EXPIRED');--> statement-breakpoint
CREATE TYPE "public"."mojaloop_transfer_status" AS ENUM('PENDING', 'RESERVED', 'COMMITTED', 'ABORTED', 'EXPIRED');--> statement-breakpoint
CREATE TYPE "public"."notification_type" AS ENUM('TRADE', 'SETTLEMENT', 'KYC', 'ALERT', 'SYSTEM', 'MARGIN_CALL', 'LIQUIDATED', 'SECURITY_ALERT');--> statement-breakpoint
CREATE TYPE "public"."option_position_status" AS ENUM('OPEN', 'EXERCISED', 'EXPIRED', 'CLOSED');--> statement-breakpoint
CREATE TYPE "public"."option_status" AS ENUM('ACTIVE', 'EXPIRED', 'SETTLED');--> statement-breakpoint
CREATE TYPE "public"."option_type" AS ENUM('CALL', 'PUT');--> statement-breakpoint
CREATE TYPE "public"."order_side" AS ENUM('BUY', 'SELL');--> statement-breakpoint
CREATE TYPE "public"."order_status" AS ENUM('OPEN', 'PARTIALLY_FILLED', 'FILLED', 'CANCELLED', 'REJECTED', 'EXPIRED');--> statement-breakpoint
CREATE TYPE "public"."order_type" AS ENUM('LIMIT', 'MARKET', 'STOP_LIMIT');--> statement-breakpoint
CREATE TYPE "public"."re_kyc_stakeholder_type" AS ENUM('FARMER', 'TRADER', 'BROKER', 'WAREHOUSE_OPERATOR', 'MARKET_MAKER');--> statement-breakpoint
CREATE TYPE "public"."role" AS ENUM('user', 'admin', 'farmer', 'trader', 'broker');--> statement-breakpoint
CREATE TYPE "public"."security_event_severity" AS ENUM('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');--> statement-breakpoint
CREATE TYPE "public"."security_event_status" AS ENUM('OPEN', 'INVESTIGATING', 'RESOLVED', 'FALSE_POSITIVE');--> statement-breakpoint
CREATE TYPE "public"."security_event_type" AS ENUM('RATE_LIMIT_BREACH', 'ANOMALOUS_ORDER', 'LARGE_WITHDRAWAL', 'REPEATED_AUTH_FAILURE', 'ADMIN_BULK_ACTION', 'SUSPICIOUS_IP', 'UNUSUAL_TRADE_PATTERN', 'ACCOUNT_TAKEOVER_ATTEMPT');--> statement-breakpoint
CREATE TYPE "public"."settlement_status" AS ENUM('PENDING', 'MATCHED', 'SETTLED', 'FAILED', 'DISPUTED');--> statement-breakpoint
CREATE TYPE "public"."soil_type" AS ENUM('LOAMY', 'CLAY', 'SANDY', 'SILT', 'PEAT', 'CHALK', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."stakeholder_type" AS ENUM('FARMER', 'TRADER', 'BROKER', 'WAREHOUSE_OPERATOR', 'MARKET_MAKER', 'ADMIN');--> statement-breakpoint
CREATE TYPE "public"."trader_account_status" AS ENUM('INACTIVE', 'ACTIVE', 'SUSPENDED');--> statement-breakpoint
CREATE TYPE "public"."trader_experience" AS ENUM('BEGINNER', 'INTERMEDIATE', 'EXPERIENCED', 'PROFESSIONAL');--> statement-breakpoint
CREATE TYPE "public"."trader_kyc_status" AS ENUM('PENDING', 'UNDER_REVIEW', 'APPROVED', 'REJECTED');--> statement-breakpoint
CREATE TYPE "public"."trader_risk_profile" AS ENUM('CONSERVATIVE', 'MODERATE', 'AGGRESSIVE');--> statement-breakpoint
CREATE TYPE "public"."warehouse_message_status" AS ENUM('SENT', 'READ', 'REPLIED', 'CLOSED');--> statement-breakpoint
CREATE TYPE "public"."warehouse_op_account_status" AS ENUM('INACTIVE', 'ACTIVE', 'SUSPENDED');--> statement-breakpoint
CREATE TYPE "public"."warehouse_op_kyc_status" AS ENUM('PENDING', 'UNDER_REVIEW', 'APPROVED', 'REJECTED');--> statement-breakpoint
CREATE TYPE "public"."warehouse_receipt_status" AS ENUM('ACTIVE', 'PLEDGED', 'REDEEMED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."webhook_event_filter" AS ENUM('ALL', 'HIGH_AND_CRITICAL', 'CRITICAL_ONLY');--> statement-breakpoint
CREATE TYPE "public"."withdrawal_verification_status" AS ENUM('PENDING', 'PASSED', 'FAILED', 'EXPIRED');--> statement-breakpoint
CREATE TABLE "aml_flags" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"rule_id" bigint,
	"transaction_ref" varchar(128),
	"transaction_type" varchar(64) NOT NULL,
	"amount" numeric(20, 2),
	"currency" varchar(8) DEFAULT 'NGN',
	"flag_reason" text NOT NULL,
	"severity" varchar(16) DEFAULT 'MEDIUM' NOT NULL,
	"status" varchar(32) DEFAULT 'PENDING' NOT NULL,
	"reviewed_by" integer,
	"reviewed_at" timestamp,
	"review_notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "aml_rules" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"name" varchar(128) NOT NULL,
	"rule_type" varchar(64) NOT NULL,
	"threshold_amount" numeric(20, 2),
	"threshold_count" integer,
	"window_hours" integer DEFAULT 24,
	"currency" varchar(8) DEFAULT 'NGN',
	"severity" varchar(16) DEFAULT 'MEDIUM' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"description" text,
	"created_by" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "api_keys" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"name" varchar(128) NOT NULL,
	"key_hash" varchar(256) NOT NULL,
	"key_prefix" varchar(16) NOT NULL,
	"permissions" text[] DEFAULT '{}' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"last_used_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"action" varchar(128) NOT NULL,
	"resource" varchar(128),
	"resource_id" varchar(64),
	"details" json,
	"ip_address" varchar(45),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auto_liquidation_orders" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"margin_call_id" bigint NOT NULL,
	"clearing_account_id" bigint NOT NULL,
	"user_id" integer NOT NULL,
	"status" "auto_liquidation_status" DEFAULT 'PENDING' NOT NULL,
	"instrument" varchar(64) NOT NULL,
	"quantity" numeric(20, 8) NOT NULL,
	"estimated_value" numeric(20, 2) NOT NULL,
	"actual_proceeds" numeric(20, 2),
	"initiated_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp,
	"initiated_by" integer,
	"failure_reason" text,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "broker_clients" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"broker_profile_id" integer NOT NULL,
	"client_user_id" integer NOT NULL,
	"client_name" varchar(200),
	"client_email" varchar(200),
	"client_phone" varchar(30),
	"account_type" varchar(50) DEFAULT 'INDIVIDUAL',
	"status" "broker_client_status" DEFAULT 'ACTIVE' NOT NULL,
	"onboarded_at" timestamp DEFAULT now() NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "broker_commissions" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"broker_profile_id" integer NOT NULL,
	"client_user_id" integer,
	"order_id" bigint,
	"fill_id" bigint,
	"symbol" varchar(32) NOT NULL,
	"side" varchar(4) NOT NULL,
	"filled_qty" numeric(18, 6) NOT NULL,
	"fill_price" numeric(18, 6) NOT NULL,
	"trade_value" numeric(18, 6) NOT NULL,
	"commission_rate" numeric(6, 4) NOT NULL,
	"commission_amount" numeric(18, 6) NOT NULL,
	"currency" varchar(10) DEFAULT 'NGN' NOT NULL,
	"status" "broker_commission_status" DEFAULT 'PENDING' NOT NULL,
	"paid_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "broker_profiles" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"firm_name" varchar(200) NOT NULL,
	"rc_number" varchar(50),
	"sec_license_number" varchar(100),
	"cbn_license_number" varchar(100),
	"regulatory_body" varchar(100),
	"contact_phone" varchar(30),
	"contact_email" varchar(200),
	"firm_address" text,
	"state" varchar(100),
	"years_in_operation" integer,
	"client_book_size" varchar(50),
	"commission_rate" numeric(6, 4),
	"sec_certificate_url" text,
	"cbn_approval_url" text,
	"cac_doc_url" text,
	"kyc_status" "broker_kyc_status" DEFAULT 'PENDING' NOT NULL,
	"kyc_notes" text,
	"account_status" "broker_account_status" DEFAULT 'INACTIVE' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "broker_profiles_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "bulk_listing_approvals" (
	"id" serial PRIMARY KEY NOT NULL,
	"upload_id" integer NOT NULL,
	"cooperative_user_id" integer NOT NULL,
	"counter_signer_id" integer,
	"status" "bulk_listing_approval_status" DEFAULT 'PENDING' NOT NULL,
	"member_count" integer DEFAULT 0 NOT NULL,
	"crop_type" text NOT NULL,
	"total_quantity_kg" integer DEFAULT 0 NOT NULL,
	"price_per_kg" integer DEFAULT 0 NOT NULL,
	"harvest_date" timestamp,
	"description" text,
	"initiator_notes" text,
	"counter_signer_notes" text,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "circuit_breaker_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"rule_id" integer,
	"instrument" varchar(32) NOT NULL,
	"asset_class" varchar(32) NOT NULL,
	"trigger_pct" numeric(8, 4) NOT NULL,
	"price_before" numeric(20, 8) NOT NULL,
	"price_after" numeric(20, 8) NOT NULL,
	"actual_move_pct" numeric(8, 4) NOT NULL,
	"halted_at" timestamp DEFAULT now() NOT NULL,
	"halt_until" timestamp NOT NULL,
	"lifted_at" timestamp,
	"lifted_by" integer,
	"status" varchar(16) DEFAULT 'ACTIVE' NOT NULL,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "circuit_breaker_rules" (
	"id" serial PRIMARY KEY NOT NULL,
	"instrument" varchar(32) NOT NULL,
	"asset_class" varchar(32) DEFAULT 'COMMODITY' NOT NULL,
	"trigger_pct" numeric(8, 4) NOT NULL,
	"window_minutes" integer NOT NULL,
	"halt_duration_minutes" integer NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"notes" text,
	"created_by" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "clearing_accounts" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"account_ref" varchar(32) NOT NULL,
	"status" "clearing_account_status" DEFAULT 'ACTIVE' NOT NULL,
	"initial_margin_pct" numeric(6, 4) DEFAULT '0.10' NOT NULL,
	"maintenance_margin_pct" numeric(6, 4) DEFAULT '0.07' NOT NULL,
	"portfolio_value" numeric(20, 2) DEFAULT '0' NOT NULL,
	"cash_balance" numeric(20, 2) DEFAULT '0' NOT NULL,
	"total_margin_required" numeric(20, 2) DEFAULT '0' NOT NULL,
	"total_margin_posted" numeric(20, 2) DEFAULT '0' NOT NULL,
	"equity_ratio" numeric(8, 6) DEFAULT '1' NOT NULL,
	"last_valuation_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"notes" text,
	CONSTRAINT "clearing_accounts_user_id_unique" UNIQUE("user_id"),
	CONSTRAINT "clearing_accounts_account_ref_unique" UNIQUE("account_ref")
);
--> statement-breakpoint
CREATE TABLE "collateral_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"margin_account_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"collateral_type" "collateral_type" NOT NULL,
	"reference_id" integer,
	"description" text NOT NULL,
	"face_value" numeric(18, 2) NOT NULL,
	"current_value" numeric(18, 2) NOT NULL,
	"haircut" numeric(5, 2) DEFAULT '20' NOT NULL,
	"eligible_value" numeric(18, 2) NOT NULL,
	"status" "collateral_status" DEFAULT 'ACTIVE' NOT NULL,
	"pledged_at" timestamp DEFAULT now() NOT NULL,
	"released_at" timestamp,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "collateral_ledger" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"collateral_item_id" integer,
	"action" "collateral_ledger_action" NOT NULL,
	"amount" numeric(18, 2) NOT NULL,
	"balance_before" numeric(18, 2) NOT NULL,
	"balance_after" numeric(18, 2) NOT NULL,
	"description" text NOT NULL,
	"performed_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance_exports" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"export_type" varchar(32) NOT NULL,
	"format" varchar(8) NOT NULL,
	"date_from" timestamp,
	"date_to" timestamp,
	"filters" text,
	"record_count" integer DEFAULT 0,
	"file_url" text,
	"file_key" text,
	"generated_by" integer NOT NULL,
	"generated_at" timestamp DEFAULT now() NOT NULL,
	"status" varchar(16) DEFAULT 'PENDING' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cooperative_bulk_uploads" (
	"id" serial PRIMARY KEY NOT NULL,
	"uploaded_by" integer NOT NULL,
	"file_name" varchar(256) NOT NULL,
	"status" "bulk_kyc_status" DEFAULT 'PROCESSING' NOT NULL,
	"total_rows" integer DEFAULT 0 NOT NULL,
	"processed_rows" integer DEFAULT 0 NOT NULL,
	"success_rows" integer DEFAULT 0 NOT NULL,
	"failed_rows" integer DEFAULT 0 NOT NULL,
	"errors" json,
	"created_application_ids" json,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "corporate_actions" (
	"id" serial PRIMARY KEY NOT NULL,
	"action_type" "corporate_action_type" NOT NULL,
	"status" "corporate_action_status" DEFAULT 'DRAFT' NOT NULL,
	"symbol" varchar(64) NOT NULL,
	"title" varchar(256) NOT NULL,
	"description" text,
	"ex_date" timestamp,
	"record_date" timestamp,
	"payment_date" timestamp,
	"announcement_date" timestamp,
	"dividend_amount" numeric(18, 6),
	"dividend_currency" varchar(8),
	"split_ratio_from" integer,
	"split_ratio_to" integer,
	"rights_price" numeric(18, 6),
	"rights_ratio" varchar(32),
	"ipo_price" numeric(18, 6),
	"ipo_shares" bigint,
	"submitted_by" integer NOT NULL,
	"reviewed_by" integer,
	"review_notes" text,
	"submitted_at" timestamp DEFAULT now() NOT NULL,
	"reviewed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crop_listings" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"farm_id" integer NOT NULL,
	"crop_type" varchar(100) NOT NULL,
	"variety" varchar(100),
	"quantity_kg" numeric(14, 2) NOT NULL,
	"asking_price_per_kg" numeric(14, 4) NOT NULL,
	"currency" varchar(10) DEFAULT 'NGN' NOT NULL,
	"expected_harvest_date" timestamp NOT NULL,
	"description" text,
	"status" "crop_status_v2" DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "delivery_orders" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"receipt_id" integer,
	"commodity" varchar(64) NOT NULL,
	"quantity" numeric(18, 6) NOT NULL,
	"unit" varchar(16) NOT NULL,
	"delivery_address" text NOT NULL,
	"scheduled_date" timestamp,
	"status" "delivery_status" DEFAULT 'PENDING' NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deposit_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"commodity" varchar(64) NOT NULL,
	"grade" varchar(32),
	"quantity" numeric(18, 6) NOT NULL,
	"unit" varchar(16) NOT NULL,
	"warehouse_id" varchar(64),
	"warehouse_name" varchar(256),
	"expected_date" timestamp,
	"status" "deposit_status" DEFAULT 'PENDING' NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "device_sessions" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"fingerprint" varchar(128) NOT NULL,
	"user_agent" text,
	"ip_address" varchar(64),
	"timezone" varchar(64),
	"screen_resolution" varchar(32),
	"is_known" boolean DEFAULT false NOT NULL,
	"is_trusted" boolean DEFAULT false NOT NULL,
	"last_seen_at" timestamp DEFAULT now() NOT NULL,
	"first_seen_at" timestamp DEFAULT now() NOT NULL,
	"revoked_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "dfsp_kyc_records" (
	"id" serial PRIMARY KEY NOT NULL,
	"fsp_id" varchar(64) NOT NULL,
	"legal_entity_name" varchar(256) NOT NULL,
	"registration_number" varchar(128) NOT NULL,
	"tax_id" varchar(64),
	"regulatory_body" varchar(128) NOT NULL,
	"license_number" varchar(128) NOT NULL,
	"aml_risk_level" varchar(16) DEFAULT 'LOW' NOT NULL,
	"pep_exposure" boolean DEFAULT false NOT NULL,
	"sanctions_screening_passed" boolean DEFAULT false NOT NULL,
	"beneficial_owners" text NOT NULL,
	"compliance_officer_name" varchar(256) NOT NULL,
	"compliance_officer_email" varchar(256) NOT NULL,
	"documents_provided" json DEFAULT '[]'::json NOT NULL,
	"acknowledged_aml_policy" boolean DEFAULT false NOT NULL,
	"acknowledged_data_processing" boolean DEFAULT false NOT NULL,
	"status" "dfsp_kyc_status" DEFAULT 'PENDING' NOT NULL,
	"reviewed_by" varchar(128),
	"reviewed_at" timestamp,
	"review_notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "dfsp_kyc_records_fsp_id_unique" UNIQUE("fsp_id")
);
--> statement-breakpoint
CREATE TABLE "dfsp_tiers" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" "dfsp_tier" NOT NULL,
	"display_name" varchar(64) NOT NULL,
	"description" text,
	"daily_limit_amount" numeric(18, 2) DEFAULT '1000000' NOT NULL,
	"daily_limit_currency" varchar(8) DEFAULT 'NGN' NOT NULL,
	"min_transfer_amount" numeric(18, 2) DEFAULT '100' NOT NULL,
	"max_transfer_amount" numeric(18, 2) DEFAULT '5000000' NOT NULL,
	"allowed_currencies" varchar(256) DEFAULT 'NGN' NOT NULL,
	"settlement_window_hrs" integer DEFAULT 24 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "dfsp_tiers_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "dispute_audit_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"dispute_id" integer NOT NULL,
	"performed_by" integer NOT NULL,
	"action" varchar(64) NOT NULL,
	"from_status" "dispute_status",
	"to_status" "dispute_status",
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dispute_evidence" (
	"id" serial PRIMARY KEY NOT NULL,
	"dispute_id" integer NOT NULL,
	"uploaded_by" integer NOT NULL,
	"file_key" varchar(512) NOT NULL,
	"file_url" text NOT NULL,
	"file_name" varchar(256) NOT NULL,
	"mime_type" varchar(128) NOT NULL,
	"file_size" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "farm_profiles" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"farm_name" varchar(200) NOT NULL,
	"size_hectares" numeric(10, 2) NOT NULL,
	"latitude" numeric(10, 7),
	"longitude" numeric(10, 7),
	"state" varchar(100) NOT NULL,
	"lga" varchar(100) NOT NULL,
	"soil_type" "soil_type" DEFAULT 'LOAMY' NOT NULL,
	"description" text,
	"boundary" jsonb,
	"centroid" geometry(Point,4326),
	"geom" geometry(Polygon,4326),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "farmer_earnings" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"listing_id" integer,
	"crop_type" varchar(100) NOT NULL,
	"quantity_kg" numeric(14, 2) NOT NULL,
	"price_per_kg" numeric(14, 4) NOT NULL,
	"total_amount" numeric(18, 2) NOT NULL,
	"currency" varchar(10) DEFAULT 'NGN' NOT NULL,
	"buyer_name" varchar(200),
	"settled_at" timestamp DEFAULT now() NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "farmer_onboarding_drafts" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"step" integer DEFAULT 1 NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "farmer_onboarding_drafts_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "farmer_profiles" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"full_name" varchar(200) NOT NULL,
	"phone" varchar(20) NOT NULL,
	"nin" varchar(30),
	"bvn" varchar(30),
	"state" varchar(100) NOT NULL,
	"lga" varchar(100) NOT NULL,
	"kyc_status" "farmer_kyc_status" DEFAULT 'PENDING' NOT NULL,
	"kyc_documents" text,
	"kyc_reviewed_at" timestamp,
	"kyc_reviewed_by" integer,
	"kyc_notes" text,
	"bank_name" varchar(100),
	"bank_account_number" varchar(30),
	"bank_account_name" varchar(200),
	"mobile_money_provider" varchar(50),
	"mobile_money_number" varchar(20),
	"onboarding_step" integer DEFAULT 1 NOT NULL,
	"onboarding_completed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "farmer_profiles_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "futures_contracts" (
	"id" serial PRIMARY KEY NOT NULL,
	"symbol" varchar(32) NOT NULL,
	"underlying_asset" varchar(64) NOT NULL,
	"asset_class" varchar(32) DEFAULT 'COMMODITY' NOT NULL,
	"contract_size" numeric(18, 6) NOT NULL,
	"tick_size" numeric(18, 8) NOT NULL,
	"currency" varchar(8) DEFAULT 'NGN' NOT NULL,
	"expiry_date" timestamp NOT NULL,
	"settlement_date" timestamp NOT NULL,
	"initial_margin_pct" numeric(8, 4) DEFAULT '0.10' NOT NULL,
	"maintenance_margin_pct" numeric(8, 4) DEFAULT '0.07' NOT NULL,
	"last_settlement_price" numeric(20, 8),
	"last_mark_price" numeric(20, 8),
	"status" varchar(16) DEFAULT 'ACTIVE' NOT NULL,
	"created_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "futures_contracts_symbol_unique" UNIQUE("symbol")
);
--> statement-breakpoint
CREATE TABLE "futures_positions" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"contract_id" integer NOT NULL,
	"side" varchar(8) NOT NULL,
	"quantity" numeric(18, 6) NOT NULL,
	"entry_price" numeric(20, 8) NOT NULL,
	"current_mark_price" numeric(20, 8),
	"unrealized_pnl" numeric(20, 8) DEFAULT '0' NOT NULL,
	"realized_pnl" numeric(20, 8) DEFAULT '0' NOT NULL,
	"margin_posted" numeric(20, 8) NOT NULL,
	"liquidation_price" numeric(20, 8),
	"status" varchar(16) DEFAULT 'OPEN' NOT NULL,
	"opened_at" timestamp DEFAULT now() NOT NULL,
	"closed_at" timestamp,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "futures_settlements" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"contract_id" integer NOT NULL,
	"settlement_type" varchar(16) NOT NULL,
	"settlement_price" numeric(20, 8) NOT NULL,
	"total_long_pnl" numeric(20, 8) DEFAULT '0' NOT NULL,
	"total_short_pnl" numeric(20, 8) DEFAULT '0' NOT NULL,
	"positions_settled" integer DEFAULT 0 NOT NULL,
	"settled_by" integer,
	"settled_at" timestamp DEFAULT now() NOT NULL,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "ip_allowlist" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"cidr" varchar(50) NOT NULL,
	"label" varchar(128) NOT NULL,
	"scope" "ip_allowlist_scope" DEFAULT 'GLOBAL_ADMIN' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ir_documents" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"company_symbol" varchar(16) NOT NULL,
	"company_name" varchar(128) NOT NULL,
	"document_type" "ir_document_type" NOT NULL,
	"title" varchar(256) NOT NULL,
	"description" text,
	"fiscal_year" integer,
	"fiscal_period" varchar(16),
	"file_url" varchar(512) NOT NULL,
	"file_key" varchar(512) NOT NULL,
	"file_size_bytes" integer,
	"mime_type" varchar(64) DEFAULT 'application/pdf' NOT NULL,
	"download_count" integer DEFAULT 0 NOT NULL,
	"is_published" boolean DEFAULT false NOT NULL,
	"published_at" timestamp,
	"created_by" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ir_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"company_symbol" varchar(16) NOT NULL,
	"company_name" varchar(128) NOT NULL,
	"event_type" "ir_event_type" NOT NULL,
	"title" varchar(256) NOT NULL,
	"description" text,
	"event_date" timestamp NOT NULL,
	"is_all_day" boolean DEFAULT true NOT NULL,
	"venue" varchar(256),
	"webcast_url" varchar(512),
	"dividend_per_share" numeric(20, 6),
	"dividend_currency" varchar(8),
	"ex_dividend_date" timestamp,
	"record_date" timestamp,
	"payment_date" timestamp,
	"eps_actual" numeric(20, 6),
	"eps_estimate" numeric(20, 6),
	"revenue_actual" numeric(20, 2),
	"revenue_estimate" numeric(20, 2),
	"is_published" boolean DEFAULT false NOT NULL,
	"published_at" timestamp,
	"created_by" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ir_subscriptions" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"company_symbol" varchar(16) NOT NULL,
	"notify_earnings" boolean DEFAULT true NOT NULL,
	"notify_dividends" boolean DEFAULT true NOT NULL,
	"notify_documents" boolean DEFAULT true NOT NULL,
	"notify_events" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kyc_analysis_results" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"stakeholder_type" text NOT NULL,
	"document_url" text NOT NULL,
	"selfie_url" text,
	"is_pdf" boolean DEFAULT false,
	"ocr_extracted_fields" text,
	"ocr_avg_confidence" real,
	"ocr_line_count" integer,
	"document_authenticity_score" real,
	"document_type" text,
	"document_risk_flags" text,
	"selfie_overall_score" real,
	"selfie_liveness_assessment" text,
	"passive_liveness_score" real,
	"passive_liveness_flags" text,
	"overall_score" real,
	"overall_risk_level" "kyc_risk_level" DEFAULT 'UNKNOWN',
	"all_risk_flags" text,
	"recommendation" text,
	"analysed_at" timestamp DEFAULT now() NOT NULL,
	"service_version" text DEFAULT '1.0.0'
);
--> statement-breakpoint
CREATE TABLE "kyc_audit_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"stakeholder_type" "kyc_audit_stakeholder" NOT NULL,
	"profile_id" integer NOT NULL,
	"reviewer_id" integer NOT NULL,
	"reviewer_name" text,
	"decision" "kyc_audit_decision" NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kyc_queue" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"status" "kyc_queue_status" DEFAULT 'PENDING' NOT NULL,
	"reviewed_by" integer,
	"review_notes" text,
	"documents" json,
	"submitted_at" timestamp DEFAULT now() NOT NULL,
	"reviewed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "listing_messages" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"listing_id" integer NOT NULL,
	"sender_id" integer NOT NULL,
	"recipient_id" integer NOT NULL,
	"message" text NOT NULL,
	"is_read" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "live_prices" (
	"id" serial PRIMARY KEY NOT NULL,
	"symbol" varchar(64) NOT NULL,
	"name" varchar(128) NOT NULL,
	"price" numeric(18, 6) NOT NULL,
	"previous_close" numeric(18, 6),
	"change_amount" numeric(18, 6),
	"change_pct" numeric(10, 4),
	"high" numeric(18, 6),
	"low" numeric(18, 6),
	"currency" varchar(8) DEFAULT 'USD' NOT NULL,
	"source" varchar(32) DEFAULT 'yahoo' NOT NULL,
	"yahoo_symbol" varchar(32),
	"asset_class" varchar(32) DEFAULT 'COMMODITY' NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "live_prices_symbol_unique" UNIQUE("symbol")
);
--> statement-breakpoint
CREATE TABLE "margin_accounts" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"status" "margin_account_status" DEFAULT 'ACTIVE' NOT NULL,
	"cash_balance" numeric(18, 2) DEFAULT '0' NOT NULL,
	"total_collateral_value" numeric(18, 2) DEFAULT '0' NOT NULL,
	"used_margin" numeric(18, 2) DEFAULT '0' NOT NULL,
	"available_margin" numeric(18, 2) DEFAULT '0' NOT NULL,
	"margin_call_level" numeric(5, 2) DEFAULT '30' NOT NULL,
	"currency" varchar(8) DEFAULT 'NGN' NOT NULL,
	"last_margin_call_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "margin_accounts_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "margin_call_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"margin_call_id" bigint NOT NULL,
	"event_type" "margin_call_event_type" NOT NULL,
	"amount" numeric(20, 2),
	"equity_ratio_after" numeric(8, 6),
	"performed_by" integer,
	"occurred_at" timestamp DEFAULT now() NOT NULL,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "margin_calls" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"clearing_account_id" bigint NOT NULL,
	"user_id" integer NOT NULL,
	"call_ref" varchar(32) NOT NULL,
	"status" "margin_call_status" DEFAULT 'OPEN' NOT NULL,
	"equity_ratio_at_call" numeric(8, 6) NOT NULL,
	"portfolio_value_at_call" numeric(20, 2) NOT NULL,
	"margin_deficit" numeric(20, 2) NOT NULL,
	"amount_required" numeric(20, 2) NOT NULL,
	"amount_received" numeric(20, 2) DEFAULT '0' NOT NULL,
	"issued_at" timestamp DEFAULT now() NOT NULL,
	"due_at" timestamp NOT NULL,
	"resolved_at" timestamp,
	"auto_liquidation_triggered_at" timestamp,
	"issued_by" integer,
	"notes" text,
	CONSTRAINT "margin_calls_call_ref_unique" UNIQUE("call_ref")
);
--> statement-breakpoint
CREATE TABLE "market_maker_obligations" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"market_maker_id" bigint NOT NULL,
	"instrument" varchar(32) NOT NULL,
	"asset_class" varchar(32) NOT NULL,
	"min_bid_size" numeric(20, 8) NOT NULL,
	"min_ask_size" numeric(20, 8) NOT NULL,
	"max_spread_bps" integer NOT NULL,
	"min_uptime_pct" numeric(5, 2) DEFAULT '90.00' NOT NULL,
	"penalty_per_breach_ngn" numeric(20, 2) DEFAULT '50000.00' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"effective_from" timestamp NOT NULL,
	"effective_to" timestamp,
	"created_by" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "market_maker_onboarding_profiles" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"firm_name" varchar(200) NOT NULL,
	"trading_desk" varchar(200),
	"contact_phone" varchar(30),
	"contact_email" varchar(200),
	"years_of_operation" integer,
	"regulatory_registrations" text,
	"instrument_obligations" text[],
	"min_quote_size_lots" numeric(12, 2),
	"max_spread_bps" numeric(8, 2),
	"capital_commitment_ngn" numeric(18, 2),
	"performance_bond_ngn" numeric(18, 2),
	"firm_registration_url" text,
	"trading_license_url" text,
	"capital_adequacy_url" text,
	"kyc_status" "mm_onboarding_kyc_status" DEFAULT 'PENDING' NOT NULL,
	"kyc_notes" text,
	"account_status" "mm_onboarding_account_status" DEFAULT 'INACTIVE' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "market_maker_onboarding_profiles_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "market_maker_performance_reports" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"market_maker_id" bigint NOT NULL,
	"obligation_id" bigint NOT NULL,
	"instrument" varchar(32) NOT NULL,
	"report_date" varchar(16) NOT NULL,
	"total_snapshots" integer DEFAULT 0 NOT NULL,
	"compliant_snapshots" integer DEFAULT 0 NOT NULL,
	"uptime_pct" numeric(5, 2) DEFAULT '0' NOT NULL,
	"avg_spread_bps" integer DEFAULT 0,
	"max_spread_bps" integer DEFAULT 0,
	"spread_breaches" integer DEFAULT 0 NOT NULL,
	"size_breaches" integer DEFAULT 0 NOT NULL,
	"absence_breaches" integer DEFAULT 0 NOT NULL,
	"total_breaches" integer DEFAULT 0 NOT NULL,
	"penalty_amount" numeric(20, 2) DEFAULT '0' NOT NULL,
	"penalty_status" varchar(32) DEFAULT 'PENDING' NOT NULL,
	"generated_at" timestamp DEFAULT now() NOT NULL,
	"reviewed_by" integer,
	"reviewed_at" timestamp,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "market_maker_profiles" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"firm_name" varchar(128) NOT NULL,
	"license_number" varchar(64),
	"asset_classes" text NOT NULL,
	"instruments" text NOT NULL,
	"status" varchar(32) DEFAULT 'ACTIVE' NOT NULL,
	"approved_by" integer,
	"approved_at" timestamp,
	"suspended_at" timestamp,
	"suspension_reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "market_maker_profiles_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "market_maker_quote_snapshots" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"market_maker_id" bigint NOT NULL,
	"obligation_id" bigint NOT NULL,
	"instrument" varchar(32) NOT NULL,
	"snapshot_at" timestamp DEFAULT now() NOT NULL,
	"bid_price" numeric(20, 8),
	"ask_price" numeric(20, 8),
	"bid_size" numeric(20, 8),
	"ask_size" numeric(20, 8),
	"spread_bps" integer,
	"is_compliant" boolean NOT NULL,
	"breach_type" varchar(64),
	"trading_session_date" varchar(16) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mfa_otp_codes" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"method" "mfa_method" NOT NULL,
	"code_hash" varchar(64) NOT NULL,
	"expires_at" timestamp NOT NULL,
	"used_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mojaloop_callbacks" (
	"id" serial PRIMARY KEY NOT NULL,
	"callback_type" varchar(64) NOT NULL,
	"resource_id" varchar(64) NOT NULL,
	"source_fsp_id" varchar(64),
	"payload" json NOT NULL,
	"http_status" integer DEFAULT 200 NOT NULL,
	"processed" boolean DEFAULT false NOT NULL,
	"processed_at" timestamp,
	"error_message" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mojaloop_dead_letter" (
	"id" serial PRIMARY KEY NOT NULL,
	"transfer_id" varchar(64) NOT NULL,
	"payer_fsp_id" varchar(64) NOT NULL,
	"payee_fsp_id" varchar(64) NOT NULL,
	"payer_identifier" varchar(128) NOT NULL,
	"payee_identifier" varchar(128) NOT NULL,
	"amount" numeric(18, 6) NOT NULL,
	"currency" varchar(8) NOT NULL,
	"status" varchar(32) DEFAULT 'FAILED' NOT NULL,
	"error_message" text,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"last_retry_at" timestamp,
	"resolved" boolean DEFAULT false NOT NULL,
	"resolved_at" timestamp,
	"resolved_by" varchar(128),
	"raw_payload" json,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mojaloop_dfsps" (
	"id" serial PRIMARY KEY NOT NULL,
	"fsp_id" varchar(64) NOT NULL,
	"name" varchar(128) NOT NULL,
	"country" varchar(4),
	"currencies" json DEFAULT '[]'::json,
	"is_active" boolean DEFAULT true NOT NULL,
	"endpoint_url" varchar(256),
	"callback_url" varchar(256),
	"tier" "dfsp_tier" DEFAULT 'STANDARD',
	"status" varchar(32) DEFAULT 'ACTIVE',
	"currency" varchar(8) DEFAULT 'NGN',
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "mojaloop_dfsps_fsp_id_unique" UNIQUE("fsp_id")
);
--> statement-breakpoint
CREATE TABLE "mojaloop_fee_schedules" (
	"id" serial PRIMARY KEY NOT NULL,
	"tier_name" "dfsp_tier" NOT NULL,
	"currency" varchar(8) NOT NULL,
	"flat_fee" numeric(18, 6) DEFAULT '0' NOT NULL,
	"percentage_fee" numeric(8, 4) DEFAULT '0' NOT NULL,
	"min_fee" numeric(18, 6) DEFAULT '0' NOT NULL,
	"max_fee" numeric(18, 6),
	"effective_from" timestamp DEFAULT now() NOT NULL,
	"effective_to" timestamp,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mojaloop_parties" (
	"id" serial PRIMARY KEY NOT NULL,
	"party_id_type" varchar(32) NOT NULL,
	"party_identifier" varchar(128) NOT NULL,
	"fsp_id" varchar(64) NOT NULL,
	"first_name" varchar(128),
	"last_name" varchar(128),
	"date_of_birth" varchar(16),
	"merchant_class_code" varchar(16),
	"currency" varchar(8) DEFAULT 'USD' NOT NULL,
	"supported_currencies" json DEFAULT '[]'::json,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mojaloop_quotes" (
	"id" serial PRIMARY KEY NOT NULL,
	"quote_id" varchar(64) NOT NULL,
	"transaction_id" varchar(64) NOT NULL,
	"payer_fsp_id" varchar(64) NOT NULL,
	"payee_fsp_id" varchar(64) NOT NULL,
	"payer_identifier" varchar(128) NOT NULL,
	"payee_identifier" varchar(128) NOT NULL,
	"amount_type" varchar(16) DEFAULT 'SEND' NOT NULL,
	"amount" numeric(18, 6) NOT NULL,
	"currency" varchar(8) NOT NULL,
	"fee_amount" numeric(18, 6) DEFAULT '0',
	"fee_currency" varchar(8),
	"transfer_amount" numeric(18, 6),
	"ilp_packet" text,
	"condition" varchar(256),
	"expiration" timestamp,
	"status" "mojaloop_quote_status" DEFAULT 'PENDING' NOT NULL,
	"reject_reason" text,
	"nexcom_settlement_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "mojaloop_quotes_quote_id_unique" UNIQUE("quote_id")
);
--> statement-breakpoint
CREATE TABLE "mojaloop_transfers" (
	"id" serial PRIMARY KEY NOT NULL,
	"transfer_id" varchar(64) NOT NULL,
	"quote_id" varchar(64),
	"payer_fsp_id" varchar(64) NOT NULL,
	"payee_fsp_id" varchar(64) NOT NULL,
	"payer_identifier" varchar(128) NOT NULL,
	"payee_identifier" varchar(128) NOT NULL,
	"amount" numeric(18, 6) NOT NULL,
	"currency" varchar(8) NOT NULL,
	"ilp_packet" text,
	"condition" varchar(256),
	"fulfilment" varchar(256),
	"expiration" timestamp,
	"status" "mojaloop_transfer_status" DEFAULT 'PENDING' NOT NULL,
	"error_code" varchar(8),
	"error_description" text,
	"nexcom_settlement_id" integer,
	"nexcom_order_id" integer,
	"reserved_at" timestamp,
	"committed_at" timestamp,
	"aborted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "mojaloop_transfers_transfer_id_unique" UNIQUE("transfer_id")
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"title" varchar(256) NOT NULL,
	"message" text NOT NULL,
	"type" "notification_type" DEFAULT 'SYSTEM' NOT NULL,
	"read" boolean DEFAULT false NOT NULL,
	"metadata" json,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "open_interest_snapshots" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"contract_id" integer NOT NULL,
	"snapshot_date" timestamp DEFAULT now() NOT NULL,
	"total_long_qty" numeric(18, 6) DEFAULT '0' NOT NULL,
	"total_short_qty" numeric(18, 6) DEFAULT '0' NOT NULL,
	"open_interest" numeric(18, 6) DEFAULT '0' NOT NULL,
	"daily_volume" numeric(18, 6) DEFAULT '0' NOT NULL,
	"settlement_price" numeric(20, 8)
);
--> statement-breakpoint
CREATE TABLE "options_contracts" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"symbol" varchar(50) NOT NULL,
	"underlying_contract_id" integer,
	"option_type" "option_type" NOT NULL,
	"strike_price" numeric(20, 8) NOT NULL,
	"expiry_date" timestamp NOT NULL,
	"contract_size" numeric(18, 6) DEFAULT '1' NOT NULL,
	"risk_free_rate" numeric(10, 6) DEFAULT '0.05' NOT NULL,
	"implied_volatility" numeric(10, 6) DEFAULT '0.20' NOT NULL,
	"last_price" numeric(20, 8),
	"open_interest" integer DEFAULT 0 NOT NULL,
	"status" "option_status" DEFAULT 'ACTIVE' NOT NULL,
	"created_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "options_contracts_symbol_unique" UNIQUE("symbol")
);
--> statement-breakpoint
CREATE TABLE "options_positions" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"contract_id" integer NOT NULL,
	"option_type" "option_type" NOT NULL,
	"quantity" numeric(18, 6) NOT NULL,
	"premium_paid" numeric(20, 8) NOT NULL,
	"total_cost" numeric(20, 8) NOT NULL,
	"strike_price" numeric(20, 8) NOT NULL,
	"expiry_date" timestamp NOT NULL,
	"status" "option_position_status" DEFAULT 'OPEN' NOT NULL,
	"exercised_at" timestamp,
	"settlement_pnl" numeric(20, 8),
	"opened_at" timestamp DEFAULT now() NOT NULL,
	"closed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "order_amendments" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"order_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"old_qty" numeric(18, 6) NOT NULL,
	"new_qty" numeric(18, 6) NOT NULL,
	"old_price" numeric(18, 6),
	"new_price" numeric(18, 6),
	"reason" text,
	"is_bulk" boolean DEFAULT false NOT NULL,
	"amended_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_book_levels" (
	"id" serial PRIMARY KEY NOT NULL,
	"symbol" varchar(32) NOT NULL,
	"side" varchar(4) NOT NULL,
	"price" numeric(18, 6) NOT NULL,
	"quantity" numeric(18, 6) NOT NULL,
	"order_count" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"symbol" varchar(32) NOT NULL,
	"asset_class" "asset_class" DEFAULT 'COMMODITY' NOT NULL,
	"side" "order_side" NOT NULL,
	"order_type" "order_type" NOT NULL,
	"quantity" numeric(18, 6) NOT NULL,
	"price" numeric(18, 6),
	"stop_price" numeric(18, 6),
	"filled_qty" numeric(18, 6) DEFAULT '0' NOT NULL,
	"avg_fill_price" numeric(18, 6),
	"status" "order_status" DEFAULT 'OPEN' NOT NULL,
	"time_in_force" varchar(8) DEFAULT 'GTC' NOT NULL,
	"client_order_id" varchar(64),
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "participant_performance_metrics" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"participant_type" varchar(32) NOT NULL,
	"period_year" integer NOT NULL,
	"period_month" integer NOT NULL,
	"trade_count" integer DEFAULT 0 NOT NULL,
	"volume_usd" numeric(20, 2) DEFAULT '0' NOT NULL,
	"client_count" integer DEFAULT 0 NOT NULL,
	"avg_spread" numeric(10, 4),
	"uptime_pct" numeric(5, 2),
	"rating" numeric(3, 2),
	"compliance_score" integer DEFAULT 100,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform_settings" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"key" varchar(128) NOT NULL,
	"value" text NOT NULL,
	"description" text,
	"updated_by" integer,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "platform_settings_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "portfolio_equity_snapshots" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"snapshot_date" timestamp NOT NULL,
	"spot_pnl" numeric(20, 8) DEFAULT '0' NOT NULL,
	"futures_pnl" numeric(20, 8) DEFAULT '0' NOT NULL,
	"options_pnl" numeric(20, 8) DEFAULT '0' NOT NULL,
	"cash_balance" numeric(20, 8) DEFAULT '0' NOT NULL,
	"total_equity" numeric(20, 8) DEFAULT '0' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "portfolio_snapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"snapshot_date" timestamp NOT NULL,
	"total_value" numeric(18, 2) DEFAULT '0' NOT NULL,
	"total_cost" numeric(18, 2) DEFAULT '0' NOT NULL,
	"realized_pnl" numeric(18, 2) DEFAULT '0' NOT NULL,
	"unrealized_pnl" numeric(18, 2) DEFAULT '0' NOT NULL,
	"currency" varchar(8) DEFAULT 'NGN' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "positions" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"symbol" varchar(32) NOT NULL,
	"asset_class" "asset_class" DEFAULT 'COMMODITY' NOT NULL,
	"quantity" numeric(18, 6) DEFAULT '0' NOT NULL,
	"avg_cost" numeric(18, 6) DEFAULT '0' NOT NULL,
	"realized_pnl" numeric(18, 6) DEFAULT '0' NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pre_trade_risk_checks" (
	"id" serial PRIMARY KEY NOT NULL,
	"order_id" bigint NOT NULL,
	"user_id" integer NOT NULL,
	"symbol" varchar(32) NOT NULL,
	"check_type" varchar(32) NOT NULL,
	"passed" boolean NOT NULL,
	"required_margin" numeric(18, 6),
	"available_margin" numeric(18, 6),
	"current_position" numeric(18, 6),
	"position_limit" numeric(18, 6),
	"reject_reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "price_alerts" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"symbol" varchar(32) NOT NULL,
	"condition" "alert_condition" NOT NULL,
	"target_price" numeric(18, 6) NOT NULL,
	"triggered" boolean DEFAULT false NOT NULL,
	"notified" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "profiles" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"account_type" "account_type" DEFAULT 'TRADER' NOT NULL,
	"first_name" varchar(64),
	"last_name" varchar(64),
	"phone" varchar(20),
	"nin" varchar(20),
	"bvn" varchar(20),
	"address" text,
	"state" varchar(64),
	"country" varchar(64) DEFAULT 'Nigeria',
	"company_name" varchar(256),
	"rc_number" varchar(64),
	"tax_id" varchar(64),
	"kyc_status" "kyc_status" DEFAULT 'PENDING' NOT NULL,
	"kyc_notes" text,
	"bank_name" varchar(128),
	"bank_account" varchar(20),
	"stakeholder_type" "stakeholder_type",
	"metadata" json,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "profiles_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "push_subscriptions" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"endpoint" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"enable_price_alerts" boolean DEFAULT true NOT NULL,
	"enable_trade_fills" boolean DEFAULT true NOT NULL,
	"enable_system_alerts" boolean DEFAULT false NOT NULL,
	"user_agent" text,
	"device_label" varchar(100),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "push_subscriptions_endpoint_unique" UNIQUE("endpoint")
);
--> statement-breakpoint
CREATE TABLE "rate_limit_counters" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"action" varchar(64) NOT NULL,
	"window_start" timestamp NOT NULL,
	"count" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "re_kyc_flags" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"stakeholder_type" "re_kyc_stakeholder_type" NOT NULL,
	"profile_id" integer NOT NULL,
	"reason" text NOT NULL,
	"kyc_approved_at" timestamp,
	"notified_at" timestamp,
	"resolved_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "regulatory_report_schedules" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"report_type" varchar(64) NOT NULL,
	"asset_class" varchar(32),
	"format" varchar(8) DEFAULT 'CSV' NOT NULL,
	"frequency" varchar(32) NOT NULL,
	"day_of_week" integer,
	"day_of_month" integer,
	"time_utc" varchar(8) DEFAULT '15:00' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_run_at" timestamp,
	"next_run_at" timestamp,
	"created_by" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "regulatory_reports" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"report_type" varchar(64) NOT NULL,
	"report_date" timestamp NOT NULL,
	"period_start" timestamp NOT NULL,
	"period_end" timestamp NOT NULL,
	"asset_class" varchar(32),
	"format" varchar(8) DEFAULT 'CSV' NOT NULL,
	"status" varchar(32) DEFAULT 'PENDING' NOT NULL,
	"row_count" integer DEFAULT 0,
	"file_size" integer DEFAULT 0,
	"content" text,
	"error_message" text,
	"generated_by" integer NOT NULL,
	"schedule_id" bigint,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sar_reports" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"flag_id" bigint,
	"user_id" integer NOT NULL,
	"report_number" varchar(64) NOT NULL,
	"subject_name" varchar(256),
	"subject_id" varchar(128),
	"activity_type" varchar(128) NOT NULL,
	"activity_description" text NOT NULL,
	"total_amount" numeric(20, 2),
	"currency" varchar(8) DEFAULT 'NGN',
	"activity_start_date" timestamp,
	"activity_end_date" timestamp,
	"filed_by" integer NOT NULL,
	"filed_at" timestamp DEFAULT now() NOT NULL,
	"status" varchar(32) DEFAULT 'DRAFT' NOT NULL,
	"regulatory_ref" varchar(128),
	"exported_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "sar_reports_report_number_unique" UNIQUE("report_number")
);
--> statement-breakpoint
CREATE TABLE "saved_orders" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"name" varchar(128) NOT NULL,
	"symbol" varchar(32) NOT NULL,
	"side" "order_side" NOT NULL,
	"order_type" "order_type" NOT NULL,
	"quantity" numeric(18, 6) NOT NULL,
	"price" numeric(18, 6),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "security_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"event_type" "security_event_type" NOT NULL,
	"severity" "security_event_severity" NOT NULL,
	"status" "security_event_status" DEFAULT 'OPEN' NOT NULL,
	"title" varchar(256) NOT NULL,
	"description" text NOT NULL,
	"metadata" json,
	"ip_address" varchar(45),
	"resolved_by" integer,
	"resolved_at" timestamp,
	"resolution_notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settlement_cycles" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"cycle_date" timestamp NOT NULL,
	"settlement_type" varchar(8) DEFAULT 'T+1' NOT NULL,
	"asset_class" varchar(32) DEFAULT 'COMMODITY' NOT NULL,
	"status" varchar(32) DEFAULT 'OPEN' NOT NULL,
	"total_trades" integer DEFAULT 0,
	"matched_trades" integer DEFAULT 0,
	"failed_trades" integer DEFAULT 0,
	"gross_value" numeric(24, 2) DEFAULT '0',
	"net_value" numeric(24, 2) DEFAULT '0',
	"currency" varchar(8) DEFAULT 'NGN',
	"created_by" integer NOT NULL,
	"opened_at" timestamp DEFAULT now() NOT NULL,
	"matched_at" timestamp,
	"settled_at" timestamp,
	"closed_at" timestamp,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settlement_disputes" (
	"id" serial PRIMARY KEY NOT NULL,
	"settlement_id" bigint NOT NULL,
	"raised_by" integer NOT NULL,
	"assigned_to" integer,
	"status" "dispute_status" DEFAULT 'OPEN' NOT NULL,
	"reason" text NOT NULL,
	"evidence" text,
	"resolution" "dispute_resolution",
	"resolution_notes" text,
	"resolved_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"resolved_at" timestamp,
	"sla_deadline" timestamp,
	"sla_breached" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settlement_fails" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"instruction_id" bigint NOT NULL,
	"cycle_id" bigint NOT NULL,
	"fail_type" varchar(32) NOT NULL,
	"failed_party_user_id" integer NOT NULL,
	"penalty_amount" numeric(20, 2) DEFAULT '0',
	"currency" varchar(8) DEFAULT 'NGN',
	"status" varchar(32) DEFAULT 'OPEN' NOT NULL,
	"escalated_to" varchar(128),
	"escalated_at" timestamp,
	"resolved_at" timestamp,
	"resolution_notes" text,
	"reviewed_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settlement_instructions" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"cycle_id" bigint NOT NULL,
	"buyer_user_id" integer NOT NULL,
	"seller_user_id" integer NOT NULL,
	"order_id" bigint,
	"instrument" varchar(64) NOT NULL,
	"quantity" numeric(20, 6) NOT NULL,
	"price" numeric(20, 6) NOT NULL,
	"total_value" numeric(20, 2) NOT NULL,
	"currency" varchar(8) DEFAULT 'NGN',
	"instruction_type" varchar(16) DEFAULT 'DVP' NOT NULL,
	"status" varchar(32) DEFAULT 'PENDING' NOT NULL,
	"failure_reason" text,
	"confirmed_at" timestamp,
	"settled_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settlement_positions" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"cycle_id" bigint NOT NULL,
	"user_id" integer NOT NULL,
	"instrument" varchar(64) NOT NULL,
	"gross_buy_qty" numeric(20, 6) DEFAULT '0',
	"gross_sell_qty" numeric(20, 6) DEFAULT '0',
	"net_qty" numeric(20, 6) DEFAULT '0',
	"gross_buy_value" numeric(20, 2) DEFAULT '0',
	"gross_sell_value" numeric(20, 2) DEFAULT '0',
	"net_cash_obligation" numeric(20, 2) DEFAULT '0',
	"currency" varchar(8) DEFAULT 'NGN',
	"status" varchar(32) DEFAULT 'PENDING' NOT NULL,
	"confirmed_at" timestamp,
	"settled_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settlements" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"order_id" bigint NOT NULL,
	"user_id" integer NOT NULL,
	"symbol" varchar(32) NOT NULL,
	"asset_class" "asset_class" DEFAULT 'COMMODITY' NOT NULL,
	"side" "order_side" NOT NULL,
	"quantity" numeric(18, 6) NOT NULL,
	"price" numeric(18, 6) NOT NULL,
	"gross_amount" numeric(18, 2) NOT NULL,
	"fee" numeric(18, 2) DEFAULT '0' NOT NULL,
	"net_amount" numeric(18, 2) NOT NULL,
	"currency" varchar(8) DEFAULT 'NGN' NOT NULL,
	"status" "settlement_status" DEFAULT 'PENDING' NOT NULL,
	"settlement_date" timestamp,
	"counterparty_id" integer,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shareholder_registry" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"company_symbol" varchar(16) NOT NULL,
	"user_id" integer NOT NULL,
	"shareholder_name" varchar(128) NOT NULL,
	"shareholder_type" varchar(32) DEFAULT 'INDIVIDUAL' NOT NULL,
	"shares_held" numeric(20, 0) NOT NULL,
	"total_shares" numeric(20, 0) NOT NULL,
	"holding_pct" numeric(10, 6) NOT NULL,
	"acquisition_date" timestamp,
	"last_updated_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "totp_secrets" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"secret" varchar(64) NOT NULL,
	"is_enabled" boolean DEFAULT false NOT NULL,
	"confirmed_at" timestamp,
	"backup_codes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "totp_secrets_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "trade_fills" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"aggressor_order_id" bigint NOT NULL,
	"resting_order_id" bigint NOT NULL,
	"symbol" varchar(32) NOT NULL,
	"asset_class" varchar(32) NOT NULL,
	"buyer_user_id" integer NOT NULL,
	"seller_user_id" integer NOT NULL,
	"filled_qty" numeric(18, 6) NOT NULL,
	"fill_price" numeric(18, 6) NOT NULL,
	"gross_value" numeric(18, 6) NOT NULL,
	"buyer_fee" numeric(18, 6) DEFAULT '0' NOT NULL,
	"seller_fee" numeric(18, 6) DEFAULT '0' NOT NULL,
	"settlement_id" bigint,
	"sequence_no" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trader_profiles" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"full_name" varchar(200) NOT NULL,
	"phone" varchar(30) NOT NULL,
	"nin" varchar(50),
	"bvn" varchar(50),
	"email" varchar(200),
	"address" text,
	"state" varchar(100),
	"lga" varchar(100),
	"trading_experience" "trader_experience" DEFAULT 'BEGINNER' NOT NULL,
	"preferred_markets" text[],
	"capital_range" varchar(50),
	"risk_profile" "trader_risk_profile" DEFAULT 'MODERATE' NOT NULL,
	"id_document_url" text,
	"proof_of_address_url" text,
	"bank_statement_url" text,
	"bank_name" varchar(200),
	"account_number" varchar(30),
	"kyc_status" "trader_kyc_status" DEFAULT 'PENDING' NOT NULL,
	"kyc_notes" text,
	"account_status" "trader_account_status" DEFAULT 'INACTIVE' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "trader_profiles_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "user_mfa_settings" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"mfa_required" boolean DEFAULT false NOT NULL,
	"primary_method" "mfa_method",
	"totp_enabled" boolean DEFAULT false NOT NULL,
	"webauthn_enabled" boolean DEFAULT false NOT NULL,
	"sms_enabled" boolean DEFAULT false NOT NULL,
	"email_otp_enabled" boolean DEFAULT false NOT NULL,
	"phone_number" varchar(20),
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_mfa_settings_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "user_preferences" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"currency" varchar(8) DEFAULT 'NGN' NOT NULL,
	"language" varchar(16) DEFAULT 'en' NOT NULL,
	"theme" varchar(16) DEFAULT 'dark' NOT NULL,
	"timezone" varchar(64) DEFAULT 'Africa/Lagos' NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"notif_trade_executions" boolean DEFAULT true NOT NULL,
	"notif_price_alerts" boolean DEFAULT true NOT NULL,
	"notif_ewr_updates" boolean DEFAULT true NOT NULL,
	"notif_deposit_updates" boolean DEFAULT true NOT NULL,
	"notif_delivery_updates" boolean DEFAULT true NOT NULL,
	"notif_system_messages" boolean DEFAULT false NOT NULL,
	"notif_email" boolean DEFAULT true NOT NULL,
	"notif_sms" boolean DEFAULT false NOT NULL,
	"notif_push" boolean DEFAULT true NOT NULL,
	CONSTRAINT "user_preferences_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"open_id" varchar(64) NOT NULL,
	"name" text,
	"email" varchar(320),
	"login_method" varchar(64),
	"role" "role" DEFAULT 'user' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"last_signed_in" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_open_id_unique" UNIQUE("open_id")
);
--> statement-breakpoint
CREATE TABLE "velocity_ledger" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"amount" numeric(20, 2) NOT NULL,
	"currency" varchar(8) DEFAULT 'NGN' NOT NULL,
	"reference" varchar(128),
	"recorded_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "velocity_limit_config" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"window_hours" integer DEFAULT 24 NOT NULL,
	"max_amount" numeric(20, 2) NOT NULL,
	"currency" varchar(8) DEFAULT 'NGN' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "warehouse_messages" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"warehouse_id" varchar(50) NOT NULL,
	"warehouse_name" varchar(200) NOT NULL,
	"subject" varchar(300) NOT NULL,
	"body" text NOT NULL,
	"status" "warehouse_message_status" DEFAULT 'SENT' NOT NULL,
	"reply_body" text,
	"replied_at" timestamp,
	"read_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "warehouse_operator_profiles" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"facility_name" varchar(200) NOT NULL,
	"facility_address" text NOT NULL,
	"state" varchar(100) NOT NULL,
	"lga" varchar(100),
	"gps_lat" numeric(10, 7),
	"gps_lng" numeric(10, 7),
	"storage_capacity_mt" numeric(12, 2),
	"commodities_handled" text[],
	"nwr_cert_number" varchar(100),
	"nwr_cert_doc_url" text,
	"facility_inspection_url" text,
	"insurance_doc_url" text,
	"grading_staff_count" integer,
	"operating_hours" varchar(100),
	"accepted_grades" text[],
	"kyc_status" "warehouse_op_kyc_status" DEFAULT 'PENDING' NOT NULL,
	"kyc_notes" text,
	"account_status" "warehouse_op_account_status" DEFAULT 'INACTIVE' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "warehouse_operator_profiles_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "warehouse_receipts" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"receipt_number" varchar(64) NOT NULL,
	"commodity" varchar(64) NOT NULL,
	"grade" varchar(32),
	"quantity" numeric(18, 6) NOT NULL,
	"unit" varchar(16) NOT NULL,
	"warehouse_id" varchar(64),
	"warehouse_name" varchar(256),
	"deposit_date" timestamp DEFAULT now() NOT NULL,
	"expiry_date" timestamp,
	"status" "warehouse_receipt_status" DEFAULT 'ACTIVE' NOT NULL,
	"value_usd" numeric(18, 2),
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "warehouse_receipts_receipt_number_unique" UNIQUE("receipt_number")
);
--> statement-breakpoint
CREATE TABLE "wash_trade_flags" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"instrument" varchar(32) NOT NULL,
	"asset_class" varchar(32) NOT NULL,
	"buy_order_id" bigint,
	"sell_order_id" bigint,
	"buy_price" numeric(20, 8),
	"sell_price" numeric(20, 8),
	"quantity" numeric(20, 8),
	"window_minutes" integer NOT NULL,
	"detected_at" timestamp DEFAULT now() NOT NULL,
	"status" varchar(16) DEFAULT 'PENDING' NOT NULL,
	"reviewed_by" integer,
	"reviewed_at" timestamp,
	"review_notes" text,
	"penalty_applied" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "watchlist" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"symbol" varchar(32) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webauthn_challenges" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"challenge" text NOT NULL,
	"type" varchar(16) NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webauthn_credentials" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"credential_id" text NOT NULL,
	"public_key" text NOT NULL,
	"sign_count" integer DEFAULT 0 NOT NULL,
	"device_name" varchar(128) DEFAULT 'Passkey' NOT NULL,
	"aaguid" varchar(36),
	"uv_capable" boolean DEFAULT false NOT NULL,
	"resident_key" boolean DEFAULT false NOT NULL,
	"transports" text,
	"last_used_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "webauthn_credentials_credential_id_unique" UNIQUE("credential_id")
);
--> statement-breakpoint
CREATE TABLE "webhook_configs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"name" varchar(128) NOT NULL,
	"url" varchar(2048) NOT NULL,
	"secret" varchar(256),
	"event_filter" "webhook_event_filter" DEFAULT 'HIGH_AND_CRITICAL' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_triggered_at" timestamp,
	"last_status_code" integer,
	"failure_count" integer DEFAULT 0 NOT NULL,
	"created_by" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "withdrawal_verifications" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"amount" numeric(18, 2) NOT NULL,
	"challenge_text" varchar(512) NOT NULL,
	"expected_answer" varchar(512) NOT NULL,
	"status" "withdrawal_verification_status" DEFAULT 'PENDING' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"verified_at" timestamp,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "fee_schedule_tier_currency_idx" ON "mojaloop_fee_schedules" USING btree ("tier_name","currency");