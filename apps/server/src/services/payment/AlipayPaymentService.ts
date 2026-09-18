import { randomUUID } from 'node:crypto';

import { PriceSnapshotService } from '@lobechat/billing';
import { TRPCError } from '@trpc/server';
import { and, eq } from 'drizzle-orm';

import { BillingAccountModel } from '@/database/models/billing';
import { WalletModel } from '@/database/models/billingWallet';
import { orders, paymentAttempts, webhookEvents } from '@/database/schemas/billing';
import type { LobeChatDatabase } from '@/database/type';
import { getAdminAlipayConfig } from '@/server/services/adminManagement';

import {
  createAlipayCheckout,
  parseAlipayAmount,
  verifyAlipayNotification,
} from './alipayProtocol';

export class AlipayPaymentService {
  constructor(private readonly db: LobeChatDatabase) {}

  async createOrder(userId: string, planPriceId: string, idempotencyKey: string) {
    const configuration = await getAdminAlipayConfig();
    if (!configuration?.enabled)
      throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Alipay is not enabled' });
    const account = await new BillingAccountModel(this.db, userId).createForUser({
      currency: 'CNY',
    });
    if (account.status !== 'active') throw new TRPCError({ code: 'FORBIDDEN' });
    const order = await this.db.transaction(async (tx) => {
      // Serialize concurrent checkout attempts, including the first insert.
      const { billingAccounts } = await import('@/database/schemas/billing');
      await tx
        .select()
        .from(billingAccounts)
        .where(eq(billingAccounts.id, account.id))
        .for('update');
      const [existing] = await tx
        .select()
        .from(orders)
        .where(and(eq(orders.userId, userId), eq(orders.idempotencyKey, idempotencyKey)));
      if (existing) {
        if (existing.planPriceId !== planPriceId || existing.status !== 'pending') {
          throw new TRPCError({
            code: 'CONFLICT',
            message: 'Order already exists with a different state',
          });
        }
        return existing;
      }
      const snapshot = await new PriceSnapshotService(
        tx as unknown as LobeChatDatabase,
      ).freezeSnapshot(planPriceId);
      if (
        snapshot.currency !== 'CNY' ||
        snapshot.billingInterval !== 'one_time' ||
        snapshot.amountMinor <= 0n ||
        !snapshot.creditGrant ||
        snapshot.creditGrant <= 0n
      ) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Only published CNY credit packs can be purchased',
        });
      }
      const [created] = await tx
        .insert(orders)
        .values({
          amountMinor: snapshot.amountMinor,
          billingAccountId: account.id,
          currency: 'CNY',
          idempotencyKey,
          orderNo: `LH${randomUUID().replaceAll('-', '')}`,
          planPriceId,
          userId,
          paymentAppId: configuration.config.appId,
          paymentSellerId: configuration.config.merchantId,
          paymentSandbox: configuration.config.sandbox,
          priceSnapshot: {
            amountMinor: snapshot.amountMinor.toString(),
            billingInterval: snapshot.billingInterval,
            creditGrant: snapshot.creditGrant.toString(),
            currency: snapshot.currency,
            planId: snapshot.planId,
            planPriceId,
          },
        })
        .returning();
      await tx
        .insert(paymentAttempts)
        .values({
          idempotencyKey: `alipay:${created.id}`,
          orderId: created.id,
          provider: 'alipay',
        });
      return created;
    });
    if (
      order.paymentAppId !== configuration.config.appId ||
      order.paymentSellerId !== configuration.config.merchantId ||
      order.paymentSandbox !== configuration.config.sandbox
    ) {
      throw new TRPCError({
        code: 'CONFLICT',
        message: 'Payment configuration changed; create a new order',
      });
    }
    return {
      orderId: order.id,
      orderNo: order.orderNo,
      checkoutUrl: createAlipayCheckout({
        amountMinor: order.amountMinor,
        merchant: configuration.config,
        orderId: order.id,
        orderNo: order.orderNo,
        privateKey: configuration.privateKey,
      }),
    };
  }

  async processNotification(rawBody: string) {
    const configuration = await getAdminAlipayConfig();
    if (!configuration) throw new Error('Alipay verification is not configured');
    const fields = verifyAlipayNotification(rawBody, configuration.publicKey);
    return this.db.transaction(async (tx) => {
      const [order] = await tx
        .select()
        .from(orders)
        .where(eq(orders.orderNo, fields.out_trade_no))
        .for('update');
      if (
        !order ||
        order.paymentProvider !== 'alipay' ||
        order.currency !== 'CNY' ||
        order.paymentAppId !== fields.app_id ||
        order.paymentSellerId !== fields.seller_id ||
        order.paymentSandbox !== configuration.config.sandbox ||
        order.amountMinor !== parseAlipayAmount(fields.total_amount)
      ) {
        throw new Error('Alipay notification does not match order');
      }
      if (
        !['TRADE_SUCCESS', 'TRADE_FINISHED', 'TRADE_CLOSED', 'WAIT_BUYER_PAY'].includes(
          fields.trade_status,
        )
      ) {
        throw new Error('Unsupported Alipay trade status');
      }
      if (order.providerTradeNo && order.providerTradeNo !== fields.trade_no)
        throw new Error('Trade identity mismatch');
      const success =
        fields.trade_status === 'TRADE_SUCCESS' || fields.trade_status === 'TRADE_FINISHED';
      const [event] = await tx
        .insert(webhookEvents)
        .values({
          eventId: fields.notify_id,
          eventType: fields.trade_status,
          orderId: order.id,
          payload: {
            orderNo: order.orderNo,
            tradeNo: fields.trade_no,
            tradeStatus: fields.trade_status,
          },
          provider: 'alipay',
        })
        .onConflictDoNothing()
        .returning();
      if (!event) {
        const [existing] = await tx
          .select()
          .from(webhookEvents)
          .where(
            and(eq(webhookEvents.provider, 'alipay'), eq(webhookEvents.eventId, fields.notify_id)),
          );
        if (existing?.orderId !== order.id || existing.eventType !== fields.trade_status)
          throw new Error('Notification identity mismatch');
        return;
      }
      if (success && order.status !== 'paid') {
        // A verified late success is authoritative, even if a previous close notification arrived first.
        const credits = BigInt(order.priceSnapshot.creditGrant);
        if (credits <= 0n) throw new Error('Invalid order credit snapshot');
        await new WalletModel(tx as unknown as LobeChatDatabase).credit({
          billingAccountId: order.billingAccountId,
          delta: credits,
          idempotencyKey: `payment:alipay:${order.id}`,
          orderId: order.id,
          reason: 'alipay_payment',
        });
        await tx
          .update(orders)
          .set({ paidAt: new Date(), providerTradeNo: fields.trade_no, status: 'paid' })
          .where(eq(orders.id, order.id));
        await tx
          .update(paymentAttempts)
          .set({ providerRef: fields.trade_no, status: 'succeeded' })
          .where(eq(paymentAttempts.orderId, order.id));
      } else if (fields.trade_status === 'TRADE_CLOSED' && order.status === 'pending') {
        await tx
          .update(orders)
          .set({ closedAt: new Date(), status: 'closed', providerTradeNo: fields.trade_no })
          .where(eq(orders.id, order.id));
        await tx
          .update(paymentAttempts)
          .set({ status: 'canceled' })
          .where(eq(paymentAttempts.orderId, order.id));
      }
      await tx
        .update(webhookEvents)
        .set({ attemptCount: 1, processedAt: new Date(), status: 'processed' })
        .where(eq(webhookEvents.id, event.id));
    });
  }
}
