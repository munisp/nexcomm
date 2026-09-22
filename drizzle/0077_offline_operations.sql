-- Migration: 0077_offline_operations (INNOV-C)
-- Durable idempotency ledger for PWA offline order queue replay.
-- Journal entry snippet is in nexcomm-fixes/INNOV-C/MANIFEST.md (idx 76).
CREATE TABLE IF NOT EXISTS "offline_operations" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"idempotency_key" text NOT NULL,
	"operation_type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"result" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"processed_at" timestamp
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "offline_operations" ADD CONSTRAINT "offline_operations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "offline_operations_idempotency_key_unique" ON "offline_operations" USING btree ("idempotency_key" text_ops);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "offline_operations_user_idx" ON "offline_operations" USING btree ("user_id" int4_ops);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "offline_operations_status_idx" ON "offline_operations" USING btree ("status" text_ops);
