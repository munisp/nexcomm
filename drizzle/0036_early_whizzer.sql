CREATE TYPE "public"."warehouse_message_status" AS ENUM('SENT', 'READ', 'REPLIED', 'CLOSED');--> statement-breakpoint
CREATE TABLE "warehouse_messages" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"warehouse_id" varchar(50) NOT NULL,
	"warehouse_name" varchar(200) NOT NULL,
	"subject" varchar(300) NOT NULL,
	"body" text NOT NULL,
	"status" "warehouse_message_status" DEFAULT 'SENT' NOT NULL,
	"reply_body" text,
	"replied_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
