CREATE TABLE IF NOT EXISTS "futures_contracts" (
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
CREATE TABLE IF NOT EXISTS "futures_positions" (
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
CREATE TABLE IF NOT EXISTS "futures_settlements" (
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
CREATE TABLE IF NOT EXISTS "open_interest_snapshots" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"contract_id" integer NOT NULL,
	"snapshot_date" timestamp DEFAULT now() NOT NULL,
	"total_long_qty" numeric(18, 6) DEFAULT '0' NOT NULL,
	"total_short_qty" numeric(18, 6) DEFAULT '0' NOT NULL,
	"open_interest" numeric(18, 6) DEFAULT '0' NOT NULL,
	"daily_volume" numeric(18, 6) DEFAULT '0' NOT NULL,
	"settlement_price" numeric(20, 8)
);
