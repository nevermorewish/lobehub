import { lambdaClient } from '@/libs/trpc/client';

class BillingService {
  balance = () => lambdaClient.spend.balance.query();
  plans = () => lambdaClient.subscription.listPlans.query();
  ledger = (offset: number) => lambdaClient.spend.ledgerHistory.query({ limit: 25, offset });
  orders = (offset: number) => lambdaClient.spend.orders.query({ limit: 25, offset });
  usage = (offset: number) => lambdaClient.spend.usageHistory.query({ limit: 25, offset });
  order = (orderId: string) => lambdaClient.topUp.getOrder.query({ orderId });
  checkout = (planPriceId: string, clientIdempotencyKey: string) =>
    lambdaClient.topUp.createOrder.mutate({ clientIdempotencyKey, planPriceId });
}

export const billingService = new BillingService();
