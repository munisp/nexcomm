DO $$ BEGIN
  CREATE TYPE "public"."option_position_status" AS ENUM('OPEN', 'EXERCISED', 'EXPIRED', 'CLOSED');--> statement-breakpoint
CREATE TYPE "public"."option_status" AS ENUM('ACTIVE', 'EXPIRED', 'SETTLED');--> statement-breakpoint
CREATE TYPE "public"."option_type" AS ENUM('CALL', 'PUT');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "options_contracts" (
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
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "options_positions" (
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
