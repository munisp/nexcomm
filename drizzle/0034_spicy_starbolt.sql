CREATE TABLE "order_amendments" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"order_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"old_qty" numeric(18, 6) NOT NULL,
	"new_qty" numeric(18, 6) NOT NULL,
	"old_price" numeric(18, 6),
	"new_price" numeric(18, 6),
	"reason" text,
	"amended_at" timestamp DEFAULT now() NOT NULL
);
