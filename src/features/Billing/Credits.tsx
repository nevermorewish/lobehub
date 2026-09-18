import { Block, Flexbox } from '@lobehub/ui';
import { Button, Text } from '@lobehub/ui/base-ui';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import AsyncBoundary from '@/components/AsyncBoundary';
import { useBillingStore } from '@/store/billing';

import { CreditLedger } from './History';

export function CreditBalance() {
  const { t } = useTranslation('subscription');
  const fetchBalance = useBillingStore((s) => s.useFetchBalance);
  const { data, error, isLoading, mutate } = fetchBalance();
  return (
    <Flexbox gap={24} width={'100%'}>
      <AsyncBoundary
        data={data}
        error={error}
        isLoading={isLoading}
        onRetry={() => {
          void mutate();
        }}
      >
        {data && (
          <Block padding={20} variant={'outlined'}>
            <Flexbox gap={12}>
              <Text weight={600}>
                {t('creditPack.available')}: {BigInt(data.available).toLocaleString()}
              </Text>
              <Text type={'secondary'}>
                {t('creditPack.reserved')}: {BigInt(data.reserved).toLocaleString()}
              </Text>
              <Text type={'secondary'}>{t('creditPack.holdHint')}</Text>
              <Link to={'/settings/plans'}>
                <Button>{t('creditPack.title')}</Button>
              </Link>
            </Flexbox>
          </Block>
        )}
      </AsyncBoundary>
      <CreditLedger />
    </Flexbox>
  );
}
