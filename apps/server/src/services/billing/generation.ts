import { randomUUID } from 'node:crypto';

import { TRPCError } from '@trpc/server';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

import { AiProviderModel } from '@/database/models/aiProvider';
import { BillingAccountModel } from '@/database/models/billing';
import { WalletModel } from '@/database/models/billingWallet';
import { usageRecords } from '@/database/schemas/billing';
import { users } from '@/database/schemas/user';
import type { LobeChatDatabase } from '@/database/type';
import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';
import { getAdminCatalog, hasUserProviderConfiguration } from '@/server/services/adminManagement';

const handleSchema = z.object({ usageId: z.string() });

/** One frozen per-output price, reserved before submitting an asynchronous generation. */
export async function reserveGeneration(
  db: LobeChatDatabase,
  params: {
    count: number;
    model: string;
    modelType: 'image' | 'video';
    provider: string;
    userId: string;
    workspaceId?: string;
  },
) {
  if (!process.env.ADMIN_SERVICE_URL) return undefined;
  if (!Number.isSafeInteger(params.count) || params.count < 1 || params.count > 16)
    throw new TRPCError({ code: 'BAD_REQUEST' });
  const [user] = await db.select().from(users).where(eq(users.id, params.userId));
  if (!user || (user.banned && (!user.banExpires || user.banExpires > new Date())))
    throw new TRPCError({ code: 'FORBIDDEN' });
  const config = await new AiProviderModel(db, params.userId, params.workspaceId).getAiProviderById(
    params.provider,
    KeyVaultsGateKeeper.getUserKeyVaults,
  );
  if (hasUserProviderConfiguration(config?.keyVaults ?? {})) return undefined;
  const catalog = await getAdminCatalog();
  const price = catalog?.prices.find(
    (row) =>
      row.provider === params.provider &&
      row.modelId === params.model &&
      row.modelType === params.modelType,
  );
  if (!price)
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message: 'Generation price is not configured',
    });
  const amount = BigInt(price.requestCreditsFlat);
  const account = await new BillingAccountModel(db, params.userId).createForUser({
    currency: 'CNY',
  });
  return db.transaction(async (tx) => {
    const handles: { usageId: string }[] = [];
    for (let index = 0; index < params.count; index++) {
      const requestId = randomUUID();
      const held = await new WalletModel(tx as unknown as LobeChatDatabase).hold({
        amount,
        billingAccountId: account.id,
        idempotencyKey: `hold:${requestId}`,
        reason: 'generation',
      });
      const [usage] = await tx
        .insert(usageRecords)
        .values({
          billingAccountId: account.id,
          modelId: params.model,
          provider: params.provider,
          requestId,
          userId: params.userId,
          priceSnapshot: {
            priceId: price.id,
            modelType: params.modelType,
            heldCredits: amount.toString(),
            holdId: held.ledger.id,
            unit: 'generation',
            workspaceId: params.workspaceId ?? '',
          },
        })
        .returning();
      handles.push({ usageId: usage.id });
    }
    return handles;
  });
}

export async function settleGeneration(
  db: LobeChatDatabase,
  params: {
    handle: unknown;
    isError?: boolean;
    model: string;
    provider: string;
    userId: string;
  },
) {
  if (!params.handle || !process.env.ADMIN_SERVICE_URL) return;
  const { usageId } = handleSchema.parse(params.handle);
  await db.transaction(async (tx) => {
    const [usage] = await tx
      .select()
      .from(usageRecords)
      .where(
        and(
          eq(usageRecords.id, usageId),
          eq(usageRecords.userId, params.userId),
          eq(usageRecords.provider, params.provider),
          eq(usageRecords.modelId, params.model),
        ),
      )
      .for('update');
    if (!usage || usage.priceSnapshot?.unit !== 'generation')
      throw new TRPCError({ code: 'FORBIDDEN' });
    if (usage.settlementStatus !== 'hold') return;
    const amount = BigInt(usage.priceSnapshot.heldCredits);
    const wallet = new WalletModel(tx as unknown as LobeChatDatabase);
    const identity = {
      billingAccountId: usage.billingAccountId,
      holdLedgerEntryId: usage.priceSnapshot.holdId,
      usageRecordId: usage.id,
    };
    const ledger = params.isError
      ? (
          await wallet.release({
            ...identity,
            amount,
            idempotencyKey: `release:${usage.requestId}`,
            reason: 'generation_failed',
          })
        ).ledger
      : (
          await wallet.settle({
            ...identity,
            actualAmount: amount,
            heldAmount: amount,
            debitIdempotencyKey: `debit:${usage.requestId}`,
            releaseIdempotencyKey: `release:${usage.requestId}`,
            reason: 'generation',
          })
        ).debitEntry;
    await tx
      .update(usageRecords)
      .set({
        ledgerEntryId: ledger.id,
        settlementStatus: params.isError ? 'released' : 'settled',
        creditsCharged: params.isError ? 0n : amount,
      })
      .where(eq(usageRecords.id, usage.id));
  });
}
