CREATE TABLE "pbac_policies" (
	"id" varchar(128) PRIMARY KEY NOT NULL,
	"name" varchar(200) NOT NULL,
	"description" text,
	"effect" varchar(8) NOT NULL,
	"principals" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"resources" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"actions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"conditions" jsonb,
	"priority" integer DEFAULT 500 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
