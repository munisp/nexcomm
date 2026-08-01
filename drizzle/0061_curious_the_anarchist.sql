CREATE TABLE "user_files" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"file_name" varchar(512) NOT NULL,
	"file_key" varchar(1024) NOT NULL,
	"file_url" text NOT NULL,
	"mime_type" varchar(128) NOT NULL,
	"size_bytes" integer NOT NULL,
	"folder" varchar(128) DEFAULT 'general' NOT NULL,
	"uploaded_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_files_file_key_unique" UNIQUE("file_key")
);
--> statement-breakpoint
ALTER TABLE "user_files" ADD CONSTRAINT "user_files_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;