CREATE TABLE IF NOT EXISTS "device_sessions" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"fingerprint" varchar(128) NOT NULL,
	"user_agent" text,
	"ip_address" varchar(64),
	"timezone" varchar(64),
	"screen_resolution" varchar(32),
	"is_known" boolean DEFAULT false NOT NULL,
	"is_trusted" boolean DEFAULT false NOT NULL,
	"last_seen_at" timestamp DEFAULT now() NOT NULL,
	"first_seen_at" timestamp DEFAULT now() NOT NULL,
	"revoked_at" timestamp
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "totp_secrets" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"secret" varchar(64) NOT NULL,
	"is_enabled" boolean DEFAULT false NOT NULL,
	"confirmed_at" timestamp,
	"backup_codes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "totp_secrets_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "velocity_ledger" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"amount" numeric(20, 2) NOT NULL,
	"currency" varchar(8) DEFAULT 'NGN' NOT NULL,
	"reference" varchar(128),
	"recorded_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "velocity_limit_config" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"window_hours" integer DEFAULT 24 NOT NULL,
	"max_amount" numeric(20, 2) NOT NULL,
	"currency" varchar(8) DEFAULT 'NGN' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
