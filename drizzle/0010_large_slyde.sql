CREATE TABLE IF NOT EXISTS "regulatory_report_schedules" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"report_type" varchar(64) NOT NULL,
	"asset_class" varchar(32),
	"format" varchar(8) DEFAULT 'CSV' NOT NULL,
	"frequency" varchar(32) NOT NULL,
	"day_of_week" integer,
	"day_of_month" integer,
	"time_utc" varchar(8) DEFAULT '15:00' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_run_at" timestamp,
	"next_run_at" timestamp,
	"created_by" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "regulatory_reports" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"report_type" varchar(64) NOT NULL,
	"report_date" timestamp NOT NULL,
	"period_start" timestamp NOT NULL,
	"period_end" timestamp NOT NULL,
	"asset_class" varchar(32),
	"format" varchar(8) DEFAULT 'CSV' NOT NULL,
	"status" varchar(32) DEFAULT 'PENDING' NOT NULL,
	"row_count" integer DEFAULT 0,
	"file_size" integer DEFAULT 0,
	"content" text,
	"error_message" text,
	"generated_by" integer NOT NULL,
	"schedule_id" bigint,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
