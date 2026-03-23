CREATE TABLE IF NOT EXISTS "aml_flags" (
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
CREATE TABLE IF NOT EXISTS "aml_rules" (
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
CREATE TABLE IF NOT EXISTS "compliance_exports" (
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
CREATE TABLE IF NOT EXISTS "sar_reports" (
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
CREATE TABLE IF NOT EXISTS "settlement_cycles" (
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
CREATE TABLE IF NOT EXISTS "settlement_fails" (
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
CREATE TABLE IF NOT EXISTS "settlement_instructions" (
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
CREATE TABLE IF NOT EXISTS "settlement_positions" (
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
