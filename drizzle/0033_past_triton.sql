CREATE TABLE IF NOT EXISTS "push_subscriptions" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"endpoint" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"enable_price_alerts" boolean DEFAULT true NOT NULL,
	"enable_trade_fills" boolean DEFAULT true NOT NULL,
	"enable_system_alerts" boolean DEFAULT false NOT NULL,
	"user_agent" text,
	"device_label" varchar(100),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "push_subscriptions_endpoint_unique" UNIQUE("endpoint")
);
