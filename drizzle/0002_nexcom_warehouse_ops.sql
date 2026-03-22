-- Migration: warehouse_receipts, deposit_requests, delivery_orders, api_keys
-- Created manually to match schema.ts definitions

DO $$ BEGIN
  CREATE TYPE "warehouse_receipt_status" AS ENUM('ACTIVE', 'PLEDGED', 'REDEEMED', 'CANCELLED');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "deposit_status" AS ENUM('PENDING', 'RECEIVED', 'GRADED', 'STORED', 'REJECTED');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "delivery_status" AS ENUM('PENDING', 'SCHEDULED', 'IN_TRANSIT', 'DELIVERED', 'CANCELLED');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS "warehouse_receipts" (
  "id" serial PRIMARY KEY NOT NULL,
  "user_id" integer NOT NULL,
  "receipt_number" varchar(64) NOT NULL UNIQUE,
  "commodity" varchar(64) NOT NULL,
  "grade" varchar(32),
  "quantity" numeric(18, 6) NOT NULL,
  "unit" varchar(16) NOT NULL,
  "warehouse_id" varchar(64),
  "warehouse_name" varchar(256),
  "deposit_date" timestamp DEFAULT now() NOT NULL,
  "expiry_date" timestamp,
  "status" "warehouse_receipt_status" DEFAULT 'ACTIVE' NOT NULL,
  "value_usd" numeric(18, 2),
  "notes" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "deposit_requests" (
  "id" serial PRIMARY KEY NOT NULL,
  "user_id" integer NOT NULL,
  "commodity" varchar(64) NOT NULL,
  "grade" varchar(32),
  "quantity" numeric(18, 6) NOT NULL,
  "unit" varchar(16) NOT NULL,
  "warehouse_id" varchar(64),
  "warehouse_name" varchar(256),
  "expected_date" timestamp,
  "status" "deposit_status" DEFAULT 'PENDING' NOT NULL,
  "notes" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "delivery_orders" (
  "id" serial PRIMARY KEY NOT NULL,
  "user_id" integer NOT NULL,
  "receipt_id" integer,
  "commodity" varchar(64) NOT NULL,
  "quantity" numeric(18, 6) NOT NULL,
  "unit" varchar(16) NOT NULL,
  "delivery_address" text NOT NULL,
  "scheduled_date" timestamp,
  "status" "delivery_status" DEFAULT 'PENDING' NOT NULL,
  "notes" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "api_keys" (
  "id" serial PRIMARY KEY NOT NULL,
  "user_id" integer NOT NULL,
  "name" varchar(128) NOT NULL,
  "key_hash" varchar(256) NOT NULL,
  "key_prefix" varchar(16) NOT NULL,
  "permissions" text[] NOT NULL DEFAULT '{}',
  "active" boolean DEFAULT true NOT NULL,
  "last_used_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "expires_at" timestamp
);
