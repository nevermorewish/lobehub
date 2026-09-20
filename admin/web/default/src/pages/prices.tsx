import { Flexbox } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { Download, Plus } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';

import { api } from '../api';
import {
  Badge,
  DataState,
  Editor,
  ErrorNotice,
  Field,
  Pager,
  Pick,
  Search,
  Toggle,
} from '../components';
import { styles } from '../styles';
import type { Page, Price, Provider } from '../types';
import { BulkPriceImporter } from './bulk-price-importer';

const emptyPrice: Price = {
  modelType: 'chat',
  requestCreditsFlat: 0,
  id: '',
  provider: '',
  modelId: '',
  displayName: '',
  promptCreditsPerKToken: 1,
  completionCreditsPerKToken: 2,
  contextWindow: 128000,
  vision: false,
  functionCall: true,
  isActive: true,
  note: '',
  archivedAt: null,
  createdAt: '',
};

function PriceEditor({
  price,
  providers,
  onClose,
  refresh,
}: {
  price: Price;
  providers: Provider[];
  onClose: () => void;
  refresh: () => Promise<unknown>;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(price);
  return (
    <Editor
      title={t('newPrice')}
      onClose={onClose}
      onSave={async () => {
        const { id: _id, createdAt: _createdAt, archivedAt: _archivedAt, ...input } = draft;
        await api('/api/admin/prices', 'POST', input);
        await refresh();
      }}
    >
      <span className={styles.muted}>{t('priceVersionHint')}</span>
      <div className={styles.fields}>
        <Pick
          label={t('billing.modelType')}
          value={draft.modelType}
          options={['chat', 'image', 'video'].map((value) => ({
            value,
            label: t('billing.modelType.' + value),
          }))}
          onChange={(value) => setDraft({ ...draft, modelType: value as Price['modelType'] })}
        />
        <Field
          required
          label={t('billing.requestPrice')}
          max={1000000000}
          min={0}
          type="number"
          value={draft.requestCreditsFlat}
          onChange={(value) => setDraft({ ...draft, requestCreditsFlat: Number(value) })}
        />
        <Pick
          label={t('providers')}
          value={draft.provider}
          options={[
            { value: '', label: t('selectProvider') },
            ...providers.map((p) => ({ value: p.id, label: p.name })),
          ]}
          onChange={(provider) => setDraft({ ...draft, provider, modelId: '', displayName: '' })}
        />
        <Field
          required
          label={t('modelId')}
          value={draft.modelId}
          onChange={(modelId) => setDraft({ ...draft, modelId })}
        />
        <Field
          label={t('displayName')}
          value={draft.displayName}
          onChange={(displayName) => setDraft({ ...draft, displayName })}
        />
        <Field
          label={t('contextWindow')}
          max={100000000}
          min={0}
          type="number"
          value={draft.contextWindow}
          onChange={(value) => setDraft({ ...draft, contextWindow: Number(value) })}
        />
        <Field
          required
          label={t('promptPrice')}
          max={1000000000}
          min={0}
          type="number"
          value={draft.promptCreditsPerKToken}
          onChange={(value) => setDraft({ ...draft, promptCreditsPerKToken: Number(value) })}
        />
        <Field
          required
          label={t('completionPrice')}
          max={1000000000}
          min={0}
          type="number"
          value={draft.completionCreditsPerKToken}
          onChange={(value) => setDraft({ ...draft, completionCreditsPerKToken: Number(value) })}
        />
      </div>
      <Field
        label={t('note')}
        value={draft.note}
        onChange={(note) => setDraft({ ...draft, note })}
      />
      <Flexbox horizontal gap={24} wrap="wrap">
        <Toggle
          label={t('activate')}
          value={draft.isActive}
          onChange={(isActive) => setDraft({ ...draft, isActive })}
        />
        <Toggle
          label={t('vision')}
          value={draft.vision}
          onChange={(vision) => setDraft({ ...draft, vision })}
        />
        <Toggle
          label={t('functionCall')}
          value={draft.functionCall}
          onChange={(functionCall) => setDraft({ ...draft, functionCall })}
        />
      </Flexbox>
    </Editor>
  );
}

export function PricesPage() {
  const { t } = useTranslation();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [history, setHistory] = useState(false);
  const [editing, setEditing] = useState<Price>();
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState('');
  const [pending, setPending] = useState('');
  const [actionError, setActionError] = useState<unknown>();
  const { data, error, isLoading, mutate } = useSWR(
    `/api/admin/prices?page=${page}&search=${encodeURIComponent(search)}&archived=${history}`,
    api<Page<Price>>,
  );
  const providers = useSWR('/api/admin/providers', api<Provider[]>);
  const archive = async (id: string) => {
    if (!window.confirm(t('archiveConfirm'))) return;
    setPending(id);
    setActionError(undefined);
    try {
      await api(`/api/admin/prices/${encodeURIComponent(id)}`, 'DELETE');
      await mutate();
    } catch (failure) {
      setActionError(failure);
    } finally {
      setPending('');
    }
  };
  return (
    <>
      {importResult && (
        <div className={styles.card} role="status">
          {importResult}
        </div>
      )}
      {importing && (
        <BulkPriceImporter
          providers={providers.data ?? []}
          onClose={() => setImporting(false)}
          onComplete={(created, skipped) => {
            setImportResult(t('bulkPrices.result', { created, skipped }));
            setImporting(false);
            void mutate().catch(setActionError);
          }}
        />
      )}
      {editing && (
        <PriceEditor
          key={editing.id}
          price={editing}
          providers={providers.data ?? []}
          refresh={mutate}
          onClose={() => setEditing(undefined)}
        />
      )}
      <div className={styles.card}>
        <Flexbox horizontal className={styles.toolbar} gap={12} justify="space-between" wrap="wrap">
          <Search
            onSearch={(value) => {
              setSearch(value);
              setPage(1);
            }}
          />
          <Toggle
            label={t('history')}
            value={history}
            onChange={(value) => {
              setHistory(value);
              setPage(1);
            }}
          />
          <Flexbox horizontal gap={12} wrap="wrap">
            <Button
              disabled={!!editing || importing || !providers.data?.length}
              icon={Download}
              type="primary"
              onClick={() => {
                setImportResult('');
                setImporting(true);
              }}
            >
              {t('bulkPrices.open')}
            </Button>
            <Button
              disabled={!!editing || importing || !providers.data?.length}
              icon={Plus}
              onClick={() => setEditing(emptyPrice)}
            >
              {t('newPrice')}
            </Button>
          </Flexbox>
        </Flexbox>
        {providers.error && (
          <ErrorNotice error={providers.error} retry={() => void providers.mutate()} />
        )}
        {actionError !== undefined && <ErrorNotice error={actionError} />}
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
                    'modelId',
                    'providers',
                    'promptPrice',
                    'completionPrice',
                    'status',
                    'actions',
                  ].map((key) => (
                    <th key={key}>{t(key)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data?.items.map((price) => (
                  <tr key={price.id}>
                    <td>
                      <Flexbox gap={4}>
                        <strong>{price.displayName || price.modelId}</strong>
                        <span className={styles.muted}>{price.modelId}</span>
                      </Flexbox>
                    </td>
                    <td>{price.provider}</td>
                    <td className={styles.number}>
                      {price.promptCreditsPerKToken.toLocaleString()}
                    </td>
                    <td className={styles.number}>
                      {price.completionCreditsPerKToken.toLocaleString()}
                    </td>
                    <td>
                      <Badge good={price.isActive}>
                        {t(price.archivedAt ? 'archived' : price.isActive ? 'enabled' : 'draft')}
                      </Badge>
                    </td>
                    <td>
                      <Flexbox horizontal gap={8}>
                        <Button disabled={!!editing || importing} onClick={() => setEditing(price)}>
                          {t('edit')}
                        </Button>
                        {!price.archivedAt && (
                          <Button
                            danger
                            disabled={!!pending || importing}
                            loading={pending === price.id}
                            onClick={() => void archive(price.id)}
                          >
                            {t('archive')}
                          </Button>
                        )}
                      </Flexbox>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </DataState>
        {data && <Pager page={page} setPage={setPage} total={data.total} />}
      </div>
    </>
  );
}
