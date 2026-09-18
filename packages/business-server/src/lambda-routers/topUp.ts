import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { router } from '@/libs/trpc/lambda';

import { billingProcedure } from './billingProcedure';

export const topUpRouter = router({
  createOrder: billingProcedure
    .input(
      z.object({
        clientIdempotencyKey: z.string().uuid(),
        planPriceId: z.string().min(1).max(128),
      }),
    )
    .mutation(({ ctx, input }) =>
      ctx.paymentService.createOrder(ctx.userId, input.planPriceId, input.clientIdempotencyKey),
    ),
  getOrder: billingProcedure
    .input(z.object({ orderId: z.string().min(1).max(128) }))
    .query(async ({ ctx, input }) => {
      const order = await ctx.billingOrderModel.findById(input.orderId);
      if (!order) throw new TRPCError({ code: 'NOT_FOUND' });
      return {
        orderId: order.id,
        orderNo: order.orderNo,
        status: order.status,
        amountMinor: order.amountMinor.toString(),
        creditGrant: order.priceSnapshot.creditGrant,
        currency: order.currency,
        paidAt: order.paidAt,
        createdAt: order.createdAt,
      };
    }),
});
