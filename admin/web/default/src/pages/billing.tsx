import { Flexbox } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';

import { api } from '../api';
import { DataState, date, Editor, Field, Pager, Pick, Search } from '../components';
import { styles } from '../styles';
import type { Page } from '../types';

interface Wallet {
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
interface Ledger {
  availableDelta: string;
  balanceAfter: string;
  billingAccountId: string;
  createdAt: string;
  delta: string;
  id: string;
  kind: string;
  reason: string | null;
  reservedDelta: string;
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

function Adjustment({
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
        label={t('billing.adjustDelta')}
        hint={t('billing.adjustHint')}
        value={delta}
        type="number"
        min={-1000000000}
        max={1000000000}
        onChange={setDelta}
      />
      <Field required label={t('billing.reason')} value={reason} onChange={setReason} />
    </Editor>
  );
}

export function WalletsPage() {
  const { t } = useTranslation();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<Wallet>();
  const { data, error, isLoading, mutate } = useSWR(
    `/api/admin/billing/wallets?page=${page}&search=${encodeURIComponent(search)}`,
    api<Page<Wallet>>,
  );
  return (
    <div className={styles.card}>
      {editing && (
        <Adjustment wallet={editing} close={() => setEditing(undefined)} refresh={mutate} />
      )}
      <Search
        onSearch={(value) => {
          setSearch(value);
          setPage(1);
        }}
      />
      <DataState
        loading={isLoading}
        error={error}
        empty={data?.items.length === 0}
        retry={() => void mutate()}
      >
        <div className={styles.scroll}>
          <table className={styles.table}>
            <thead>
              <tr>
                {[
                  'billing.account',
                  'email',
                  'billing.available',
                  'billing.reserved',
                  'status',
                  'action',
                ].map((key) => (
                  <th key={key}>{t(key)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data?.items.map((row) => (
                <tr key={row.id}>
                  <td>
                    {row.userId}
                    <small style={{ display: 'block' }}>{row.id}</small>
                  </td>
                  <td>{row.email}</td>
                  <td>{row.available}</td>
                  <td>{row.reserved}</td>
                  <td>{t(`billing.walletStatus.${row.status}`)}</td>
                  <td>
                    <Button onClick={() => setEditing(row)}>{t('billing.adjust')}</Button>
                  </td>
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

export function OrdersPage() {
  const { t } = useTranslation();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
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
        loading={isLoading}
        error={error}
        empty={data?.items.length === 0}
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

export function LedgerPage() {
  const { t } = useTranslation();
  const [page, setPage] = useState(1);
  const [account, setAccount] = useState('');
  const { data, error, isLoading, mutate } = useSWR(
    `/api/admin/billing/ledger?page=${page}&account=${encodeURIComponent(account)}`,
    api<Page<Ledger>>,
  );
  return (
    <div className={styles.card}>
      <p className={styles.muted}>{t('billing.ledgerHint')}</p>
      <Search
        onSearch={(value) => {
          setAccount(value);
          setPage(1);
        }}
      />
      <DataState
        loading={isLoading}
        error={error}
        empty={data?.items.length === 0}
        retry={() => void mutate()}
      >
        <div className={styles.scroll}>
          <table className={styles.table}>
            <thead>
              <tr>
                {[
                  'billing.account',
                  'billing.kind',
                  'billing.delta',
                  'billing.availableDelta',
                  'billing.reservedDelta',
                  'billing.balanceAfter',
                  'billing.reason',
                  'time',
                ].map((key) => (
                  <th key={key}>{t(key)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data?.items.map((row) => (
                <tr key={row.id}>
                  <td>{row.billingAccountId}</td>
                  <td>{t(`billing.kind.${row.kind}`)}</td>
                  <td>{row.delta}</td>
                  <td>{row.availableDelta}</td>
                  <td>{row.reservedDelta}</td>
                  <td>{row.balanceAfter}</td>
                  <td>{row.reason}</td>
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
        type="number"
        min={1}
        max={100000000}
        value={draft.amountMinor}
        onChange={(amountMinor) => setDraft({ ...draft, amountMinor })}
      />
      <Field
        required
        label={t('billing.credits')}
        type="number"
        min={1}
        max={1000000000}
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
        <PackEditor pack={editing} close={() => setEditing(undefined)} refresh={mutate} />
      )}
      <Flexbox horizontal justify="space-between" gap={12}>
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
        loading={isLoading}
        error={error}
        empty={data?.length === 0}
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
