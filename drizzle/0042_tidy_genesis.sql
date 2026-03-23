CREATE TYPE "public"."channel_contact_status" AS ENUM('ACTIVE', 'OPTED_OUT', 'BLOCKED');--> statement-breakpoint
CREATE TYPE "public"."telegram_contact_status" AS ENUM('ACTIVE', 'BLOCKED', 'OPTED_OUT');--> statement-breakpoint
CREATE TYPE "public"."telegram_message_direction" AS ENUM('INBOUND', 'OUTBOUND');--> statement-breakpoint
CREATE TYPE "public"."ussd_session_status" AS ENUM('ACTIVE', 'COMPLETED', 'TIMED_OUT', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."whatsapp_message_direction" AS ENUM('INBOUND', 'OUTBOUND');--> statement-breakpoint
CREATE TYPE "public"."whatsapp_message_status" AS ENUM('QUEUED', 'SENT', 'DELIVERED', 'READ', 'FAILED');--> statement-breakpoint
CREATE TABLE "telegram_contacts" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"telegram_id" varchar(30) NOT NULL,
	"username" varchar(100),
	"first_name" varchar(100),
	"last_name" varchar(100),
	"status" "telegram_contact_status" DEFAULT 'ACTIVE' NOT NULL,
	"is_verified" boolean DEFAULT false NOT NULL,
	"verification_code" varchar(10),
	"verification_expires_at" timestamp,
	"alerts_enabled" boolean DEFAULT true NOT NULL,
	"price_alerts_enabled" boolean DEFAULT true NOT NULL,
	"trade_notifications_enabled" boolean DEFAULT true NOT NULL,
	"last_interaction_at" timestamp,
	"total_commands" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "telegram_contacts_telegram_id_unique" UNIQUE("telegram_id")
);
--> statement-breakpoint
CREATE TABLE "telegram_messages" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"contact_id" integer NOT NULL,
	"telegram_message_id" integer,
	"direction" "telegram_message_direction" NOT NULL,
	"command" varchar(64),
	"text" text,
	"parse_mode" varchar(20) DEFAULT 'Markdown',
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ussd_pins" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"pin_hash" varchar(256) NOT NULL,
	"failed_attempts" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "ussd_pins_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "ussd_sessions" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"session_id" varchar(128) NOT NULL,
	"phone_number" varchar(20) NOT NULL,
	"user_id" integer,
	"service_code" varchar(20) DEFAULT '*347*99#',
	"network_code" varchar(20),
	"menu_path" text DEFAULT '',
	"current_menu" varchar(64) DEFAULT 'MAIN',
	"last_input" varchar(256),
	"status" "ussd_session_status" DEFAULT 'ACTIVE' NOT NULL,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"last_activity_at" timestamp DEFAULT now() NOT NULL,
	"ended_at" timestamp,
	"total_interactions" integer DEFAULT 0 NOT NULL,
	"metadata" jsonb,
	CONSTRAINT "ussd_sessions_session_id_unique" UNIQUE("session_id")
);
--> statement-breakpoint
CREATE TABLE "whatsapp_contacts" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"phone_number" varchar(20) NOT NULL,
	"wa_id" varchar(30) NOT NULL,
	"display_name" varchar(200),
	"status" "channel_contact_status" DEFAULT 'ACTIVE' NOT NULL,
	"last_message_at" timestamp,
	"total_messages" integer DEFAULT 0 NOT NULL,
	"verification_token" varchar(64),
	"verified_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "whatsapp_contacts_phone_number_unique" UNIQUE("phone_number"),
	CONSTRAINT "whatsapp_contacts_wa_id_unique" UNIQUE("wa_id")
);
--> statement-breakpoint
CREATE TABLE "whatsapp_messages" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"contact_id" integer NOT NULL,
	"wamid" varchar(256),
	"direction" "whatsapp_message_direction" NOT NULL,
	"message_type" varchar(30) DEFAULT 'text' NOT NULL,
	"body" text,
	"status" "whatsapp_message_status" DEFAULT 'QUEUED' NOT NULL,
	"error_code" varchar(20),
	"error_message" text,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "whatsapp_messages_wamid_unique" UNIQUE("wamid")
);
