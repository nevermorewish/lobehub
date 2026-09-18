CREATE TABLE IF NOT EXISTS "billing_accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"currency" varchar(8) DEFAULT 'CNY' NOT NULL,
	"status" varchar(16) DEFAULT 'active' NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ledger_entries" (
	"id" text PRIMARY KEY NOT NULL,
	"billing_account_id" text NOT NULL,
	"kind" varchar(16) NOT NULL,
	"delta" bigint NOT NULL,
	"available_delta" bigint NOT NULL,
	"reserved_delta" bigint NOT NULL,
	"hold_id" text,
	"balance_after" bigint NOT NULL,
	"idempotency_key" varchar(128) NOT NULL,
	"order_id" text,
	"usage_record_id" text,
	"reason" varchar(256),
	"operator_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ledger_entries_balanced_delta" CHECK ("ledger_entries"."delta" = "ledger_entries"."available_delta" + "ledger_entries"."reserved_delta")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "orders" (
	"id" text PRIMARY KEY NOT NULL,
	"billing_account_id" text NOT NULL,
	"user_id" text NOT NULL,
	"plan_price_id" text NOT NULL,
	"status" varchar(16) DEFAULT 'pending' NOT NULL,
	"currency" varchar(8) NOT NULL,
	"amount_minor" bigint NOT NULL,
	"price_snapshot" jsonb NOT NULL,
	"order_no" varchar(64) NOT NULL,
	"idempotency_key" varchar(128) NOT NULL,
	"payment_provider" text DEFAULT 'alipay' NOT NULL,
	"provider_trade_no" text,
	"payment_app_id" text NOT NULL,
	"payment_seller_id" text NOT NULL,
	"payment_sandbox" boolean DEFAULT false NOT NULL,
	"paid_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "orders_order_no_unique" UNIQUE("order_no"),
	CONSTRAINT "orders_provider_trade_no_unique" UNIQUE("provider_trade_no"),
	CONSTRAINT "orders_amount_positive" CHECK ("orders"."amount_minor" > 0)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "payment_attempts" (
	"id" text PRIMARY KEY NOT NULL,
	"order_id" text NOT NULL,
	"provider" varchar(32) NOT NULL,
	"provider_ref" varchar(256),
	"status" varchar(16) DEFAULT 'pending' NOT NULL,
	"idempotency_key" varchar(128) NOT NULL,
	"failure_code" varchar(64),
	"failure_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "plan_prices" (
	"id" text PRIMARY KEY NOT NULL,
	"plan_id" text NOT NULL,
	"currency" varchar(8) NOT NULL,
	"amount_minor" bigint NOT NULL,
	"billing_interval" varchar(16) NOT NULL,
	"archived_at" timestamp with time zone,
	"provider_price_id" varchar(128),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "plans" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" varchar(64) NOT NULL,
	"name" varchar(128) NOT NULL,
	"description" text,
	"status" varchar(16) DEFAULT 'active' NOT NULL,
	"token_grant_monthly" bigint DEFAULT 0 NOT NULL,
	"features" jsonb DEFAULT '{}'::jsonb,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plans_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "subscriptions" (
	"id" text PRIMARY KEY NOT NULL,
	"billing_account_id" text NOT NULL,
	"plan_id" text NOT NULL,
	"plan_price_id" text NOT NULL,
	"status" varchar(16) DEFAULT 'active' NOT NULL,
	"current_period_start" timestamp with time zone NOT NULL,
	"current_period_end" timestamp with time zone NOT NULL,
	"cancel_at_period_end" boolean DEFAULT false NOT NULL,
	"canceled_at" timestamp with time zone,
	"provider_subscription_id" varchar(128),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "usage_records" (
	"id" text PRIMARY KEY NOT NULL,
	"billing_account_id" text NOT NULL,
	"user_id" text NOT NULL,
	"request_id" varchar(128) NOT NULL,
	"model_id" varchar(128) NOT NULL,
	"provider" varchar(64) NOT NULL,
	"plan_price_id" text,
	"price_snapshot" jsonb,
	"prompt_tokens" integer DEFAULT 0 NOT NULL,
	"completion_tokens" integer DEFAULT 0 NOT NULL,
	"total_tokens" integer DEFAULT 0 NOT NULL,
	"credits_charged" bigint DEFAULT 0 NOT NULL,
	"settlement_status" varchar(16) DEFAULT 'hold' NOT NULL,
	"ledger_entry_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "wallets" (
	"id" text PRIMARY KEY NOT NULL,
	"billing_account_id" text NOT NULL,
	"available" bigint DEFAULT 0 NOT NULL,
	"reserved" bigint DEFAULT 0 NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wallets_available_nonnegative" CHECK ("wallets"."available" >= 0),
	CONSTRAINT "wallets_reserved_nonnegative" CHECK ("wallets"."reserved" >= 0)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "webhook_events" (
	"id" text PRIMARY KEY NOT NULL,
	"provider" varchar(32) NOT NULL,
	"event_id" varchar(256) NOT NULL,
	"event_type" varchar(128) NOT NULL,
	"status" varchar(16) DEFAULT 'pending' NOT NULL,
	"payload" jsonb NOT NULL,
	"order_id" text,
	"payload_hash" varchar(64),
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"processing_started_at" timestamp with time zone,
	"processed_at" timestamp with time zone,
	"failure_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "billing_accounts" DROP CONSTRAINT IF EXISTS "billing_accounts_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "billing_accounts" ADD CONSTRAINT "billing_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" DROP CONSTRAINT IF EXISTS "ledger_entries_billing_account_id_billing_accounts_id_fk";
--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_billing_account_id_billing_accounts_id_fk" FOREIGN KEY ("billing_account_id") REFERENCES "public"."billing_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" DROP CONSTRAINT IF EXISTS "ledger_entries_order_id_orders_id_fk";
--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" DROP CONSTRAINT IF EXISTS "ledger_entries_operator_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_operator_user_id_users_id_fk" FOREIGN KEY ("operator_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" DROP CONSTRAINT IF EXISTS "orders_billing_account_id_billing_accounts_id_fk";
--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_billing_account_id_billing_accounts_id_fk" FOREIGN KEY ("billing_account_id") REFERENCES "public"."billing_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" DROP CONSTRAINT IF EXISTS "orders_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" DROP CONSTRAINT IF EXISTS "orders_plan_price_id_plan_prices_id_fk";
--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_plan_price_id_plan_prices_id_fk" FOREIGN KEY ("plan_price_id") REFERENCES "public"."plan_prices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_attempts" DROP CONSTRAINT IF EXISTS "payment_attempts_order_id_orders_id_fk";
--> statement-breakpoint
ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempts_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_prices" DROP CONSTRAINT IF EXISTS "plan_prices_plan_id_plans_id_fk";
--> statement-breakpoint
ALTER TABLE "plan_prices" ADD CONSTRAINT "plan_prices_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" DROP CONSTRAINT IF EXISTS "subscriptions_billing_account_id_billing_accounts_id_fk";
--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_billing_account_id_billing_accounts_id_fk" FOREIGN KEY ("billing_account_id") REFERENCES "public"."billing_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" DROP CONSTRAINT IF EXISTS "subscriptions_plan_id_plans_id_fk";
--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" DROP CONSTRAINT IF EXISTS "subscriptions_plan_price_id_plan_prices_id_fk";
--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_plan_price_id_plan_prices_id_fk" FOREIGN KEY ("plan_price_id") REFERENCES "public"."plan_prices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_records" DROP CONSTRAINT IF EXISTS "usage_records_billing_account_id_billing_accounts_id_fk";
--> statement-breakpoint
ALTER TABLE "usage_records" ADD CONSTRAINT "usage_records_billing_account_id_billing_accounts_id_fk" FOREIGN KEY ("billing_account_id") REFERENCES "public"."billing_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_records" DROP CONSTRAINT IF EXISTS "usage_records_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "usage_records" ADD CONSTRAINT "usage_records_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_records" DROP CONSTRAINT IF EXISTS "usage_records_plan_price_id_plan_prices_id_fk";
--> statement-breakpoint
ALTER TABLE "usage_records" ADD CONSTRAINT "usage_records_plan_price_id_plan_prices_id_fk" FOREIGN KEY ("plan_price_id") REFERENCES "public"."plan_prices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_records" DROP CONSTRAINT IF EXISTS "usage_records_ledger_entry_id_ledger_entries_id_fk";
--> statement-breakpoint
ALTER TABLE "usage_records" ADD CONSTRAINT "usage_records_ledger_entry_id_ledger_entries_id_fk" FOREIGN KEY ("ledger_entry_id") REFERENCES "public"."ledger_entries"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallets" DROP CONSTRAINT IF EXISTS "wallets_billing_account_id_billing_accounts_id_fk";
--> statement-breakpoint
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_billing_account_id_billing_accounts_id_fk" FOREIGN KEY ("billing_account_id") REFERENCES "public"."billing_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_events" DROP CONSTRAINT IF EXISTS "webhook_events_order_id_orders_id_fk";
--> statement-breakpoint
ALTER TABLE "webhook_events" ADD CONSTRAINT "webhook_events_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "billing_accounts_user_id_unique" ON "billing_accounts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "billing_accounts_status_idx" ON "billing_accounts" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ledger_entries_idempotency_key_unique" ON "ledger_entries" USING btree ("idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ledger_entries_hold_finalization_unique" ON "ledger_entries" USING btree ("hold_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ledger_entries_billing_account_id_created_at_idx" ON "ledger_entries" USING btree ("billing_account_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ledger_entries_order_id_idx" ON "ledger_entries" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ledger_entries_usage_record_id_idx" ON "ledger_entries" USING btree ("usage_record_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ledger_entries_kind_idx" ON "ledger_entries" USING btree ("kind");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ledger_entries_kind_created_at_idx" ON "ledger_entries" USING btree ("kind","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "orders_billing_account_id_idx" ON "orders" USING btree ("billing_account_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "orders_user_id_idx" ON "orders" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "orders_user_id_idempotency_unique" ON "orders" USING btree ("user_id","idempotency_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "orders_status_idx" ON "orders" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "orders_created_at_idx" ON "orders" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payment_attempts_order_id_idx" ON "payment_attempts" USING btree ("order_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "payment_attempts_idempotency_key_unique" ON "payment_attempts" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payment_attempts_provider_ref_idx" ON "payment_attempts" USING btree ("provider_ref");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "plan_prices_plan_id_idx" ON "plan_prices" USING btree ("plan_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "plan_prices_provider_price_id_idx" ON "plan_prices" USING btree ("provider_price_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "plans_status_idx" ON "plans" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "subscriptions_billing_account_id_idx" ON "subscriptions" USING btree ("billing_account_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "subscriptions_status_idx" ON "subscriptions" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "subscriptions_provider_subscription_id_unique" ON "subscriptions" USING btree ("provider_subscription_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "usage_records_request_id_billing_account_id_unique" ON "usage_records" USING btree ("request_id","billing_account_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "usage_records_billing_account_id_created_at_idx" ON "usage_records" USING btree ("billing_account_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "usage_records_user_id_idx" ON "usage_records" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "usage_records_model_id_idx" ON "usage_records" USING btree ("model_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "wallets_billing_account_id_unique" ON "wallets" USING btree ("billing_account_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "webhook_events_provider_event_id_unique" ON "webhook_events" USING btree ("provider","event_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "webhook_events_status_idx" ON "webhook_events" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "webhook_events_order_id_idx" ON "webhook_events" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "webhook_events_created_at_idx" ON "webhook_events" USING btree ("created_at");