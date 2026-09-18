import { TRPCError } from '@trpc/server';
import { eq } from 'drizzle-orm';

import { BillingAccountModel, OrderModel } from '@/database/models/billing';
import { users } from '@/database/schemas/user';
import { authedProcedure } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { AlipayPaymentService } from '@/server/services/payment/AlipayPaymentService';

export const billingProcedure = authedProcedure.use(serverDatabase).use(async ({ ctx, next }) => {
  const [user] = await ctx.serverDB
    .select({ banned: users.banned, banExpires: users.banExpires })
    .from(users)
    .where(eq(users.id, ctx.userId));
  if (!user || (user.banned && (!user.banExpires || user.banExpires > new Date()))) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Account suspended' });
  }
  return next({
    ctx: {
      billingAccountModel: new BillingAccountModel(ctx.serverDB, ctx.userId),
      billingOrderModel: new OrderModel(ctx.serverDB, ctx.userId),
      paymentService: new AlipayPaymentService(ctx.serverDB),
    },
  });
});
