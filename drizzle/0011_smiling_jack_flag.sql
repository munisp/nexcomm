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
