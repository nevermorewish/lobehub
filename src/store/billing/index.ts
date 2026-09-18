import { create } from 'zustand';

import { useClientDataSWR } from '@/libs/swr';
import { billingKeys } from '@/libs/swr/keys';
import { billingService } from '@/services/billing';

import { flattenActions } from '../utils/flattenActions';

class BillingActions {
  useFetchBalance = () =>
    useClientDataSWR(billingKeys.balance(), billingService.balance, { refreshInterval: 15000 });
  useFetchPlans = () => useClientDataSWR(billingKeys.plans(), billingService.plans);
  useFetchLedger = (offset: number) =>
    useClientDataSWR(billingKeys.ledger(offset), () => billingService.ledger(offset));
  useFetchOrders = (offset: number) =>
    useClientDataSWR(billingKeys.orders(offset), () => billingService.orders(offset), {
      refreshInterval: 15000,
    });
  useFetchUsage = (offset: number) =>
    useClientDataSWR(billingKeys.usage(offset), () => billingService.usage(offset));
  useFetchOrder = (orderId: string | null) =>
    useClientDataSWR(
      orderId ? billingKeys.order(orderId) : null,
      () => billingService.order(orderId!),
      { refreshInterval: (order) => (order?.status === 'pending' ? 3000 : 0) },
    );
}

export const useBillingStore = create<BillingActions>()(() =>
  flattenActions<BillingActions>([new BillingActions()]),
);
