ALTER TABLE "bank_transactions" ADD COLUMN "idempotency_key" varchar(128);--> statement-breakpoint
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_idempotency_key_unique" UNIQUE("idempotency_key");--> statement-breakpoint
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_order_id_unique" UNIQUE("order_id");