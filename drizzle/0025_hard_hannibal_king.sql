CREATE TYPE "public"."dfsp_tier" AS ENUM('STANDARD', 'PREMIUM', 'INSTITUTIONAL', 'CORRESPONDENT');--> statement-breakpoint
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
CREATE UNIQUE INDEX "fee_schedule_tier_currency_idx" ON "mojaloop_fee_schedules" USING btree ("tier_name","currency");