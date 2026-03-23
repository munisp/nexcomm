DO $$ BEGIN
  CREATE TYPE "public"."asset_class" AS ENUM('COMMODITY', 'FOREX', 'EQUITY', 'DIGITAL_ASSET', 'INDEX');--> statement-breakpoint
CREATE TYPE "public"."order_status" AS ENUM('OPEN', 'PARTIALLY_FILLED', 'FILLED', 'CANCELLED', 'REJECTED', 'EXPIRED');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "orders" (
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
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "positions" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"symbol" varchar(32) NOT NULL,
	"asset_class" "asset_class" DEFAULT 'COMMODITY' NOT NULL,
	"quantity" numeric(18, 6) DEFAULT '0' NOT NULL,
	"avg_cost" numeric(18, 6) DEFAULT '0' NOT NULL,
	"realized_pnl" numeric(18, 6) DEFAULT '0' NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
