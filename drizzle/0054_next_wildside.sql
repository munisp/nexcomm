CREATE TYPE "public"."liveness_session_status" AS ENUM('PENDING', 'COMPLETE', 'EXPIRED', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."spoof_type" AS ENUM('NONE', 'PRINTED_PHOTO', 'SCREEN_REPLAY', 'PAPER_MASK', '3D_MASK', 'DEEPFAKE', 'HIGH_QUALITY_PHOTO', 'UNKNOWN');--> statement-breakpoint
ALTER TYPE "public"."collateral_type" ADD VALUE 'LAND_TITLE';--> statement-breakpoint
ALTER TYPE "public"."collateral_type" ADD VALUE 'VEHICLE';--> statement-breakpoint
ALTER TYPE "public"."collateral_type" ADD VALUE 'EQUIPMENT';--> statement-breakpoint
ALTER TYPE "public"."collateral_type" ADD VALUE 'LIVESTOCK';--> statement-breakpoint
ALTER TYPE "public"."collateral_type" ADD VALUE 'CROP_STANDING';--> statement-breakpoint
ALTER TYPE "public"."collateral_type" ADD VALUE 'BANK_GUARANTEE';--> statement-breakpoint
ALTER TYPE "public"."collateral_type" ADD VALUE 'CASH_DEPOSIT';--> statement-breakpoint
ALTER TYPE "public"."collateral_type" ADD VALUE 'OTHER';--> statement-breakpoint
ALTER TYPE "public"."security_event_type" ADD VALUE 'LIVENESS_PASS';--> statement-breakpoint
ALTER TYPE "public"."security_event_type" ADD VALUE 'LIVENESS_FAIL';--> statement-breakpoint
ALTER TYPE "public"."security_event_type" ADD VALUE 'LIVENESS_SPOOF_DETECTED';--> statement-breakpoint
ALTER TYPE "public"."security_event_type" ADD VALUE 'FACE_MATCH_PASS';--> statement-breakpoint
ALTER TYPE "public"."security_event_type" ADD VALUE 'FACE_MATCH_FAIL';--> statement-breakpoint
ALTER TYPE "public"."security_event_type" ADD VALUE 'PASSIVE_LIVENESS_FAIL';--> statement-breakpoint
CREATE TABLE "kyc_liveness_sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"session_id" varchar(64) NOT NULL,
	"application_id" varchar(64),
	"user_id" integer,
	"challenges" text DEFAULT '[]' NOT NULL,
	"current_challenge_index" integer DEFAULT 0 NOT NULL,
	"results" text DEFAULT '[]' NOT NULL,
	"overall_result" varchar(16),
	"face_match_score" real,
	"spoof_type" "spoof_type" DEFAULT 'UNKNOWN',
	"spoof_confidence" real DEFAULT 0,
	"landmarks_json" text,
	"status" "liveness_session_status" DEFAULT 'PENDING' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "kyc_liveness_sessions_session_id_unique" UNIQUE("session_id")
);
--> statement-breakpoint
ALTER TABLE "collateral_registry" ALTER COLUMN "status" SET DEFAULT 'ACTIVE';--> statement-breakpoint
ALTER TABLE "user_preferences" ADD COLUMN "surv_alert_position_breach" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "user_preferences" ADD COLUMN "surv_alert_wash_trading" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "user_preferences" ADD COLUMN "surv_alert_price_manipulation" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "user_preferences" ADD COLUMN "surv_alert_volume_spike" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "user_preferences" ADD COLUMN "surv_alert_circuit_breaker" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "user_preferences" ADD COLUMN "surv_notif_email" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "user_preferences" ADD COLUMN "surv_notif_sms" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "kyc_liveness_sessions" ADD CONSTRAINT "kyc_liveness_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;