import { Flexbox } from '@lobehub/ui';
import { Button, Text } from '@lobehub/ui/base-ui';
import { Table } from 'antd';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncBoundary from '@/components/AsyncBoundary';
import { useBillingStore } from '@/store/billing';

import { money } from './format';

function Pages({
  offset,
  count,
  change,
}: {
  offset: number;
  count: number;
  change: (offset: number) => void;
}) {
  const { t } = useTranslation('subscription');
  return (
    <Flexbox horizontal gap={12}>
      <Button disabled={offset === 0} onClick={() => change(offset - 25)}>
        {t('creditPack.previous')}
      </Button>
      <Text>{offset / 25 + 1}</Text>
      <Button disabled={count < 25} onClick={() => change(offset + 25)}>
        {t('creditPack.next')}
      </Button>
    </Flexbox>
  );
}

export function CreditLedger() {
  const { t } = useTranslation('subscription');
  const [offset, setOffset] = useState(0);
  const fetch = useBillingStore((s) => s.useFetchLedger);
  const { data, error, isLoading, mutate } = fetch(offset);
  return (
    <Flexbox gap={16}>
      <Text weight={600}>{t('creditPack.ledger')}</Text>
      <AsyncBoundary
        data={data}
        error={error}
        isLoading={isLoading}
        onRetry={() => {
          void mutate();
        }}
      >
        <Table
          dataSource={data}
          pagination={false}
          rowKey={'id'}
          scroll={{ x: 560 }}
          columns={[
            {
              title: t('creditPack.date'),
              dataIndex: 'createdAt',
              render: (value: string) => new Date(value).toLocaleString(),
            },
            {
              title: t('creditPack.kindLabel'),
              dataIndex: 'kind',
              render: (value: string) => t(`creditPack.kind.${value}`, { defaultValue: value }),
            },
            { title: t('creditPack.net'), dataIndex: 'delta' },
            { title: t('creditPack.available'), dataIndex: 'balanceAfter' },
          ]}
        />
      </AsyncBoundary>
      <Pages change={setOffset} count={data?.length ?? 0} offset={offset} />
    </Flexbox>
  );
}

export function CreditOrders() {
  const { t } = useTranslation('subscription');
  const [offset, setOffset] = useState(0);
  const fetch = useBillingStore((s) => s.useFetchOrders);
  const { data, error, isLoading, mutate } = fetch(offset);
  return (
    <Flexbox gap={16} width={'100%'}>
      <AsyncBoundary
        data={data}
        error={error}
        isLoading={isLoading}
        onRetry={() => {
          void mutate();
        }}
      >
        <Table
          dataSource={data}
          pagination={false}
          rowKey={'id'}
          scroll={{ x: 700 }}
          columns={[
            { title: t('billing.orderNumber'), dataIndex: 'orderNo' },
            { title: t('billing.amount'), dataIndex: 'amountMinor', render: money },
            { title: t('creditPack.grant'), dataIndex: 'creditGrant' },
            {
              title: t('creditPack.state'),
              dataIndex: 'status',
              render: (value: string) => t(`creditPack.status.${value}`, { defaultValue: value }),
            },
            {
              title: t('creditPack.date'),
              dataIndex: 'createdAt',
              render: (value: string) => new Date(value).toLocaleString(),
            },
          ]}
        />
      </AsyncBoundary>
      <Pages change={setOffset} count={data?.length ?? 0} offset={offset} />
    </Flexbox>
  );
}

export function CreditUsage() {
  const { t } = useTranslation('subscription');
  const [offset, setOffset] = useState(0);
  const fetch = useBillingStore((s) => s.useFetchUsage);
  const { data, error, isLoading, mutate } = fetch(offset);
  return (
    <Flexbox gap={16} padding={24} width={'100%'}>
      <Text weight={600}>{t('creditPack.usage')}</Text>
      <AsyncBoundary
        data={data}
        error={error}
        isLoading={isLoading}
        onRetry={() => {
          void mutate();
        }}
      >
        <Table
          dataSource={data}
          pagination={false}
          rowKey={'id'}
          scroll={{ x: 700 }}
          columns={[
            { title: t('creditPack.model'), dataIndex: 'model' },
            { title: t('creditPack.input'), dataIndex: 'promptTokens' },
            { title: t('creditPack.output'), dataIndex: 'completionTokens' },
            { title: t('creditPack.net'), dataIndex: 'credits' },
            {
              title: t('creditPack.state'),
              dataIndex: 'status',
              render: (value: string) => t(`creditPack.status.${value}`, { defaultValue: value }),
            },
            {
              title: t('creditPack.date'),
              dataIndex: 'createdAt',
              render: (value: string) => new Date(value).toLocaleString(),
            },
          ]}
        />
      </AsyncBoundary>
      <Pages change={setOffset} count={data?.length ?? 0} offset={offset} />
    </Flexbox>
  );
}
