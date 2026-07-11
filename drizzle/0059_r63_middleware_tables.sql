CREATE TABLE "apisix_route_snapshots" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"route_id" varchar(128) NOT NULL,
	"route_name" varchar(256),
	"upstream_url" varchar(512),
	"plugins" jsonb,
	"status" varchar(16) DEFAULT 'ACTIVE' NOT NULL,
	"snapshot_at" timestamp DEFAULT now() NOT NULL,
	"created_by" integer
);
--> statement-breakpoint
CREATE TABLE "broker_ledger_entries" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"broker_id" integer NOT NULL,
	"entry_type" varchar(32) NOT NULL,
	"amount" numeric(20, 6) NOT NULL,
	"currency" varchar(8) DEFAULT 'USD' NOT NULL,
	"tb_transfer_id" varchar(64),
	"trade_id" bigint,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "clearing_ledger_entries" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"margin_call_id" bigint,
	"user_id" integer NOT NULL,
	"entry_type" varchar(32) NOT NULL,
	"amount" numeric(20, 8) NOT NULL,
	"currency" varchar(8) DEFAULT 'USD' NOT NULL,
	"tb_transfer_id" varchar(64),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cross_border_ledger_entries" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"transfer_id" varchar(64) NOT NULL,
	"user_id" integer NOT NULL,
	"send_amount" numeric(20, 6) NOT NULL,
	"send_currency" varchar(8) NOT NULL,
	"receive_amount" numeric(20, 6),
	"receive_currency" varchar(8),
	"fx_rate" numeric(20, 8),
	"tb_transfer_id" varchar(64),
	"status" varchar(16) DEFAULT 'PENDING' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"settled_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "dapr_pubsub_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"pubsub_name" varchar(128) NOT NULL,
	"topic_name" varchar(256) NOT NULL,
	"payload" jsonb NOT NULL,
	"status" varchar(16) DEFAULT 'PUBLISHED' NOT NULL,
	"error_message" text,
	"user_id" integer,
	"published_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fluvio_event_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"topic" varchar(256) NOT NULL,
	"event_key" varchar(256),
	"payload" jsonb NOT NULL,
	"partition" integer,
	"offset" bigint,
	"produced_at" timestamp DEFAULT now() NOT NULL,
	"user_id" integer
);
--> statement-breakpoint
CREATE TABLE "keycloak_user_sync" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"keycloak_id" varchar(128),
	"sync_action" varchar(32) NOT NULL,
	"sync_status" varchar(16) DEFAULT 'PENDING' NOT NULL,
	"error_message" text,
	"synced_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "loan_ledger_entries" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"loan_id" bigint NOT NULL,
	"loan_type" varchar(32) NOT NULL,
	"entry_type" varchar(32) NOT NULL,
	"amount" numeric(20, 2) NOT NULL,
	"currency" varchar(8) DEFAULT 'NGN' NOT NULL,
	"tb_transfer_id" varchar(64),
	"balance_after" numeric(20, 2),
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "margin_ledger_entries" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"entry_type" varchar(32) NOT NULL,
	"amount" numeric(20, 8) NOT NULL,
	"currency" varchar(8) DEFAULT 'USD' NOT NULL,
	"tb_transfer_id" varchar(64),
	"related_id" varchar(64),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "middleware_health_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"service" varchar(64) NOT NULL,
	"status" varchar(16) NOT NULL,
	"latency_ms" integer,
	"error_message" text,
	"checked_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "opensearch_index_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"index_name" varchar(256) NOT NULL,
	"document_id" varchar(256),
	"operation" varchar(16) NOT NULL,
	"status" varchar(16) DEFAULT 'SUCCESS' NOT NULL,
	"error_message" text,
	"user_id" integer,
	"indexed_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "permify_policy_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"action" varchar(128) NOT NULL,
	"resource" varchar(256),
	"decision" varchar(16) NOT NULL,
	"reason" text,
	"checked_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "receipt_ledger_entries" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"receipt_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"entry_type" varchar(32) NOT NULL,
	"value_usd" numeric(20, 2),
	"tb_transfer_id" varchar(64),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "redis_cache_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"cache_key" varchar(512) NOT NULL,
	"operation" varchar(16) NOT NULL,
	"ttl_seconds" integer,
	"user_id" integer,
	"triggered_by" varchar(128),
	"executed_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settlement_ledger_entries" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"settlement_id" bigint,
	"buyer_user_id" integer,
	"seller_user_id" integer,
	"entry_type" varchar(32) NOT NULL,
	"amount" numeric(20, 6) NOT NULL,
	"currency" varchar(8) DEFAULT 'USD' NOT NULL,
	"tb_transfer_id" varchar(64),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tb_transfer_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"transfer_id" varchar(64) NOT NULL,
	"debit_account_id" varchar(64) NOT NULL,
	"credit_account_id" varchar(64) NOT NULL,
	"amount" bigint NOT NULL,
	"currency" varchar(8) DEFAULT 'NGN' NOT NULL,
	"user_id" integer,
	"reference_id" varchar(64),
	"reference_type" varchar(32),
	"code" integer NOT NULL,
	"status" varchar(16) DEFAULT 'COMMITTED' NOT NULL,
	"pending_id" varchar(64),
	"correlation_id" varchar(64),
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "tb_transfer_log_transfer_id_unique" UNIQUE("transfer_id")
);
--> statement-breakpoint
CREATE TABLE "workflow_executions" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"workflow_type" varchar(128) NOT NULL,
	"workflow_id" varchar(256) NOT NULL,
	"run_id" varchar(128),
	"user_id" integer,
	"status" varchar(32) DEFAULT 'STARTED' NOT NULL,
	"input" jsonb,
	"result" jsonb,
	"error_message" text,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "futures_contracts" ADD COLUMN "ledger_tx_id" varchar(64);--> statement-breakpoint
ALTER TABLE "futures_positions" ADD COLUMN "ledger_tx_id" varchar(64);--> statement-breakpoint
ALTER TABLE "input_financing_loans" ADD COLUMN "ledger_disbursement_tx_id" varchar(64);--> statement-breakpoint
ALTER TABLE "input_financing_loans" ADD COLUMN "ledger_repayment_tx_id" varchar(64);--> statement-breakpoint
ALTER TABLE "options_contracts" ADD COLUMN "ledger_tx_id" varchar(64);--> statement-breakpoint
ALTER TABLE "apisix_route_snapshots" ADD CONSTRAINT "apisix_route_snapshots_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broker_ledger_entries" ADD CONSTRAINT "broker_ledger_entries_broker_id_users_id_fk" FOREIGN KEY ("broker_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clearing_ledger_entries" ADD CONSTRAINT "clearing_ledger_entries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cross_border_ledger_entries" ADD CONSTRAINT "cross_border_ledger_entries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dapr_pubsub_log" ADD CONSTRAINT "dapr_pubsub_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fluvio_event_log" ADD CONSTRAINT "fluvio_event_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "keycloak_user_sync" ADD CONSTRAINT "keycloak_user_sync_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "margin_ledger_entries" ADD CONSTRAINT "margin_ledger_entries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opensearch_index_log" ADD CONSTRAINT "opensearch_index_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "permify_policy_log" ADD CONSTRAINT "permify_policy_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt_ledger_entries" ADD CONSTRAINT "receipt_ledger_entries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "redis_cache_log" ADD CONSTRAINT "redis_cache_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement_ledger_entries" ADD CONSTRAINT "settlement_ledger_entries_buyer_user_id_users_id_fk" FOREIGN KEY ("buyer_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement_ledger_entries" ADD CONSTRAINT "settlement_ledger_entries_seller_user_id_users_id_fk" FOREIGN KEY ("seller_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tb_transfer_log" ADD CONSTRAINT "tb_transfer_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_executions" ADD CONSTRAINT "workflow_executions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;