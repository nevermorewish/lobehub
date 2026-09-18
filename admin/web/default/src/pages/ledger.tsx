import { Flexbox } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { Fragment, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import useSWR from 'swr';

import { api } from '../api';
import { Badge, DataState, date, Field, Pager, Pick } from '../components';
import { styles } from '../styles';
import type { Page } from '../types';

interface Ledger {
  availableDelta: string;
  balanceAfter: string;
  billingAccountId: string;
  completionRate: string | null;
  completionTokens: number | null;
  createdAt: string;
  creditsCharged: string | null;
  delta: string;
  email: string | null;
  heldCredits: string | null;
  id: string;
  kind: string;
  modelId: string | null;
  modelType: string | null;
  operator: string | null;
  orderId: string | null;
  priceId: string | null;
  promptRate: string | null;
  promptTokens: number | null;
  provider: string | null;
  reason: string | null;
  requestId: string | null;
  reservedDelta: string;
  settlementStatus: string | null;
  totalTokens: number | null;
  unit: string | null;
  usageId: string | null;
  usageStartedAt: string | null;
  usageUpdatedAt: string | null;
  userId: string;
}
interface LedgerPageData extends Page<Ledger> {
  summary: { debited: string; credited: string; totalTokens: string };
}

function LedgerDetail({ row }: { row: Ledger }) {
  const { t } = useTranslation();
  const detail = [
    ['billing.requestId', row.requestId],
    ['billing.usageId', row.usageId],
    ['billing.account', row.billingAccountId],
    ['id', row.id],
    ['billing.orderId', row.orderId],
    ['actor', row.operator],
    ['billing.model', row.modelId],
    ['billing.provider', row.provider],
    ['billing.modelType', row.modelType ? t(`billing.modelType.${row.modelType}`) : null],
    ['billing.promptTokens', row.promptTokens],
    ['billing.completionTokens', row.completionTokens],
    ['billing.totalTokens', row.totalTokens],
    ['billing.promptRate', row.promptRate],
    ['billing.completionRate', row.completionRate],
    ['billing.heldCredits', row.heldCredits],
    ['billing.finalCharge', row.creditsCharged],
    ['billing.availableDelta', row.availableDelta],
    ['billing.reservedDelta', row.reservedDelta],
    ['billing.balanceAfter', row.balanceAfter],
    ['billing.priceId', row.priceId],
    ['billing.startedAt', row.usageStartedAt ? date(row.usageStartedAt) : null],
    ['billing.settledAt', row.usageUpdatedAt ? date(row.usageUpdatedAt) : null],
    ['billing.reason', row.reason],
  ] as const;
  return (
    <Flexbox gap={16}>
      <strong>{t('billing.detail')}</strong>
      {row.usageId && (
        <p className={styles.muted}>
          {row.unit === 'generation'
            ? t('billing.generationFormula', { credits: row.heldCredits ?? '—' })
            : row.promptRate !== null && row.completionRate !== null
              ? t('billing.tokenFormula', {
                  input: row.promptTokens,
                  output: row.completionTokens,
                  inputRate: row.promptRate,
                  outputRate: row.completionRate,
                })
              : t('billing.missingPriceSnapshot')}
        </p>
      )}
      <dl className={styles.fields}>
        {detail.map(([key, value]) => (
          <div key={key}>
            <dt className={styles.muted}>{t(key)}</dt>
            <dd style={{ margin: 0, overflowWrap: 'anywhere' }}>{value ?? '—'}</dd>
          </div>
        ))}
      </dl>
    </Flexbox>
  );
}

export function LedgerPage() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const [draft, setDraft] = useState(() => ({
    search: params.get('search') || '',
    model: params.get('model') || '',
    provider: params.get('provider') || '',
    kind: params.get('kind') || '',
    from: params.get('from') || '',
    to: params.get('to') || '',
  }));
  const [expanded, setExpanded] = useState<string>();
  const page = Math.max(1, Number(params.get('page')) || 1);
  const query = new URLSearchParams(params);
  for (const key of ['from', 'to']) {
    const value = query.get(key);
    if (value && Number.isFinite(new Date(value).getTime()))
      query.set(key, new Date(value).toISOString());
  }
  const { data, error, isLoading, mutate } = useSWR(
    `/api/admin/billing/ledger?${query}`,
    api<LedgerPageData>,
  );
  return (
    <Flexbox gap={24}>
      <div className={styles.card}>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const next = new URLSearchParams(params);
            Object.entries(draft).forEach(([key, value]) =>
              value ? next.set(key, value) : next.delete(key),
            );
            next.set('page', '1');
            setParams(next);
          }}
        >
          <Flexbox gap={16}>
            <div className={styles.fields}>
              <Field
                label={t('billing.searchHint')}
                value={draft.search}
                onChange={(search) => setDraft({ ...draft, search })}
              />
              <Field
                label={t('billing.model')}
                value={draft.model}
                onChange={(model) => setDraft({ ...draft, model })}
              />
              <Field
                label={t('billing.provider')}
                value={draft.provider}
                onChange={(provider) => setDraft({ ...draft, provider })}
              />
              <Pick
                label={t('billing.kind')}
                value={draft.kind}
                options={[
                  '',
                  'credit',
                  'debit',
                  'hold',
                  'release',
                  'grant',
                  'refund',
                  'expiry',
                ].map((value) => ({ value, label: t(value ? `billing.kind.${value}` : 'all') }))}
                onChange={(kind) => setDraft({ ...draft, kind })}
              />
              <Field
                label={t('billing.from')}
                type="datetime-local"
                value={draft.from}
                onChange={(from) => setDraft({ ...draft, from })}
              />
              <Field
                label={t('billing.to')}
                type="datetime-local"
                value={draft.to}
                onChange={(to) => setDraft({ ...draft, to })}
              />
            </div>
            <Flexbox horizontal gap={12} wrap="wrap">
              <Button htmlType="submit" type="primary">
                {t('search')}
              </Button>
              <Button onClick={() => void mutate()}>{t('refresh')}</Button>
              {params.get('user') && (
                <Button onClick={() => setParams(new URLSearchParams())}>
                  {t('billing.clearUserFilter')}
                </Button>
              )}
            </Flexbox>
          </Flexbox>
        </form>
      </div>
      <div className={styles.card}>
        <DataState empty={false} error={error} loading={isLoading} retry={() => void mutate()}>
          {data && (
            <>
              <Flexbox horizontal gap={24} style={{ paddingBottom: 24 }} wrap="wrap">
                <strong>
                  {t('billing.summaryDebited')}: {data.summary.debited}
                </strong>
                <span>
                  {t('billing.summaryCredited')}: {data.summary.credited}
                </span>
                <span>
                  {t('billing.totalTokens')}: {data.summary.totalTokens}
                </span>
                <span>{t('total', { count: data.total })}</span>
              </Flexbox>
              <p className={styles.muted}>{t('billing.ledgerExplanation')}</p>
              {data.items.length === 0 ? (
                <p>{t('empty')}</p>
              ) : (
                <div className={styles.scroll}>
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        {[
                          'time',
                          'users',
                          'billing.model',
                          'billing.kind',
                          'billing.tokens',
                          'billing.delta',
                          'billing.balanceAfter',
                          'status',
                          'action',
                        ].map((key) => (
                          <th key={key}>{t(key)}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {data.items.map((row) => (
                        <Fragment key={row.id}>
                          <tr>
                            <td>{date(row.createdAt)}</td>
                            <td>
                              {row.email || row.userId}
                              <small style={{ display: 'block' }}>{row.userId}</small>
                            </td>
                            <td>
                              {row.modelId || '—'}
                              <small style={{ display: 'block' }}>{row.provider || ''}</small>
                            </td>
                            <td>{t(`billing.kind.${row.kind}`)}</td>
                            <td>
                              {row.usageId && row.unit !== 'generation'
                                ? `${row.promptTokens ?? '—'} / ${row.completionTokens ?? '—'}`
                                : '—'}
                            </td>
                            <td>{row.delta}</td>
                            <td>{row.balanceAfter}</td>
                            <td>
                              {row.settlementStatus ? (
                                <Badge good={row.settlementStatus === 'settled'}>
                                  {t(`billing.settlement.${row.settlementStatus}`)}
                                </Badge>
                              ) : (
                                '—'
                              )}
                            </td>
                            <td>
                              <Button
                                onClick={() =>
                                  setExpanded(expanded === row.id ? undefined : row.id)
                                }
                              >
                                {t(expanded === row.id ? 'billing.collapse' : 'billing.detail')}
                              </Button>
                            </td>
                          </tr>
                          {expanded === row.id && (
                            <tr>
                              <td colSpan={9}>
                                <LedgerDetail row={row} />
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <Pager
                page={page}
                total={data.total}
                setPage={(next) => {
                  const query = new URLSearchParams(params);
                  query.set('page', String(next));
                  setParams(query);
                }}
              />
            </>
          )}
        </DataState>
      </div>
    </Flexbox>
  );
}
