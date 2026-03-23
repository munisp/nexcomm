CREATE TABLE IF NOT EXISTS "order_book_levels" (
	"id" serial PRIMARY KEY NOT NULL,
	"symbol" varchar(32) NOT NULL,
	"side" varchar(4) NOT NULL,
	"price" numeric(18, 6) NOT NULL,
	"quantity" numeric(18, 6) NOT NULL,
	"order_count" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pre_trade_risk_checks" (
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
CREATE TABLE IF NOT EXISTS "trade_fills" (
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
