/**
 * create_missing_tables.ts
 * Creates missing tables in the nexcom database by applying the schema directly.
 * Run with: npx tsx scripts/create_missing_tables.ts
 */
import postgres from "postgres";

const url = process.env.NEXCOM_PG_URL ?? "postgresql://nexcom:nexcom_secure_2026@127.0.0.1:5432/nexcom";
const sql = postgres(url, { max: 1 });

const missingTablesSql = `
-- mfa_otp_codes
CREATE TABLE IF NOT EXISTS "mfa_otp_codes" (
  "id" serial PRIMARY KEY NOT NULL,
  "user_id" integer NOT NULL,
  "method" varchar(32) NOT NULL,
  "code_hash" varchar(128) NOT NULL,
  "expires_at" timestamp NOT NULL,
  "used" boolean DEFAULT false NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);

-- kyc_audit_log
CREATE TABLE IF NOT EXISTS "kyc_audit_log" (
  "id" bigserial PRIMARY KEY NOT NULL,
  "user_id" integer,
  "action" varchar(128) NOT NULL,
  "entity_type" varchar(64),
  "entity_id" varchar(64),
  "old_status" varchar(64),
  "new_status" varchar(64),
  "performed_by" integer,
  "notes" text,
  "ip_address" varchar(45),
  "created_at" timestamp DEFAULT now() NOT NULL
);

-- ip_allowlist (if not exists)
DO $$ BEGIN
  CREATE TYPE "ip_allowlist_scope" AS ENUM('GLOBAL', 'USER', 'ADMIN');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "ip_allowlist" (
  "id" serial PRIMARY KEY NOT NULL,
  "user_id" integer,
  "ip_address" varchar(45) NOT NULL,
  "scope" "ip_allowlist_scope" DEFAULT 'USER' NOT NULL,
  "label" varchar(128),
  "created_at" timestamp DEFAULT now() NOT NULL,
  "expires_at" timestamp
);

-- collateral_items
DO $$ BEGIN
  CREATE TYPE "collateral_type" AS ENUM('WAREHOUSE_RECEIPT', 'CASH', 'BOND', 'EQUITY', 'COMMODITY');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "collateral_status" AS ENUM('PENDING', 'ACTIVE', 'RELEASED', 'LIQUIDATED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "collateral_items" (
  "id" serial PRIMARY KEY NOT NULL,
  "user_id" integer NOT NULL,
  "type" "collateral_type" NOT NULL,
  "status" "collateral_status" DEFAULT 'PENDING' NOT NULL,
  "reference_id" varchar(128),
  "description" text,
  "quantity" numeric(18,6),
  "unit" varchar(32),
  "value_usd" numeric(18,2),
  "haircut_pct" numeric(5,2) DEFAULT '0',
  "net_value_usd" numeric(18,2),
  "pledged_at" timestamp,
  "released_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

-- auto_liquidation_orders
DO $$ BEGIN
  CREATE TYPE "auto_liquidation_status" AS ENUM('PENDING', 'EXECUTED', 'CANCELLED', 'FAILED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "auto_liquidation_orders" (
  "id" bigserial PRIMARY KEY NOT NULL,
  "user_id" integer NOT NULL,
  "trigger_event" varchar(128),
  "status" "auto_liquidation_status" DEFAULT 'PENDING' NOT NULL,
  "collateral_item_id" integer,
  "quantity" numeric(18,6),
  "commodity" varchar(64),
  "estimated_value_usd" numeric(18,2),
  "executed_value_usd" numeric(18,2),
  "notes" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "executed_at" timestamp
);

-- options_contracts
DO $$ BEGIN
  CREATE TYPE "option_type" AS ENUM('CALL', 'PUT');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "option_style" AS ENUM('EUROPEAN', 'AMERICAN');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "option_status" AS ENUM('ACTIVE', 'EXERCISED', 'EXPIRED', 'CANCELLED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "options_contracts" (
  "id" bigserial PRIMARY KEY NOT NULL,
  "underlying_commodity" varchar(64) NOT NULL,
  "option_type" "option_type" NOT NULL,
  "option_style" "option_style" DEFAULT 'EUROPEAN' NOT NULL,
  "strike_price" numeric(18,6) NOT NULL,
  "expiry_date" timestamp NOT NULL,
  "contract_size" numeric(18,6) NOT NULL,
  "premium" numeric(18,6),
  "status" "option_status" DEFAULT 'ACTIVE' NOT NULL,
  "created_by" integer,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  "delta" numeric(10,6),
  "gamma" numeric(10,6),
  "theta" numeric(10,6),
  "vega" numeric(10,6),
  "implied_volatility" numeric(10,6),
  "open_interest" integer DEFAULT 0,
  "volume" integer DEFAULT 0
);

-- crop_listings
DO $$ BEGIN
  CREATE TYPE "listing_status" AS ENUM('DRAFT', 'ACTIVE', 'SOLD', 'EXPIRED', 'CANCELLED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "crop_listings" (
  "id" bigserial PRIMARY KEY NOT NULL,
  "farmer_id" integer NOT NULL,
  "commodity" varchar(64) NOT NULL,
  "variety" varchar(128),
  "quantity_kg" numeric(18,2) NOT NULL,
  "available_kg" numeric(18,2) NOT NULL,
  "price_per_kg" numeric(18,6) NOT NULL,
  "currency" varchar(8) DEFAULT 'USD' NOT NULL,
  "harvest_date" timestamp,
  "location" varchar(256),
  "warehouse_id" integer,
  "status" "listing_status" DEFAULT 'DRAFT' NOT NULL,
  "description" text,
  "images" json,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  "expires_at" timestamp
);

-- broker_profiles
DO $$ BEGIN
  CREATE TYPE "broker_status" AS ENUM('PENDING', 'ACTIVE', 'SUSPENDED', 'REVOKED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "broker_profiles" (
  "id" serial PRIMARY KEY NOT NULL,
  "user_id" integer NOT NULL UNIQUE,
  "company_name" varchar(256),
  "license_number" varchar(128),
  "license_expiry" timestamp,
  "status" "broker_status" DEFAULT 'PENDING' NOT NULL,
  "commission_rate" numeric(5,4) DEFAULT '0.0025',
  "max_clients" integer DEFAULT 100,
  "current_clients" integer DEFAULT 0,
  "kyc_verified" boolean DEFAULT false NOT NULL,
  "aml_cleared" boolean DEFAULT false NOT NULL,
  "regulatory_body" varchar(128),
  "country" varchar(64),
  "phone" varchar(32),
  "address" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  "approved_by" integer,
  "approved_at" timestamp,
  "notes" text,
  "tier" varchar(32) DEFAULT 'STANDARD',
  "max_order_value_usd" numeric(18,2) DEFAULT '1000000'
);

-- farm_profiles centroid column (if missing)
ALTER TABLE "farm_profiles" ADD COLUMN IF NOT EXISTS "centroid" json;
ALTER TABLE "farm_profiles" ADD COLUMN IF NOT EXISTS "geom" text;
`;

async function main() {
  try {
    console.log("Creating missing tables...");
    // Execute each statement separately
    const statements = missingTablesSql
      .split(";")
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && !s.startsWith("--"));

    for (const stmt of statements) {
      try {
        await sql.unsafe(stmt + ";");
        console.log("✓ Applied:", stmt.substring(0, 60).replace(/\n/g, " "));
      } catch (e: any) {
        if (e.message?.includes("already exists") || e.code === "42P07" || e.code === "42701") {
          console.log("  (already exists, skipping)");
        } else {
          console.error("✗ Error:", e.message?.substring(0, 100));
        }
      }
    }
    console.log("\nDone!");
  } finally {
    await sql.end();
  }
}

main().catch(console.error);
