CREATE TYPE "public"."broker_client_status" AS ENUM('ACTIVE', 'INACTIVE', 'SUSPENDED');--> statement-breakpoint
CREATE TYPE "public"."broker_commission_status" AS ENUM('PENDING', 'PAID', 'CANCELLED');--> statement-breakpoint
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
