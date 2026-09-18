// @vitest-environment node
import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { users } from '../../schemas';
import { BillingAccountModel } from '../billing';

const db = await getTestDB();

describe('billing accounts', () => {
  it('creates the account and wallet idempotently and isolates users', async () => {
    const userId = randomUUID();
    const otherId = randomUUID();
    await db.insert(users).values([{ id: userId }, { id: otherId }]);
    const owner = new BillingAccountModel(db, userId);
    const first = await owner.createForUser({ currency: 'CNY' });
    const second = await owner.createForUser({ currency: 'CNY' });
    expect(second.id).toBe(first.id);
    expect(await new BillingAccountModel(db, otherId).findById(first.id)).toBeUndefined();
  });
});
