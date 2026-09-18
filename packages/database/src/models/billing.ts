import { ORDER_TRANSITIONS, type OrderStatus } from '@lobechat/types';
/**
 * Wedai commercial billing repository
 *
 * All public methods that change balances MUST:
 *  1. Run inside a single database transaction.
 *  2. Write a ledger entry with a unique idempotency key.
 *  3. Update the wallet using an optimistic-lock version check.
 *
 * Methods that can raise a TRPCError do so with the appropriate code:
 *  - CONFLICT      – idempotency key already exists (duplicate request)
 *  - PRECONDITION_FAILED – insufficient balance or invalid state transition
 *  - NOT_FOUND     – entity not found for the calling user
 */
import { TRPCError } from '@trpc/server';
import { and, eq, sql } from 'drizzle-orm';

import {
  type BillingAccount,
  billingAccounts,
  type NewBillingAccount,
  type NewOrder,
  type NewPaymentAttempt,
  type NewPlan,
  type NewPlanPrice,
  type NewSubscription,
  type NewUsageRecord,
  type NewWebhookEvent,
  type Order,
  orders,
  paymentAttempts,
  type Plan,
  type PlanPrice,
  planPrices,
  plans,
  type Subscription,
  subscriptions,
  type UsageRecord,
  usageRecords,
  wallets,
  type WebhookEvent,
  webhookEvents,
} from '../schemas/billing';
import type { LobeChatDatabase } from '../type';

// ─────────────────────────────────────────────────────────────────────────────
// BillingAccountModel
// ─────────────────────────────────────────────────────────────────────────────

export class BillingAccountModel {
  constructor(
    private readonly db: LobeChatDatabase,
    private readonly userId: string,
  ) {}

  async findByUserId(): Promise<BillingAccount | undefined> {
    const [row] = await this.db
      .select()
      .from(billingAccounts)
      .where(eq(billingAccounts.userId, this.userId))
      .limit(1);
    return row;
  }

  async findById(id: string): Promise<BillingAccount | undefined> {
    const [row] = await this.db
      .select()
      .from(billingAccounts)
      .where(and(eq(billingAccounts.id, id), eq(billingAccounts.userId, this.userId)))
      .limit(1);
    return row;
  }

  /** Creates a billing account + wallet in a single transaction. */
  async createForUser(params: Pick<NewBillingAccount, 'currency'>): Promise<BillingAccount> {
    return this.db.transaction(async (tx) => {
      const [account] = await tx
        .insert(billingAccounts)
        .values({ userId: this.userId, currency: params.currency ?? 'CNY' })
        .onConflictDoNothing({ target: billingAccounts.userId })
        .returning();
      const existing =
        account ??
        (await tx.select().from(billingAccounts).where(eq(billingAccounts.userId, this.userId)))[0];
      await tx
        .insert(wallets)
        .values({ billingAccountId: existing.id })
        .onConflictDoNothing({ target: wallets.billingAccountId });
      return existing;
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PlanModel  (admin / read-only from user perspective)
// ─────────────────────────────────────────────────────────────────────────────

export class PlanModel {
  constructor(private readonly db: LobeChatDatabase) {}

  async listActive(): Promise<Plan[]> {
    return this.db.select().from(plans).where(eq(plans.status, 'active')).orderBy(plans.sortOrder);
  }

  async findById(id: string): Promise<Plan | undefined> {
    const [row] = await this.db.select().from(plans).where(eq(plans.id, id)).limit(1);
    return row;
  }

  async findBySlug(slug: string): Promise<Plan | undefined> {
    const [row] = await this.db.select().from(plans).where(eq(plans.slug, slug)).limit(1);
    return row;
  }

  async create(params: NewPlan): Promise<Plan> {
    const [row] = await this.db.insert(plans).values(params).returning();
    return row;
  }

  async createPrice(params: NewPlanPrice): Promise<PlanPrice> {
    const [row] = await this.db.insert(planPrices).values(params).returning();
    return row;
  }

  async findPriceById(id: string): Promise<PlanPrice | undefined> {
    const [row] = await this.db.select().from(planPrices).where(eq(planPrices.id, id)).limit(1);
    return row;
  }

  async listPricesForPlan(planId: string): Promise<PlanPrice[]> {
    return this.db
      .select()
      .from(planPrices)
      .where(and(eq(planPrices.planId, planId), sql`${planPrices.archivedAt} IS NULL`));
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SubscriptionModel
// ─────────────────────────────────────────────────────────────────────────────

export class SubscriptionModel {
  constructor(
    private readonly db: LobeChatDatabase,
    private readonly userId: string,
  ) {}

  private async requireAccount(): Promise<BillingAccount> {
    const [acc] = await this.db
      .select()
      .from(billingAccounts)
      .where(eq(billingAccounts.userId, this.userId))
      .limit(1);
    if (!acc) throw new TRPCError({ code: 'NOT_FOUND', message: 'Billing account not found' });
    return acc;
  }

  async findActive(): Promise<Subscription | undefined> {
    const acc = await this.requireAccount();
    const [row] = await this.db
      .select()
      .from(subscriptions)
      .where(and(eq(subscriptions.billingAccountId, acc.id), eq(subscriptions.status, 'active')))
      .limit(1);
    return row;
  }

  async create(params: Omit<NewSubscription, 'billingAccountId'>): Promise<Subscription> {
    const acc = await this.requireAccount();
    const [row] = await this.db
      .insert(subscriptions)
      .values({ ...params, billingAccountId: acc.id })
      .returning();
    return row;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// OrderModel
// ─────────────────────────────────────────────────────────────────────────────

export class OrderModel {
  constructor(
    private readonly db: LobeChatDatabase,
    private readonly userId: string,
  ) {}

  async findById(id: string): Promise<Order | undefined> {
    const [row] = await this.db
      .select()
      .from(orders)
      .where(and(eq(orders.id, id), eq(orders.userId, this.userId)))
      .limit(1);
    return row;
  }

  async findByIdempotencyKey(key: string): Promise<Order | undefined> {
    const [row] = await this.db
      .select()
      .from(orders)
      .where(and(eq(orders.idempotencyKey, key), eq(orders.userId, this.userId)))
      .limit(1);
    return row;
  }

  async create(params: Omit<NewOrder, 'userId'>): Promise<Order> {
    const [row] = await this.db
      .insert(orders)
      .values({ ...params, userId: this.userId })
      .returning();
    return row;
  }

  /**
   * Transitions an order to a new status, enforcing the state machine.
   *
   * Callers MUST pass the wallet ledger write inside the same transaction via
   * `onTransitionSuccess` when transitioning to `paid`.
   */
  async transition(
    orderId: string,
    nextStatus: OrderStatus,
    onTransitionSuccess?: (tx: LobeChatDatabase) => Promise<void>,
  ): Promise<Order> {
    return this.db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(orders)
        .where(and(eq(orders.id, orderId), eq(orders.userId, this.userId)))
        .for('update')
        .limit(1);

      if (!current) throw new TRPCError({ code: 'NOT_FOUND', message: 'Order not found' });

      const allowed = ORDER_TRANSITIONS[current.status] ?? [];
      if (!allowed.includes(nextStatus)) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: `Illegal order transition: ${current.status} → ${nextStatus}`,
        });
      }

      const now = new Date();
      const [updated] = await tx
        .update(orders)
        .set({
          status: nextStatus,
          paidAt: nextStatus === 'paid' ? now : undefined,
          closedAt: nextStatus === 'closed' ? now : undefined,
        })
        .where(eq(orders.id, orderId))
        .returning();

      if (onTransitionSuccess) {
        await onTransitionSuccess(tx as unknown as LobeChatDatabase);
      }

      return updated;
    });
  }

  async createPaymentAttempt(params: NewPaymentAttempt) {
    const [row] = await this.db.insert(paymentAttempts).values(params).returning();
    return row;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// WalletModel
// ─────────────────────────────────────────────────────────────────────────────

export class UsageRecordModel {
  constructor(
    private readonly db: LobeChatDatabase,
    private readonly userId: string,
  ) {}

  async findByRequestId(
    requestId: string,
    billingAccountId: string,
  ): Promise<UsageRecord | undefined> {
    const [row] = await this.db
      .select()
      .from(usageRecords)
      .where(
        and(
          eq(usageRecords.requestId, requestId),
          eq(usageRecords.billingAccountId, billingAccountId),
          eq(usageRecords.userId, this.userId),
        ),
      )
      .limit(1);
    return row;
  }

  async create(params: Omit<NewUsageRecord, 'userId'>): Promise<UsageRecord> {
    const [row] = await this.db
      .insert(usageRecords)
      .values({ ...params, userId: this.userId })
      .returning();
    return row;
  }

  async settle(
    id: string,
    params: Pick<
      UsageRecord,
      'completionTokens' | 'totalTokens' | 'creditsCharged' | 'ledgerEntryId'
    >,
  ): Promise<UsageRecord> {
    const [row] = await this.db
      .update(usageRecords)
      .set({ ...params, settlementStatus: 'settled' })
      .where(and(eq(usageRecords.id, id), eq(usageRecords.userId, this.userId)))
      .returning();
    return row;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// WebhookEventModel
// ─────────────────────────────────────────────────────────────────────────────

export class WebhookEventModel {
  constructor(private readonly db: LobeChatDatabase) {}

  /**
   * Idempotent upsert — if the (provider, eventId) pair already exists,
   * returns the existing row without side-effects.
   */
  async upsert(params: NewWebhookEvent): Promise<{ event: WebhookEvent; isNew: boolean }> {
    const existing = await this.findByProviderEventId(params.provider, params.eventId);
    if (existing) return { event: existing, isNew: false };

    const [event] = await this.db
      .insert(webhookEvents)
      .values(params)
      .onConflictDoNothing()
      .returning();
    return event
      ? { event, isNew: true }
      : {
          event: (await this.findByProviderEventId(params.provider, params.eventId))!,
          isNew: false,
        };
  }

  async findByProviderEventId(
    provider: string,
    eventId: string,
  ): Promise<WebhookEvent | undefined> {
    const [row] = await this.db
      .select()
      .from(webhookEvents)
      .where(and(eq(webhookEvents.provider, provider), eq(webhookEvents.eventId, eventId)))
      .limit(1);
    return row;
  }

  async markProcessed(id: string): Promise<WebhookEvent> {
    const [row] = await this.db
      .update(webhookEvents)
      .set({
        status: 'processed',
        processedAt: new Date(),
        attemptCount: sql`${webhookEvents.attemptCount} + 1`,
      })
      .where(eq(webhookEvents.id, id))
      .returning();
    return row;
  }

  async markFailed(id: string, reason: string): Promise<WebhookEvent> {
    const [row] = await this.db
      .update(webhookEvents)
      .set({
        status: 'failed',
        failureReason: reason,
        attemptCount: sql`${webhookEvents.attemptCount} + 1`,
      })
      .where(eq(webhookEvents.id, id))
      .returning();
    return row;
  }

  async markIgnored(id: string): Promise<WebhookEvent> {
    const [row] = await this.db
      .update(webhookEvents)
      .set({ status: 'ignored', processedAt: new Date() })
      .where(eq(webhookEvents.id, id))
      .returning();
    return row;
  }
}
