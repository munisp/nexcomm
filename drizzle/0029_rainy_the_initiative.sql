CREATE TABLE "farmer_onboarding_drafts" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"step" integer DEFAULT 1 NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "farmer_onboarding_drafts_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
ALTER TABLE "farmer_profiles" ADD COLUMN "bank_name" varchar(100);--> statement-breakpoint
ALTER TABLE "farmer_profiles" ADD COLUMN "bank_account_number" varchar(30);--> statement-breakpoint
ALTER TABLE "farmer_profiles" ADD COLUMN "bank_account_name" varchar(200);--> statement-breakpoint
ALTER TABLE "farmer_profiles" ADD COLUMN "mobile_money_provider" varchar(50);--> statement-breakpoint
ALTER TABLE "farmer_profiles" ADD COLUMN "mobile_money_number" varchar(20);--> statement-breakpoint
ALTER TABLE "farmer_profiles" ADD COLUMN "onboarding_step" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "farmer_profiles" ADD COLUMN "onboarding_completed_at" timestamp;