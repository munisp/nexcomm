CREATE TABLE IF NOT EXISTS "circuit_breaker_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"rule_id" integer NOT NULL,
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
CREATE TABLE IF NOT EXISTS "circuit_breaker_rules" (
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
CREATE TABLE IF NOT EXISTS "wash_trade_flags" (
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
