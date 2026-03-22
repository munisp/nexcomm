ALTER TABLE "mojaloop_dfsps" ADD COLUMN "tier" "dfsp_tier" DEFAULT 'STANDARD';--> statement-breakpoint
ALTER TABLE "mojaloop_dfsps" ADD COLUMN "status" varchar(32) DEFAULT 'ACTIVE';--> statement-breakpoint
ALTER TABLE "mojaloop_dfsps" ADD COLUMN "currency" varchar(8) DEFAULT 'NGN';