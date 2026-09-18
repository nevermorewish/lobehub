// @vitest-environment node
import { randomUUID } from 'node:crypto';

import { eq, sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { ledgerEntries, users, wallets } from '../../schemas';
import { BillingAccountModel } from '../billing';
import { WalletModel } from '../billingWallet';

const db = await getTestDB();
const model = new WalletModel(db);
let accountId: string;

beforeEach(async () => {
  const userId = randomUUID();
  await db.insert(users).values({ id: userId });
  const account = await new BillingAccountModel(db, userId).createForUser({ currency: 'CNY' });
  accountId = account.id;
  await model.credit({ billingAccountId: accountId, delta: 100n, idempotencyKey: randomUUID() });
});

const hold = (amount = 20n) =>
  model.hold({ amount, billingAccountId: accountId, idempotencyKey: randomUUID() });
const settle = (holdId: string, actual = 7n) =>
  model.settle({
    actualAmount: actual,
    billingAccountId: accountId,
    debitIdempotencyKey: randomUUID(),
    heldAmount: 20n,
    holdLedgerEntryId: holdId,
    releaseIdempotencyKey: randomUUID(),
  });

describe('wallet ledger invariants', () => {
  it('settles once, releases the remainder, and reconciles both wallet buckets', async () => {
    const reservation = await hold();
    expect(reservation.wallet.available).toBe(80n);
    expect(reservation.wallet.reserved).toBe(20n);
    await settle(reservation.ledger.id);
    await settle(reservation.ledger.id);
    await model.release({
      amount: 20n,
      billingAccountId: accountId,
      holdLedgerEntryId: reservation.ledger.id,
      idempotencyKey: randomUUID(),
    });
    const wallet = await model.findByBillingAccountId(accountId);
    expect(wallet).toMatchObject({ available: 93n, reserved: 0n });
    const [sum] = await db
      .select({
        available: sql<string>`sum(${ledgerEntries.availableDelta})`,
        net: sql<string>`sum(${ledgerEntries.delta})`,
        reserved: sql<string>`sum(${ledgerEntries.reservedDelta})`,
      })
      .from(ledgerEntries)
      .where(eq(ledgerEntries.billingAccountId, accountId));
    expect(BigInt(sum.available)).toBe(wallet!.available);
    expect(BigInt(sum.reserved)).toBe(wallet!.reserved);
    expect(BigInt(sum.net)).toBe(93n);
  });

  it('cannot settle a released hold or a hold belonging to a different account', async () => {
    const reservation = await hold();
    await model.release({
      amount: 20n,
      billingAccountId: accountId,
      holdLedgerEntryId: reservation.ledger.id,
      idempotencyKey: randomUUID(),
    });
    await expect(settle(reservation.ledger.id)).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(settle(randomUUID())).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
    expect(await model.findByBillingAccountId(accountId)).toMatchObject({
      available: 100n,
      reserved: 0n,
    });
  });

  it('rejects negative credits and mismatched retries without changing balances', async () => {
    const key = randomUUID();
    await model.credit({ billingAccountId: accountId, delta: 10n, idempotencyKey: key });
    await model.credit({ billingAccountId: accountId, delta: 10n, idempotencyKey: key });
    await expect(
      model.credit({ billingAccountId: accountId, delta: 11n, idempotencyKey: key }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(
      model.credit({ billingAccountId: accountId, delta: -1n, idempotencyKey: randomUUID() }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(await model.findByBillingAccountId(accountId)).toMatchObject({ available: 110n });
  });

  it('rejects overdraw and prevents reusing a completed request', async () => {
    await expect(hold(101n)).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
    const params = { amount: 20n, billingAccountId: accountId, idempotencyKey: randomUUID() };
    const reservation = await model.hold(params);
    await settle(reservation.ledger.id);
    await expect(model.hold(params)).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(
      db.update(wallets).set({ reserved: -1n }).where(eq(wallets.billingAccountId, accountId)),
    ).rejects.toThrow();
  });
});
