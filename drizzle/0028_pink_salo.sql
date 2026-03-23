DO $$ BEGIN
  CREATE TYPE "public"."mfa_method" AS ENUM('totp', 'webauthn', 'sms', 'email_otp');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "mfa_otp_codes" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"method" "mfa_method" NOT NULL,
	"code_hash" varchar(64) NOT NULL,
	"expires_at" timestamp NOT NULL,
	"used_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user_mfa_settings" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"mfa_required" boolean DEFAULT false NOT NULL,
	"primary_method" "mfa_method",
	"totp_enabled" boolean DEFAULT false NOT NULL,
	"webauthn_enabled" boolean DEFAULT false NOT NULL,
	"sms_enabled" boolean DEFAULT false NOT NULL,
	"email_otp_enabled" boolean DEFAULT false NOT NULL,
	"phone_number" varchar(20),
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_mfa_settings_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "webauthn_challenges" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"challenge" text NOT NULL,
	"type" varchar(16) NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "webauthn_credentials" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"credential_id" text NOT NULL,
	"public_key" text NOT NULL,
	"sign_count" integer DEFAULT 0 NOT NULL,
	"device_name" varchar(128) DEFAULT 'Passkey' NOT NULL,
	"aaguid" varchar(36),
	"uv_capable" boolean DEFAULT false NOT NULL,
	"resident_key" boolean DEFAULT false NOT NULL,
	"transports" text,
	"last_used_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "webauthn_credentials_credential_id_unique" UNIQUE("credential_id")
);
