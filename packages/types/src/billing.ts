export type BillingAccountStatus = 'active' | 'suspended' | 'closed';

export type PlanStatus = 'active' | 'archived';
export type PlanPriceCurrency = string; // ISO 4217, e.g. "CNY", "USD"
export type PlanPriceBillingInterval = 'one_time' | 'monthly' | 'yearly';

export type SubscriptionStatus =
  | 'trialing'
  | 'active'
  | 'past_due'
  | 'canceled'
  | 'unpaid'
  | 'paused';

/** Internal order state machine:  pending → paid | closed | failed */
export type OrderStatus = 'pending' | 'paid' | 'closed' | 'failed';

/** Legal transitions from each state */
export const ORDER_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  pending: ['paid', 'closed', 'failed'],
  paid: [],
  closed: [],
  failed: [],
};

export type PaymentAttemptStatus = 'pending' | 'succeeded' | 'failed' | 'canceled';

export type LedgerEntryKind = 'credit' | 'debit' | 'grant' | 'hold' | 'release' | 'refund' | 'expiry';

export type WebhookEventStatus = 'pending' | 'processed' | 'failed' | 'ignored';
