CREATE TYPE "public"."bank_account_status" AS ENUM('ACTIVE', 'DORMANT', 'FROZEN', 'CLOSED');--> statement-breakpoint
CREATE TYPE "public"."bank_account_type" AS ENUM('ESCROW', 'SETTLEMENT', 'SAVINGS', 'CURRENT', 'MARGIN');--> statement-breakpoint
CREATE TYPE "public"."bank_transaction_type" AS ENUM('CREDIT', 'DEBIT', 'REVERSAL', 'FEE', 'INTEREST');--> statement-breakpoint
CREATE TABLE "bank_accounts" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"account_ref" varchar(50) NOT NULL,
	"type" "bank_account_type" DEFAULT 'ESCROW' NOT NULL,
	"label" varchar(100) NOT NULL,
	"currency" varchar(10) DEFAULT 'NGN' NOT NULL,
	"balance_kobo" bigint DEFAULT 0 NOT NULL,
	"avail_balance_kobo" bigint DEFAULT 0 NOT NULL,
	"status" "bank_account_status" DEFAULT 'ACTIVE' NOT NULL,
	"cbs_account_id" varchar(100),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "bank_accounts_account_ref_unique" UNIQUE("account_ref")
);
--> statement-breakpoint
CREATE TABLE "bank_transactions" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"account_id" bigint NOT NULL,
	"user_id" integer NOT NULL,
	"type" "bank_transaction_type" NOT NULL,
	"amount_kobo" bigint NOT NULL,
	"balance_after_kobo" bigint NOT NULL,
	"currency" varchar(10) DEFAULT 'NGN' NOT NULL,
	"narrative" text,
	"reference" varchar(100),
	"value_date" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
