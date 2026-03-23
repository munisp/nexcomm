ALTER TYPE "public"."notification_type" ADD VALUE 'MARGIN_CALL';--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "dispute_evidence" (
	"id" serial PRIMARY KEY NOT NULL,
	"dispute_id" integer NOT NULL,
	"uploaded_by" integer NOT NULL,
	"file_key" varchar(512) NOT NULL,
	"file_url" text NOT NULL,
	"file_name" varchar(256) NOT NULL,
	"mime_type" varchar(128) NOT NULL,
	"file_size" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "margin_accounts" ADD COLUMN "last_margin_call_at" timestamp;