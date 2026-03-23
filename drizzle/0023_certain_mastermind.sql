DO $$ BEGIN
  CREATE TYPE "public"."mojaloop_quote_status" AS ENUM('PENDING', 'ACCEPTED', 'REJECTED', 'EXPIRED');--> statement-breakpoint
CREATE TYPE "public"."mojaloop_transfer_status" AS ENUM('PENDING', 'RESERVED', 'COMMITTED', 'ABORTED', 'EXPIRED');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "mojaloop_callbacks" (
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
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "mojaloop_dfsps" (
	"id" serial PRIMARY KEY NOT NULL,
	"fsp_id" varchar(64) NOT NULL,
	"name" varchar(128) NOT NULL,
	"country" varchar(4),
	"currencies" json DEFAULT '[]'::json,
	"is_active" boolean DEFAULT true NOT NULL,
	"endpoint_url" varchar(256),
	"callback_url" varchar(256),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "mojaloop_dfsps_fsp_id_unique" UNIQUE("fsp_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "mojaloop_parties" (
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
CREATE TABLE IF NOT EXISTS "mojaloop_quotes" (
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
CREATE TABLE IF NOT EXISTS "mojaloop_transfers" (
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
