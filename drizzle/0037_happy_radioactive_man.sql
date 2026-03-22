ALTER TABLE "user_preferences" ADD COLUMN "notif_trade_executions" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "user_preferences" ADD COLUMN "notif_price_alerts" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "user_preferences" ADD COLUMN "notif_ewr_updates" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "user_preferences" ADD COLUMN "notif_deposit_updates" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "user_preferences" ADD COLUMN "notif_delivery_updates" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "user_preferences" ADD COLUMN "notif_system_messages" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "user_preferences" ADD COLUMN "notif_email" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "user_preferences" ADD COLUMN "notif_sms" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "user_preferences" ADD COLUMN "notif_push" boolean DEFAULT true NOT NULL;