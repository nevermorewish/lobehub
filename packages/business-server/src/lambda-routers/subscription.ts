import { and, eq, isNull } from 'drizzle-orm';

import { planPrices,plans } from '@/database/schemas/billing';
import { router } from '@/libs/trpc/lambda';

import { billingProcedure } from './billingProcedure';

export const subscriptionRouter = router({
  listPlans: billingProcedure.query(async ({ ctx }) => {
    const rows = await ctx.serverDB
      .select({ plan: plans, price: planPrices })
      .from(plans)
      .innerJoin(planPrices, eq(planPrices.planId, plans.id))
      .where(
        and(
          eq(plans.status, 'active'),
          isNull(planPrices.archivedAt),
          eq(planPrices.billingInterval, 'one_time'),
        ),
      )
      .orderBy(plans.sortOrder);
    return rows.map(({ plan, price }) => ({
      id: plan.id,
      name: plan.name,
      description: plan.description,
      creditGrant: plan.tokenGrantMonthly.toString(),
      priceId: price.id,
      amountMinor: price.amountMinor.toString(),
      currency: price.currency,
    }));
  }),
});
