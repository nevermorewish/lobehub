/**
 * Wedai Phase-1 commercial billing schema
 *
 * Invariants enforced at the DB layer:
 *  - All monetary amounts are integer minor-currency units (e.g. fen, cent).
 *  - All credit/point amounts are integer units.
 *  - Ledger rows are append-only; callers must NOT issue UPDATE/DELETE on them.
 *  - Wallet rows cache the ledger view; the ledger is always the audit source.
 *  - Every external-facing operation carries an idempotency key.
 */
import type {
  BillingAccountStatus,
  LedgerEntryKind,
  OrderStatus,
  PaymentAttemptStatus,
  PlanPriceBillingInterval,
  PlanStatus,
  SubscriptionStatus,
  WebhookEventStatus,
} from '@lobechat/types';
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';

import { createdAt, timestamptz, updatedAt } from './_helpers';
import { users } from './user';

export const billingAccounts = pgTable(
  'billing_accounts',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => `billingAccounts_${globalThis.crypto.randomUUID()}`)
      .notNull(),
    /** FK to the owning user.  Future: add nullable workspace_id. */
    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    /** ISO 4217 code for the account's home currency, e.g. "CNY" */
    currency: varchar('currency', { length: 8 }).notNull().default('CNY'),
    status: varchar('status', { length: 16 })
      .$type<BillingAccountStatus>()
      .notNull()
      .default('active'),
    /**
     * Optimistic-lock version counter; increment on every write that changes
     * business state so concurrent mutations can detect conflicts.
     */
    version: integer('version').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('billing_accounts_user_id_unique').on(t.userId),
    index('billing_accounts_status_idx').on(t.status),
  ],
);

export type BillingAccount = typeof billingAccounts.$inferSelect;
export type NewBillingAccount = typeof billingAccounts.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────────
// plans + plan_prices
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A product plan (e.g. "Pro Monthly").  Immutable once published.
 */
export const plans = pgTable(
  'plans',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => `plans_${globalThis.crypto.randomUUID()}`)
      .notNull(),
    /** Machine-readable slug, e.g. "pro_monthly".  Unique across active plans. */
    slug: varchar('slug', { length: 64 }).notNull().unique(),
    name: varchar('name', { length: 128 }).notNull(),
    description: text('description'),
    status: varchar('status', { length: 16 }).$type<PlanStatus>().notNull().default('active'),
    /** Monthly token grant included in the plan (integer units). */
    tokenGrantMonthly: bigint('token_grant_monthly', { mode: 'bigint' })
      .notNull()
      .default(sql`0`),
    /** Feature flags / entitlements stored as structured JSON. */
    features: jsonb('features').$type<Record<string, boolean | number | string>>().default({}),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('plans_status_idx').on(t.status)],
);

export type Plan = typeof plans.$inferSelect;
export type NewPlan = typeof plans.$inferInsert;

/**
 * Versioned price snapshot for a plan.
 *
 * Once an order references a price snapshot (`price_snapshot_id`), this row
 * MUST be treated as immutable to guarantee historical accuracy.  New pricing
 * is always a new row.
 */
export const planPrices = pgTable(
  'plan_prices',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => `planPrices_${globalThis.crypto.randomUUID()}`)
      .notNull(),
    planId: text('plan_id')
      .references(() => plans.id, { onDelete: 'restrict' })
      .notNull(),
    currency: varchar('currency', { length: 8 }).notNull(),
    /** Amount in integer minor units (e.g. fen for CNY, cent for USD). */
    amountMinor: bigint('amount_minor', { mode: 'bigint' }).notNull(),
    billingInterval: varchar('billing_interval', { length: 16 })
      .$type<PlanPriceBillingInterval>()
      .notNull(),
    /** When set, this price is no longer offered to new customers. */
    archivedAt: timestamptz('archived_at'),
    /** Optional external payment-provider price ID, e.g. Stripe `price_xxx`. */
    providerPriceId: varchar('provider_price_id', { length: 128 }),
    createdAt: createdAt(),
  },
  (t) => [
    index('plan_prices_plan_id_idx').on(t.planId),
    index('plan_prices_provider_price_id_idx').on(t.providerPriceId),
  ],
);

export type PlanPrice = typeof planPrices.$inferSelect;
export type NewPlanPrice = typeof planPrices.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────────
// subscriptions
// ─────────────────────────────────────────────────────────────────────────────

export const subscriptions = pgTable(
  'subscriptions',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => `subscriptions_${globalThis.crypto.randomUUID()}`)
      .notNull(),
    billingAccountId: text('billing_account_id')
      .references(() => billingAccounts.id, { onDelete: 'restrict' })
      .notNull(),
    planId: text('plan_id')
      .references(() => plans.id, { onDelete: 'restrict' })
      .notNull(),
    /** FK to the price snapshot used at subscription creation. */
    planPriceId: text('plan_price_id')
      .references(() => planPrices.id, { onDelete: 'restrict' })
      .notNull(),
    status: varchar('status', { length: 16 })
      .$type<SubscriptionStatus>()
      .notNull()
      .default('active'),
    currentPeriodStart: timestamptz('current_period_start').notNull(),
    currentPeriodEnd: timestamptz('current_period_end').notNull(),
    cancelAtPeriodEnd: boolean('cancel_at_period_end').notNull().default(false),
    canceledAt: timestamptz('canceled_at'),
    /** External subscription ID from the payment provider, e.g. Stripe `sub_xxx`. */
    providerSubscriptionId: varchar('provider_subscription_id', { length: 128 }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('subscriptions_billing_account_id_idx').on(t.billingAccountId),
    index('subscriptions_status_idx').on(t.status),
    uniqueIndex('subscriptions_provider_subscription_id_unique').on(t.providerSubscriptionId),
  ],
);

export type Subscription = typeof subscriptions.$inferSelect;
export type NewSubscription = typeof subscriptions.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────────
// orders + payment_attempts
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Internal order — created before any payment provider is contacted.
 *
 * State machine: pending → paid | closed | failed
 * Once in a terminal state the row is immutable (enforced in the repository).
 */
export const orders = pgTable(
  'orders',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => `orders_${globalThis.crypto.randomUUID()}`)
      .notNull(),
    billingAccountId: text('billing_account_id')
      .references(() => billingAccounts.id, { onDelete: 'restrict' })
      .notNull(),
    userId: text('user_id')
      .references(() => users.id, { onDelete: 'restrict' })
      .notNull(),
    /** FK to the price snapshot — the server reads this, never trusts client-sent amount. */
    planPriceId: text('plan_price_id')
      .references(() => planPrices.id, { onDelete: 'restrict' })
      .notNull(),
    status: varchar('status', { length: 16 }).$type<OrderStatus>().notNull().default('pending'),
    currency: varchar('currency', { length: 8 }).notNull(),
    /** Total charged in integer minor units. */
    amountMinor: bigint('amount_minor', { mode: 'bigint' }).notNull(),
    /**
     * Immutable price snapshot JSON stored at order creation time.
     * Ensures historical reports remain correct after prices change.
     */
    priceSnapshot: jsonb('price_snapshot')
      .$type<{
        planId: string;
        planPriceId: string;
        amountMinor: string;
        currency: string;
        billingInterval: string;
        creditGrant: string;
      }>()
      .notNull(),
    /** Client-visible order number, e.g. "ORD-20240801-0001". */
    orderNo: varchar('order_no', { length: 64 }).unique().notNull(),
    /** Idempotency key supplied by the caller (checkout session start). */
    idempotencyKey: varchar('idempotency_key', { length: 128 }).notNull(),
    paymentProvider: text('payment_provider').notNull().default('alipay'),
    providerTradeNo: text('provider_trade_no').unique(),
    paymentAppId: text('payment_app_id').notNull(),
    paymentSellerId: text('payment_seller_id').notNull(),
    paymentSandbox: boolean('payment_sandbox').notNull().default(false),
    paidAt: timestamptz('paid_at'),
    closedAt: timestamptz('closed_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('orders_billing_account_id_idx').on(t.billingAccountId),
    index('orders_user_id_idx').on(t.userId),
    uniqueIndex('orders_user_id_idempotency_unique').on(t.userId, t.idempotencyKey),
    index('orders_status_idx').on(t.status),
    check('orders_amount_positive', sql`${t.amountMinor} > 0`),
    index('orders_created_at_idx').on(t.createdAt),
  ],
);

export type Order = typeof orders.$inferSelect;
export type NewOrder = typeof orders.$inferInsert;

/**
 * One payment-provider delivery attempt per order.
 * Separates internal order state from provider delivery retry logic.
 */
export const paymentAttempts = pgTable(
  'payment_attempts',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => `paymentAttempts_${globalThis.crypto.randomUUID()}`)
      .notNull(),
    orderId: text('order_id')
      .references(() => orders.id, { onDelete: 'restrict' })
      .notNull(),
    /** e.g. "stripe", "alipay", "wechat_pay" */
    provider: varchar('provider', { length: 32 }).notNull(),
    /** External provider reference, e.g. Stripe PaymentIntent ID. */
    providerRef: varchar('provider_ref', { length: 256 }),
    status: varchar('status', { length: 16 })
      .$type<PaymentAttemptStatus>()
      .notNull()
      .default('pending'),
    /** Idempotency key passed to the provider for this attempt. */
    idempotencyKey: varchar('idempotency_key', { length: 128 }).notNull(),
    failureCode: varchar('failure_code', { length: 64 }),
    failureMessage: text('failure_message'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('payment_attempts_order_id_idx').on(t.orderId),
    uniqueIndex('payment_attempts_idempotency_key_unique').on(t.idempotencyKey),
    index('payment_attempts_provider_ref_idx').on(t.providerRef),
  ],
);

export type PaymentAttempt = typeof paymentAttempts.$inferSelect;
export type NewPaymentAttempt = typeof paymentAttempts.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────────
// wallets  (fast-read balance cache; NOT the audit source of truth)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Wallet — cached available / reserved balance for a billing account.
 *
 * IMPORTANT: the ledger is always authoritative. The wallet is a denormalized
 * cache updated transactionally alongside every ledger write.  Direct writes to
 * wallet balances outside of ledger transactions are forbidden.
 *
 * Balance semantics (all integer, minimum unit):
 *  - available:  spendable now
 *  - reserved:   held for in-flight requests (holds); not yet deducted
 */
export const wallets = pgTable(
  'wallets',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => `wallets_${globalThis.crypto.randomUUID()}`)
      .notNull(),
    billingAccountId: text('billing_account_id')
      .references(() => billingAccounts.id, { onDelete: 'cascade' })
      .notNull(),
    /** Integer credit units (not minor currency — credits are dimensionless). */
    available: bigint('available', { mode: 'bigint' })
      .notNull()
      .default(sql`0`),
    /** Credits held for in-flight requests; must not exceed `available`. */
    reserved: bigint('reserved', { mode: 'bigint' })
      .notNull()
      .default(sql`0`),
    /**
     * Optimistic-lock version counter.  All balance mutations must:
     *   UPDATE wallets SET available=?, reserved=?, version=version+1
     *   WHERE id=? AND version=<expected>
     * and retry or fail on zero rows-affected.
     */
    version: integer('version').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('wallets_billing_account_id_unique').on(t.billingAccountId),
    check('wallets_available_nonnegative', sql`${t.available} >= 0`),
    check('wallets_reserved_nonnegative', sql`${t.reserved} >= 0`),
  ],
);

export type Wallet = typeof wallets.$inferSelect;
export type NewWallet = typeof wallets.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────────
// ledger_entries  (append-only audit log)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Ledger entry — every balance-affecting event produces exactly one row here.
 *
 * Rows MUST NEVER be updated or deleted; issue a compensating `refund` or
 * `release` entry instead.
 *
 * `delta` is the net change in available + reserved credits.
 * Credits/refunds increase the net balance; debits/expiry decrease it.
 * Holds/releases transfer between buckets and have zero net delta.
 * Append-only writes are an application invariant, not a database trigger.
 */
export const ledgerEntries = pgTable(
  'ledger_entries',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => `ledgerEntries_${globalThis.crypto.randomUUID()}`)
      .notNull(),
    billingAccountId: text('billing_account_id')
      .references(() => billingAccounts.id, { onDelete: 'restrict' })
      .notNull(),
    kind: varchar('kind', { length: 16 }).$type<LedgerEntryKind>().notNull(),
    /**
     * Signed integer delta in credit units.
     * Equals availableDelta + reservedDelta; holds and releases are zero.
     */
    delta: bigint('delta', { mode: 'bigint' }).notNull(),
    availableDelta: bigint('available_delta', { mode: 'bigint' }).notNull(),
    reservedDelta: bigint('reserved_delta', { mode: 'bigint' }).notNull(),
    holdId: text('hold_id'),
    /** Balance snapshot AFTER this entry is applied (denormalized for reconciliation). */
    balanceAfter: bigint('balance_after', { mode: 'bigint' }).notNull(),
    /** Idempotency key for this entry.  Two entries sharing a key are duplicates. */
    idempotencyKey: varchar('idempotency_key', { length: 128 }).notNull(),
    /** Optional reference to the triggering order (e.g. credit top-up). */
    orderId: text('order_id').references(() => orders.id, { onDelete: 'restrict' }),
    /** Optional reference to the triggering usage record (e.g. debit after LLM call). */
    usageRecordId: text('usage_record_id'),
    /** Human-readable or machine-parseable reason code. */
    reason: varchar('reason', { length: 256 }),
    /** Operator user ID for manual adjustments (admin top-up / deduction). */
    operatorUserId: text('operator_user_id').references(() => users.id, { onDelete: 'restrict' }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('ledger_entries_idempotency_key_unique').on(t.idempotencyKey),
    uniqueIndex('ledger_entries_hold_finalization_unique').on(t.holdId),
    check(
      'ledger_entries_balanced_delta',
      sql`${t.delta} = ${t.availableDelta} + ${t.reservedDelta}`,
    ),
    index('ledger_entries_billing_account_id_created_at_idx').on(t.billingAccountId, t.createdAt),
    index('ledger_entries_order_id_idx').on(t.orderId),
    index('ledger_entries_usage_record_id_idx').on(t.usageRecordId),
    index('ledger_entries_kind_idx').on(t.kind),
    // Composite index for StaleHoldReaper: WHERE kind='hold' AND created_at < cutoff
    index('ledger_entries_kind_created_at_idx').on(t.kind, t.createdAt),
  ],
);

export type LedgerEntry = typeof ledgerEntries.$inferSelect;
export type NewLedgerEntry = typeof ledgerEntries.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────────
// usage_records
// ─────────────────────────────────────────────────────────────────────────────

/**
 * One row per model invocation attempt, whether or not it succeeded.
 *
 * `requestId` is the application-level idempotency key supplied by the caller;
 * retries carry the same `requestId` so the ledger can detect duplicates.
 */
export const usageRecords = pgTable(
  'usage_records',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => `usageRecords_${globalThis.crypto.randomUUID()}`)
      .notNull(),
    billingAccountId: text('billing_account_id')
      .references(() => billingAccounts.id, { onDelete: 'restrict' })
      .notNull(),
    userId: text('user_id')
      .references(() => users.id, { onDelete: 'restrict' })
      .notNull(),
    /** Application-level idempotency key — retries share the same key. */
    requestId: varchar('request_id', { length: 128 }).notNull(),
    /** AI model identifier, e.g. "gpt-4o". */
    modelId: varchar('model_id', { length: 128 }).notNull(),
    /** Provider slug, e.g. "openai", "anthropic". */
    provider: varchar('provider', { length: 64 }).notNull(),
    /** FK to the price snapshot used at request time. */
    planPriceId: text('plan_price_id').references(() => planPrices.id, { onDelete: 'restrict' }),
    /**
     * Immutable price snapshot at request time.
     * Avoids stale reads if prices change after the request completes.
     */
    priceSnapshot: jsonb('price_snapshot').$type<Record<string, string>>(),
    /** Prompt tokens consumed (integer). */
    promptTokens: integer('prompt_tokens').notNull().default(0),
    /** Completion tokens consumed (integer). */
    completionTokens: integer('completion_tokens').notNull().default(0),
    /** Total tokens = promptTokens + completionTokens. */
    totalTokens: integer('total_tokens').notNull().default(0),
    /** Credits charged for this request (integer units, positive = cost). */
    creditsCharged: bigint('credits_charged', { mode: 'bigint' })
      .notNull()
      .default(sql`0`),
    /** 'hold' = pre-reserved, 'settled' = final, 'released' = reversed */
    settlementStatus: varchar('settlement_status', { length: 16 }).notNull().default('hold'),
    /** FK to the ledger entry that settled / released this usage. */
    ledgerEntryId: text('ledger_entry_id').references(() => ledgerEntries.id, {
      onDelete: 'restrict',
    }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('usage_records_request_id_billing_account_id_unique').on(
      t.requestId,
      t.billingAccountId,
    ),
    index('usage_records_billing_account_id_created_at_idx').on(t.billingAccountId, t.createdAt),
    index('usage_records_user_id_idx').on(t.userId),
    index('usage_records_model_id_idx').on(t.modelId),
  ],
);

export type UsageRecord = typeof usageRecords.$inferSelect;
export type NewUsageRecord = typeof usageRecords.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────────
// webhook_events
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Verified provider webhook events.
 *
 * Signature verification MUST happen before any row is written.
 * The raw payload is stored after PII/secret scrubbing (see service layer).
 * (provider, eventId) is unique — the same event delivered multiple times is
 * idempotent because `ON CONFLICT DO NOTHING` prevents double-processing.
 */
export const webhookEvents = pgTable(
  'webhook_events',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => `webhookEvents_${globalThis.crypto.randomUUID()}`)
      .notNull(),
    /** Payment provider slug, e.g. "stripe", "alipay". */
    provider: varchar('provider', { length: 32 }).notNull(),
    /** Provider-assigned event ID, e.g. Stripe `evt_xxx`. */
    eventId: varchar('event_id', { length: 256 }).notNull(),
    /** Provider event type, e.g. "payment_intent.succeeded". */
    eventType: varchar('event_type', { length: 128 }).notNull(),
    status: varchar('status', { length: 16 })
      .$type<WebhookEventStatus>()
      .notNull()
      .default('pending'),
    /** Scrubbed provider payload (no secrets or raw card data). */
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    /** Internal order ID resolved from the payload, if applicable. */
    orderId: text('order_id').references(() => orders.id, { onDelete: 'restrict' }),
    /**
     * SHA-256 hex digest of the raw (pre-parse) provider request body.
     * Used to detect same event_id with different payload — which is a
     * security anomaly and must be rejected with an alert.
     */
    payloadHash: varchar('payload_hash', { length: 64 }),
    /** Number of processing attempts (for retry observability). */
    attemptCount: integer('attempt_count').notNull().default(0),
    /**
     * Timestamp when this event row was locked for processing.
     * Acts as a crash-lease: if the processing pod dies, another instance
     * can take over after `processingStartedAt + timeout`.
     */
    processingStartedAt: timestamptz('processing_started_at'),
    processedAt: timestamptz('processed_at'),
    failureReason: text('failure_reason'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('webhook_events_provider_event_id_unique').on(t.provider, t.eventId),
    index('webhook_events_status_idx').on(t.status),
    index('webhook_events_order_id_idx').on(t.orderId),
    index('webhook_events_created_at_idx').on(t.createdAt),
  ],
);

export type WebhookEvent = typeof webhookEvents.$inferSelect;
export type NewWebhookEvent = typeof webhookEvents.$inferInsert;
