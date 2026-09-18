import { Block, Flexbox } from '@lobehub/ui';
import { Alert, Button, Text } from '@lobehub/ui/base-ui';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';

import AsyncBoundary from '@/components/AsyncBoundary';
import AsyncError from '@/components/AsyncError';
import { billingService } from '@/services/billing';
import { useBillingStore } from '@/store/billing';

import { money } from './format';

function CheckoutStatus({ orderId }: { orderId: string }) {
  const { t } = useTranslation('subscription');
  const fetchOrder = useBillingStore((s) => s.useFetchOrder);
  const { data, error, isLoading, mutate } = fetchOrder(orderId);
  return (
    <AsyncBoundary
      data={data}
      error={error}
      isLoading={isLoading}
      onRetry={() => {
        void mutate();
      }}
    >
      {data && (
        <Alert
          description={`${data.orderNo} · ${t('creditPack.returnHint')}`}
          title={t(`creditPack.status.${data.status}`, { defaultValue: data.status })}
          type={data.status === 'paid' ? 'success' : 'info'}
        />
      )}
    </AsyncBoundary>
  );
}

export function CreditPlans() {
  const { t } = useTranslation('subscription');
  const fetchPlans = useBillingStore((s) => s.useFetchPlans);
  const { data, error, isLoading, mutate } = fetchPlans();
  const [params] = useSearchParams();
  const orderId = params.get('orderId');
  const [pending, setPending] = useState<string>();
  const [checkoutError, setCheckoutError] = useState<unknown>();
  const attempts = useRef<Record<string, string>>({});
  const checkout = async (priceId: string) => {
    if (pending) return;
    setPending(priceId);
    setCheckoutError(undefined);
    attempts.current[priceId] ??= crypto.randomUUID();
    try {
      const result = await billingService.checkout(priceId, attempts.current[priceId]);
      window.location.assign(result.checkoutUrl);
    } catch (error) {
      setCheckoutError(error);
    } finally {
      setPending(undefined);
    }
  };
  return (
    <Flexbox gap={20} width={'100%'}>
      <Text>{t('creditPack.description')}</Text>
      {orderId && <CheckoutStatus orderId={orderId} />}
      {checkoutError ? <AsyncError error={checkoutError} /> : null}
      <AsyncBoundary
        data={data}
        empty={<Text>{t('creditPack.empty')}</Text>}
        error={error}
        isEmpty={data?.length === 0}
        isLoading={isLoading}
        onRetry={() => {
          void mutate();
        }}
      >
        <Flexbox gap={16}>
          {data?.map((plan) => (
            <Block key={plan.priceId} padding={20} variant={'outlined'}>
              <Flexbox gap={12}>
                <Text weight={600}>{plan.name}</Text>
                {plan.description && <Text type={'secondary'}>{plan.description}</Text>}
                <Text>
                  {t('creditPack.credits', { value: BigInt(plan.creditGrant).toLocaleString() })} ·{' '}
                  {money(plan.amountMinor)}
                </Text>
                <Button
                  disabled={!!pending}
                  loading={pending === plan.priceId}
                  onClick={() => {
                    void checkout(plan.priceId);
                  }}
                >
                  {t('creditPack.pay', { amount: money(plan.amountMinor) })}
                </Button>
              </Flexbox>
            </Block>
          ))}
        </Flexbox>
      </AsyncBoundary>
    </Flexbox>
  );
}
