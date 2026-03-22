CREATE TYPE "public"."account_type" AS ENUM('FARMER', 'TRADER', 'PROCESSOR', 'BROKER');--> statement-breakpoint
CREATE TYPE "public"."alert_condition" AS ENUM('ABOVE', 'BELOW');--> statement-breakpoint
CREATE TYPE "public"."kyc_queue_status" AS ENUM('PENDING', 'UNDER_REVIEW', 'APPROVED', 'REJECTED');--> statement-breakpoint
CREATE TYPE "public"."kyc_status" AS ENUM('PENDING', 'VERIFIED', 'REJECTED');--> statement-breakpoint
CREATE TYPE "public"."notification_type" AS ENUM('TRADE', 'SETTLEMENT', 'KYC', 'ALERT', 'SYSTEM');--> statement-breakpoint
CREATE TYPE "public"."order_side" AS ENUM('BUY', 'SELL');--> statement-breakpoint
CREATE TYPE "public"."order_type" AS ENUM('LIMIT', 'MARKET', 'STOP_LIMIT');--> statement-breakpoint
CREATE TYPE "public"."role" AS ENUM('user', 'admin', 'farmer', 'trader', 'broker');--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"action" varchar(128) NOT NULL,
	"resource" varchar(128),
	"resource_id" varchar(64),
	"details" json,
	"ip_address" varchar(45),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kyc_queue" (
	"id" serial PRIMARY KEY NOT NULL,
	"profile_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"status" "kyc_queue_status" DEFAULT 'PENDING' NOT NULL,
	"reviewed_by" integer,
	"review_notes" text,
	"submitted_at" timestamp DEFAULT now() NOT NULL,
	"reviewed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"title" varchar(256) NOT NULL,
	"message" text NOT NULL,
	"type" "notification_type" DEFAULT 'SYSTEM' NOT NULL,
	"read" boolean DEFAULT false NOT NULL,
	"metadata" json,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "price_alerts" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"symbol" varchar(32) NOT NULL,
	"condition" "alert_condition" NOT NULL,
	"target_price" numeric(18, 6) NOT NULL,
	"triggered" boolean DEFAULT false NOT NULL,
	"notified" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "profiles" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"account_type" "account_type" NOT NULL,
	"phone" varchar(20),
	"nin" varchar(20),
	"bvn" varchar(20),
	"state" varchar(64),
	"country" varchar(64) DEFAULT 'Nigeria',
	"kyc_status" "kyc_status" DEFAULT 'PENDING' NOT NULL,
	"kyc_notes" text,
	"bank_name" varchar(128),
	"bank_account" varchar(20),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "saved_orders" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"name" varchar(128) NOT NULL,
	"symbol" varchar(32) NOT NULL,
	"side" "order_side" NOT NULL,
	"order_type" "order_type" NOT NULL,
	"quantity" numeric(18, 6) NOT NULL,
	"price" numeric(18, 6),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"open_id" varchar(64) NOT NULL,
	"name" text,
	"email" varchar(320),
	"login_method" varchar(64),
	"role" "role" DEFAULT 'user' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"last_signed_in" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_open_id_unique" UNIQUE("open_id")
);
--> statement-breakpoint
CREATE TABLE "watchlist" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"symbol" varchar(32) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
