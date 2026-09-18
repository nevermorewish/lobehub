import { Flexbox } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import useSWR from 'swr';

import { api } from '../api';
import { DataState, date, Editor, Field, Pager, Pick, Search } from '../components';
import { styles } from '../styles';
import type { Page } from '../types';

export interface Wallet {
  available: string;
  email: string | null;
  id: string;
  reserved: string;
  status: string;
  userId: string;
}
interface Order {
  amountMinor: string;
  createdAt: string;
  creditGrant: string;
  id: string;
  orderNo: string;
  paymentProvider: string;
  providerTradeNo: string | null;
  status: string;
  userId: string;
}
interface Pack {
  amountMinor: string;
  credits: string;
  description: string;
  id: string;
  name: string;
  priceId: string;
  slug: string;
  status: string;
}
const money = (fen: string) => {
  const amount = BigInt(fen);
  return `¥${amount / 100n}.${(amount % 100n).toString().padStart(2, '0')}`;
};

export function Adjustment({
  wallet,
  close,
  refresh,
}: {
  wallet: Wallet;
  close: () => void;
  refresh: () => Promise<unknown>;
}) {
  const { t } = useTranslation();
  const [delta, setDelta] = useState('');
  const [reason, setReason] = useState('');
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  return (
    <Editor
      title={t('billing.adjust')}
      onClose={close}
      onSave={async () => {
        await api(`/api/admin/billing/wallets/${wallet.id}/adjust`, 'POST', {
          delta,
          reason,
          idempotencyKey,
        });
        await refresh();
      }}
    >
      <p>
        {wallet.email ?? wallet.userId} · {t('billing.available')}: {wallet.available}
      </p>
      <Field
        required
        hint={t('billing.adjustHint')}
        label={t('billing.adjustDelta')}
        max={1000000000}
        min={-1000000000}
        type="number"
        value={delta}
        onChange={setDelta}
      />
      <Field required label={t('billing.reason')} value={reason} onChange={setReason} />
    </Editor>
  );
}

export function OrdersPage() {
  const { t } = useTranslation();
  const [page, setPage] = useState(1);
  const [params] = useSearchParams();
  const [search, setSearch] = useState(params.get('search') || '');
  const { data, error, isLoading, mutate } = useSWR(
    `/api/admin/billing/orders?page=${page}&search=${encodeURIComponent(search)}`,
    api<Page<Order>>,
  );
  return (
    <div className={styles.card}>
      <Search
        onSearch={(value) => {
          setSearch(value);
          setPage(1);
        }}
      />
      <DataState
        empty={data?.items.length === 0}
        error={error}
        loading={isLoading}
        retry={() => void mutate()}
      >
        <div className={styles.scroll}>
          <table className={styles.table}>
            <thead>
              <tr>
                {[
                  'billing.orderNo',
                  'billing.account',
                  'billing.amount',
                  'billing.credits',
                  'status',
                  'billing.tradeNo',
                  'time',
                ].map((key) => (
                  <th key={key}>{t(key)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data?.items.map((row) => (
                <tr key={row.id}>
                  <td>{row.orderNo}</td>
                  <td>{row.userId}</td>
                  <td>{money(row.amountMinor)}</td>
                  <td>{row.creditGrant}</td>
                  <td>{t(`billing.status.${row.status}`)}</td>
                  <td>{row.providerTradeNo ?? '—'}</td>
                  <td>{date(row.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </DataState>
      {data && <Pager page={page} setPage={setPage} total={data.total} />}
    </div>
  );
}

function PackEditor({
  pack,
  close,
  refresh,
}: {
  pack: Pack;
  close: () => void;
  refresh: () => Promise<unknown>;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(pack);
  return (
    <Editor
      title={t('billing.editPack')}
      onClose={close}
      onSave={async () => {
        const { id: _id, ...input } = draft;
        await api('/api/admin/billing/packs', 'POST', input);
        await refresh();
      }}
    >
      <p className={styles.muted}>{t('billing.packHint')}</p>
      <Field
        required
        disabled={!!pack.id}
        label={t('billing.slug')}
        value={draft.slug}
        onChange={(slug) => setDraft({ ...draft, slug })}
      />
      <Field
        required
        label={t('name')}
        value={draft.name}
        onChange={(name) => setDraft({ ...draft, name })}
      />
      <Field
        label={t('description')}
        value={draft.description}
        onChange={(description) => setDraft({ ...draft, description })}
      />
      <Field
        required
        label={t('billing.amountFen')}
        max={100000000}
        min={1}
        type="number"
        value={draft.amountMinor}
        onChange={(amountMinor) => setDraft({ ...draft, amountMinor })}
      />
      <Field
        required
        label={t('billing.credits')}
        max={1000000000}
        min={1}
        type="number"
        value={draft.credits}
        onChange={(credits) => setDraft({ ...draft, credits })}
      />
      <Pick
        label={t('status')}
        value={draft.status}
        options={['active', 'archived'].map((value) => ({
          value,
          label: t(`billing.status.${value}`),
        }))}
        onChange={(status) => setDraft({ ...draft, status })}
      />
    </Editor>
  );
}

export function PacksPage() {
  const { t } = useTranslation();
  const [editing, setEditing] = useState<Pack>();
  const { data, error, isLoading, mutate } = useSWR('/api/admin/billing/packs', api<Pack[]>);
  return (
    <div className={styles.card}>
      {editing && (
        <PackEditor close={() => setEditing(undefined)} pack={editing} refresh={mutate} />
      )}
      <Flexbox horizontal gap={12} justify="space-between">
        <p>{t('billing.packHint')}</p>
        <Button
          type="primary"
          onClick={() =>
            setEditing({
              id: '',
              slug: '',
              name: '',
              description: '',
              amountMinor: '990',
              credits: '9999',
              priceId: '',
              status: 'active',
            })
          }
        >
          {t('billing.newPack')}
        </Button>
      </Flexbox>
      <DataState
        empty={data?.length === 0}
        error={error}
        loading={isLoading}
        retry={() => void mutate()}
      >
        <div className={styles.scroll}>
          <table className={styles.table}>
            <thead>
              <tr>
                {['name', 'billing.amount', 'billing.credits', 'status', 'action'].map((key) => (
                  <th key={key}>{t(key)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data?.map((row) => (
                <tr key={row.id}>
                  <td>
                    {row.name}
                    <small style={{ display: 'block' }}>{row.slug}</small>
                  </td>
                  <td>{money(row.amountMinor)}</td>
                  <td>{row.credits}</td>
                  <td>{t(`billing.status.${row.status}`)}</td>
                  <td>
                    <Button onClick={() => setEditing(row)}>{t('edit')}</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </DataState>
    </div>
  );
}
