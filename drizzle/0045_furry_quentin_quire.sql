CREATE TYPE "public"."stripe_payment_status" AS ENUM('PENDING', 'SUCCEEDED', 'FAILED', 'CANCELED', 'REFUNDED');--> statement-breakpoint
CREATE TYPE "public"."stripe_payment_type" AS ENUM('DEPOSIT', 'WITHDRAWAL');--> statement-breakpoint
CREATE TABLE "stripe_payments" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"stripe_payment_intent_id" varchar(128),
	"stripe_checkout_session_id" varchar(128),
	"type" "stripe_payment_type" DEFAULT 'DEPOSIT' NOT NULL,
	"amount_cents" integer NOT NULL,
	"currency" varchar(10) DEFAULT 'usd' NOT NULL,
	"status" "stripe_payment_status" DEFAULT 'PENDING' NOT NULL,
	"bank_transaction_id" bigint,
	"metadata" json,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "stripe_payments_stripe_payment_intent_id_unique" UNIQUE("stripe_payment_intent_id"),
	CONSTRAINT "stripe_payments_stripe_checkout_session_id_unique" UNIQUE("stripe_checkout_session_id")
);
