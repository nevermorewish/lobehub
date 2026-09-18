import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';

import {
  billingAccounts,
  ledgerEntries,
  orders,
  usageRecords,
  wallets,
} from '@/database/schemas/billing';
import { router } from '@/libs/trpc/lambda';

import { billingProcedure } from './billingProcedure';

const page = z
  .object({
    limit: z.number().int().min(1).max(100).default(25),
    offset: z.number().int().min(0).max(100000).default(0),
  })
  .default({ limit: 25, offset: 0 });

export const spendRouter = router({
  balance: billingProcedure.query(async ({ ctx }) => {
    const [row] = await ctx.serverDB
      .select({ available: wallets.available, reserved: wallets.reserved })
      .from(wallets)
      .innerJoin(billingAccounts, eq(wallets.billingAccountId, billingAccounts.id))
      .where(eq(billingAccounts.userId, ctx.userId));
    return {
      available: (row?.available ?? 0n).toString(),
      reserved: (row?.reserved ?? 0n).toString(),
    };
  }),
  ledgerHistory: billingProcedure.input(page).query(async ({ ctx, input }) => {
    const rows = await ctx.serverDB
      .select({ entry: ledgerEntries })
      .from(ledgerEntries)
      .innerJoin(billingAccounts, eq(ledgerEntries.billingAccountId, billingAccounts.id))
      .where(eq(billingAccounts.userId, ctx.userId))
      .orderBy(desc(ledgerEntries.createdAt), desc(ledgerEntries.id))
      .limit(input.limit)
      .offset(input.offset);
    return rows.map(({ entry }) => ({
      id: entry.id,
      kind: entry.kind,
      delta: entry.delta.toString(),
      availableDelta: entry.availableDelta.toString(),
      reservedDelta: entry.reservedDelta.toString(),
      balanceAfter: entry.balanceAfter.toString(),
      createdAt: entry.createdAt,
      reason: entry.reason,
    }));
  }),
  orders: billingProcedure.input(page).query(async ({ ctx, input }) => {
    const rows = await ctx.serverDB
      .select()
      .from(orders)
      .where(eq(orders.userId, ctx.userId))
      .orderBy(desc(orders.createdAt), desc(orders.id))
      .limit(input.limit)
      .offset(input.offset);
    return rows.map((row) => ({
      id: row.id,
      orderNo: row.orderNo,
      amountMinor: row.amountMinor.toString(),
      creditGrant: row.priceSnapshot.creditGrant,
      status: row.status,
      currency: row.currency,
      createdAt: row.createdAt,
    }));
  }),
  usageHistory: billingProcedure.input(page).query(async ({ ctx, input }) => {
    const rows = await ctx.serverDB
      .select({ usage: usageRecords })
      .from(usageRecords)
      .innerJoin(billingAccounts, eq(usageRecords.billingAccountId, billingAccounts.id))
      .where(and(eq(usageRecords.userId, ctx.userId), eq(billingAccounts.userId, ctx.userId)))
      .orderBy(desc(usageRecords.createdAt), desc(usageRecords.id))
      .limit(input.limit)
      .offset(input.offset);
    return rows.map(({ usage }) => ({
      id: usage.id,
      model: usage.modelId,
      provider: usage.provider,
      promptTokens: usage.promptTokens,
      completionTokens: usage.completionTokens,
      credits: usage.creditsCharged.toString(),
      status: usage.settlementStatus,
      createdAt: usage.createdAt,
    }));
  }),
});
