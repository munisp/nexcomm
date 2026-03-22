ALTER TABLE "live_prices" ADD COLUMN "volume" numeric(20, 2);--> statement-breakpoint
ALTER TABLE "live_prices" ADD COLUMN "bid_price" numeric(18, 6);--> statement-breakpoint
ALTER TABLE "live_prices" ADD COLUMN "ask_price" numeric(18, 6);