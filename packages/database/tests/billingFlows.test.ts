// @vitest-environment node
import { createSign, generateKeyPairSync, randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getAdminAlipayConfig, getAdminCatalog } from '@/server/services/adminManagement';
import { billChat } from '@/server/services/billing/chat';
import { reserveGeneration, settleGeneration } from '@/server/services/billing/generation';
import { AlipayPaymentService } from '@/server/services/payment/AlipayPaymentService';

import { getTestDB } from '../src/core/getTestDB';
import { BillingAccountModel } from '../src/models/billing';
import { WalletModel } from '../src/models/billingWallet';
import { ledgerEntries, orders, planPrices, plans, usageRecords, users } from '../src/schemas';

vi.mock('@/server/services/adminManagement', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getAdminAlipayConfig: vi.fn(),
  getAdminCatalog: vi.fn(),
}));

const db = await getTestDB();
const payments = new AlipayPaymentService(db);
const wallet = new WalletModel(db);
const keys = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { format: 'pem', type: 'pkcs8' },
  publicKeyEncoding: { format: 'pem', type: 'spki' },
});
let userId: string;
let accountId: string;
let priceId: string;

beforeEach(async () => {
  userId = randomUUID();
  await db.insert(users).values({ id: userId });
  accountId = (await new BillingAccountModel(db, userId).createForUser({ currency: 'CNY' })).id;
  const [plan] = await db
    .insert(plans)
    .values({ name: 'Test pack', slug: randomUUID(), tokenGrantMonthly: 500n })
    .returning();
  const [price] = await db
    .insert(planPrices)
    .values({ planId: plan.id, amountMinor: 990n, currency: 'CNY', billingInterval: 'one_time' })
    .returning();
  priceId = price.id;
  vi.mocked(getAdminAlipayConfig).mockResolvedValue({
    enabled: true,
    ...keys,
    config: {
      appId: 'test-app',
      merchantId: 'test-seller',
      currency: 'CNY',
      sandbox: true,
      notifyURL: 'https://merchant.test/api/webhooks/alipay',
      returnURL: 'https://merchant.test/settings/plans',
    },
  });
  vi.mocked(getAdminCatalog).mockResolvedValue({
    providers: [],
    prices: [
      {
        modelType: 'chat',
        id: 'price',
        provider: 'openai',
        modelId: 'test-model',
        promptCreditsPerKToken: 2,
        completionCreditsPerKToken: 8,
        requestCreditsFlat: 0,
        contextWindow: 8192,
        displayName: '',
        functionCall: false,
        vision: false,
      },
    ],
  });
});

function notification(orderNo: string, override: Record<string, string> = {}) {
  const fields: Record<string, string> = {
    app_id: 'test-app',
    seller_id: 'test-seller',
    out_trade_no: orderNo,
    trade_no: `trade-${orderNo}`,
    total_amount: '9.90',
    notify_id: randomUUID(),
    trade_status: 'TRADE_SUCCESS',
    ...override,
  };
  const canonical = Object.keys(fields)
    .sort()
    .map((key) => `${key}=${fields[key]}`)
    .join('&');
  return new URLSearchParams({
    ...fields,
    sign_type: 'RSA2',
    sign: createSign('RSA-SHA256').update(canonical).sign(keys.privateKey, 'base64'),
  }).toString();
}

describe('Alipay order and ledger transaction', () => {
  it('credits the frozen grant exactly once across duplicate and distinct success events', async () => {
    const key = randomUUID();
    const order = await payments.createOrder(userId, priceId, key);
    expect((await payments.createOrder(userId, priceId, key)).orderId).toBe(order.orderId);
    await db.update(plans).set({ tokenGrantMonthly: 999n });
    const body = notification(order.orderNo);
    await Promise.all([payments.processNotification(body), payments.processNotification(body)]);
    await payments.processNotification(
      notification(order.orderNo, { trade_status: 'TRADE_FINISHED' }),
    );
    expect(await wallet.findByBillingAccountId(accountId)).toMatchObject({
      available: 500n,
      reserved: 0n,
    });
    expect(
      await db.select().from(ledgerEntries).where(eq(ledgerEntries.orderId, order.orderId)),
    ).toHaveLength(1);
    expect((await db.select().from(orders).where(eq(orders.id, order.orderId)))[0].status).toBe(
      'paid',
    );
  });

  it('rejects forged notifications and signed wrong merchant or amount without crediting', async () => {
    const order = await payments.createOrder(userId, priceId, randomUUID());
    await expect(
      payments.processNotification(notification(order.orderNo).replace('9.90', '0.01')),
    ).rejects.toThrow();
    for (const override of [
      { app_id: 'other-app' },
      { seller_id: 'other-seller' },
      { total_amount: '0.01' },
    ] as Record<string, string>[]) {
      await expect(
        payments.processNotification(notification(order.orderNo, override)),
      ).rejects.toThrow();
    }
    expect(await wallet.findByBillingAccountId(accountId)).toMatchObject({
      available: 0n,
      reserved: 0n,
    });
  });

  it('accepts a verified late success after close, but never reverses a paid order on close', async () => {
    const order = await payments.createOrder(userId, priceId, randomUUID());
    await payments.processNotification(
      notification(order.orderNo, { trade_status: 'TRADE_CLOSED' }),
    );
    await payments.processNotification(notification(order.orderNo));
    await payments.processNotification(
      notification(order.orderNo, { trade_status: 'TRADE_CLOSED' }),
    );
    expect(await wallet.findByBillingAccountId(accountId)).toMatchObject({ available: 500n });
    expect((await db.select().from(orders).where(eq(orders.id, order.orderId)))[0].status).toBe(
      'paid',
    );
  });
});

describe('streamed chat billing', () => {
  const payload = {
    messages: [{ role: 'user' as const, content: 'Hello' }],
    model: 'test-model',
    max_tokens: 1000,
  };
  const identity = () => ({ db, provider: 'openai', userId, userHasCredentials: false });
  const fund = () =>
    wallet.credit({ billingAccountId: accountId, delta: 100n, idempotencyKey: randomUUID() });

  it('holds before streaming and debits separate actual input/output only when the stream ends', async () => {
    await fund();
    let end!: () => Promise<void>;
    const response = await billChat(
      async (_, options) =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode('hello'));
              end = async () => {
                await options?.callback?.onUsage?.({
                  totalInputTokens: 1000,
                  totalOutputTokens: 100,
                });
                controller.close();
              };
            },
          }),
        ),
      identity(),
      payload,
    );
    expect((await wallet.findByBillingAccountId(accountId))!.reserved).toBeGreaterThan(0n);
    const consumed = response.text();
    await end();
    expect(await consumed).toBe('hello');
    expect(await wallet.findByBillingAccountId(accountId)).toMatchObject({
      available: 97n,
      reserved: 0n,
    });
    expect(
      (await db.select().from(usageRecords).where(eq(usageRecords.userId, userId)))[0],
    ).toMatchObject({ creditsCharged: 3n, settlementStatus: 'settled' });
  });

  it('releases on provider failure, missing usage and canceled streams', async () => {
    await fund();
    await expect(
      billChat(
        async () => {
          throw new Error('provider failed');
        },
        identity(),
        payload,
      ),
    ).rejects.toThrow('provider failed');
    await (await billChat(async () => new Response('no usage'), identity(), payload)).text();
    const response = await billChat(
      async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new Uint8Array([1]));
            },
          }),
        ),
      identity(),
      payload,
    );
    await response.body!.cancel();
    expect(await wallet.findByBillingAccountId(accountId)).toMatchObject({
      available: 100n,
      reserved: 0n,
    });
  });

  it('does not call the platform without funds or a price, while BYOK does not touch the wallet', async () => {
    const call = vi.fn(async () => new Response('byok'));
    await expect(billChat(call, identity(), payload)).rejects.toBeDefined();
    expect(call).not.toHaveBeenCalled();
    vi.mocked(getAdminCatalog).mockResolvedValue({ prices: [], providers: [] });
    await expect(billChat(call, identity(), payload)).rejects.toBeDefined();
    expect(call).not.toHaveBeenCalled();
    expect(
      await (await billChat(call, { ...identity(), userHasCredentials: true }, payload)).text(),
    ).toBe('byok');
    expect(
      await db.select().from(ledgerEntries).where(eq(ledgerEntries.billingAccountId, accountId)),
    ).toHaveLength(0);
  });
});

describe('generation reservations', () => {
  beforeEach(async () => {
    vi.stubEnv('ADMIN_SERVICE_URL', 'http://admin.test');
    const catalog = await getAdminCatalog();
    catalog!.prices[0].requestCreditsFlat = 20;
    catalog!.prices[0].modelType = 'image';
    await wallet.credit({ billingAccountId: accountId, delta: 50n, idempotencyKey: randomUUID() });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });
  const params = () => ({ count: 2, model: 'test-model', modelType: 'image' as const, provider: 'openai', userId });

  it('rejects a chat price for an image request without reserving credits', async () => {
    const catalog = await getAdminCatalog();
    catalog!.prices[0].modelType = 'chat';
    await expect(reserveGeneration(db, params())).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
    expect(await wallet.findByBillingAccountId(accountId)).toMatchObject({ available: 50n, reserved: 0n });
  });

  it('settles each successful output once and releases the failed output', async () => {
    const handles = await reserveGeneration(db, params());
    expect(await wallet.findByBillingAccountId(accountId)).toMatchObject({
      available: 10n,
      reserved: 40n,
    });
    await settleGeneration(db, { ...params(), handle: handles![0] });
    await settleGeneration(db, { ...params(), handle: handles![0] });
    await settleGeneration(db, { ...params(), handle: handles![0], isError: true });
    await settleGeneration(db, { ...params(), handle: handles![1], isError: true });
    expect(await wallet.findByBillingAccountId(accountId)).toMatchObject({
      available: 30n,
      reserved: 0n,
    });
  });

  it('rolls back all reservations if a batch exceeds the balance and rejects foreign handles', async () => {
    await expect(reserveGeneration(db, { ...params(), count: 3 })).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
    });
    expect(await wallet.findByBillingAccountId(accountId)).toMatchObject({
      available: 50n,
      reserved: 0n,
    });
    const handles = await reserveGeneration(db, { ...params(), count: 1 });
    await expect(
      settleGeneration(db, { ...params(), userId: 'another-user', handle: handles![0] }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(await wallet.findByBillingAccountId(accountId)).toMatchObject({
      available: 30n,
      reserved: 20n,
    });
  });
});
