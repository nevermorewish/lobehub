import { Flexbox } from '@lobehub/ui';
import { Button, Checkbox } from '@lobehub/ui/base-ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { api } from '../api';
import { Badge, DataState, Editor, Field, Pick, Toggle } from '../components';
import { styles } from '../styles';
import type { Price, Provider } from '../types';

interface RemoteModel {
  configured: boolean;
  displayName: string;
  id: string;
}

type PriceSettings = Omit<
  Price,
  'id' | 'modelId' | 'displayName' | 'provider' | 'note' | 'archivedAt' | 'createdAt'
>;

interface ModelDraft extends PriceSettings {
  configured: boolean;
  displayName: string;
  modelId: string;
  selected: boolean;
}

const initialSettings: PriceSettings = {
  completionCreditsPerKToken: 2,
  contextWindow: 128000,
  functionCall: false,
  isActive: true,
  modelType: 'chat',
  promptCreditsPerKToken: 1,
  requestCreditsFlat: 0,
  vision: false,
};

export function BulkPriceImporter({
  providers,
  onClose,
  onComplete,
}: {
  providers: Provider[];
  onClose: () => void;
  onComplete: (created: number, skipped: number) => void;
}) {
  const { t } = useTranslation();
  const [provider, setProvider] = useState('');
  const [defaults, setDefaults] = useState(initialSettings);
  const [rows, setRows] = useState<ModelDraft[]>([]);
  const [search, setSearch] = useState('');
  const [requested, setRequested] = useState(false);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState<unknown>();
  const selected = rows.filter((row) => row.selected && !row.configured);
  const filter = search.trim().toLowerCase();
  const visible = rows.filter((row) =>
    `${row.modelId} ${row.displayName}`.toLowerCase().includes(filter),
  );
  const selectable = visible.filter((row) => !row.configured);
  const allSelected = selectable.length > 0 && selectable.every((row) => row.selected);
  const providerDetails = providers.find((item) => item.id === provider);
  const modelTypes = ['chat', 'image', 'video'].map((value) => ({
    value,
    label: t('billing.modelType.' + value),
  }));
  const patchRow = (id: string, patch: Partial<ModelDraft>) =>
    setRows((current) => current.map((row) => (row.modelId === id ? { ...row, ...patch } : row)));
  const fetchModels = async () => {
    if (!provider || loading) return;
    if (selected.length && !window.confirm(t('bulkPrices.refetchConfirm'))) return;
    setLoading(true);
    setRequested(true);
    setFetchError(undefined);
    try {
      const models = await api<RemoteModel[]>(
        `/api/admin/providers/${encodeURIComponent(provider)}/models`,
      );
      setRows(
        models.map((model) => ({
          ...defaults,
          configured: model.configured,
          displayName: model.displayName,
          modelId: model.id,
          selected: false,
        })),
      );
    } catch (error) {
      setFetchError(error);
    } finally {
      setLoading(false);
    }
  };
  const amountField = (
    label: string,
    value: number,
    onChange: (value: number) => void,
    disabled = false,
  ) => (
    <Field
      required
      disabled={disabled}
      label={label}
      max={1000000000}
      min={0}
      type="number"
      value={value}
      onChange={(next) => onChange(Number(next))}
    />
  );
  return (
    <Editor
      dirty={selected.length > 0}
      saveLabel={t('bulkPrices.add', { count: selected.length })}
      title={t('bulkPrices.open')}
      saveDisabled={
        loading || fetchError !== undefined || selected.length === 0 || selected.length > 200
      }
      onClose={onClose}
      onSave={async () => {
        const result = await api<{ created: Price[]; skipped: string[] }>(
          '/api/admin/prices/batch',
          'POST',
          {
            provider,
            prices: selected.map(
              ({ selected: _selected, configured: _configured, ...price }) => price,
            ),
          },
        );
        onComplete(result.created.length, result.skipped.length);
      }}
    >
      <span className={styles.muted}>{t('bulkPrices.hint')}</span>
      <Flexbox horizontal align="end" gap={16} wrap="wrap">
        <Pick
          label={t('providers')}
          value={provider}
          options={[
            { value: '', label: t('selectProvider') },
            ...providers.map((item) => ({ value: item.id, label: item.name })),
          ]}
          onChange={(next) => {
            if (loading || (selected.length > 0 && !window.confirm(t('unsaved')))) return;
            setProvider(next);
            setRows([]);
            setRequested(false);
            setFetchError(undefined);
            setSearch('');
          }}
        />
        <Button
          disabled={!provider || loading}
          loading={loading}
          onClick={() => void fetchModels()}
        >
          {t('fetchProviderModels')}
        </Button>
      </Flexbox>
      {providerDetails && !providerDetails.enabled && (
        <span role="status">{t('bulkPrices.providerDisabled')}</span>
      )}
      {requested && (
        <DataState
          empty={!rows.length}
          error={fetchError}
          loading={loading}
          retry={() => void fetchModels()}
        >
          {!!rows.length && (
            <Flexbox gap={20}>
              <h3>{t('bulkPrices.defaults')}</h3>
              <div className={styles.fields}>
                <Pick
                  label={t('billing.modelType')}
                  options={modelTypes}
                  value={defaults.modelType}
                  onChange={(value) =>
                    setDefaults({ ...defaults, modelType: value as Price['modelType'] })
                  }
                />
                {amountField(t('promptPrice'), defaults.promptCreditsPerKToken, (value) =>
                  setDefaults({ ...defaults, promptCreditsPerKToken: value }),
                )}
                {amountField(t('completionPrice'), defaults.completionCreditsPerKToken, (value) =>
                  setDefaults({ ...defaults, completionCreditsPerKToken: value }),
                )}
                {amountField(t('billing.requestPrice'), defaults.requestCreditsFlat, (value) =>
                  setDefaults({ ...defaults, requestCreditsFlat: value }),
                )}
                <Field
                  label={t('contextWindow')}
                  max={100000000}
                  min={0}
                  type="number"
                  value={defaults.contextWindow}
                  onChange={(value) => setDefaults({ ...defaults, contextWindow: Number(value) })}
                />
              </div>
              <Flexbox horizontal gap={20} wrap="wrap">
                <Toggle
                  label={t('activate')}
                  value={defaults.isActive}
                  onChange={(value) => setDefaults({ ...defaults, isActive: value })}
                />
                <Toggle
                  label={t('vision')}
                  value={defaults.vision}
                  onChange={(value) => setDefaults({ ...defaults, vision: value })}
                />
                <Toggle
                  label={t('functionCall')}
                  value={defaults.functionCall}
                  onChange={(value) => setDefaults({ ...defaults, functionCall: value })}
                />
                <Button
                  disabled={!selected.length}
                  onClick={() =>
                    setRows((current) =>
                      current.map((row) =>
                        row.selected && !row.configured ? { ...row, ...defaults } : row,
                      ),
                    )
                  }
                >
                  {t('bulkPrices.apply')}
                </Button>
              </Flexbox>
              <span className={styles.muted}>{t('bulkPrices.defaultsHint')}</span>
              <Flexbox horizontal align="end" gap={16} wrap="wrap">
                <Field label={t('bulkPrices.search')} value={search} onChange={setSearch} />
                <span role="status">
                  {t('bulkPrices.count', { selected: selected.length, total: rows.length })}
                </span>
              </Flexbox>
              <div className={styles.scroll} style={{ maxHeight: 480 }}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>
                        <Checkbox
                          aria-label={t('bulkPrices.selectVisible')}
                          checked={allSelected}
                          disabled={!selectable.length}
                          indeterminate={!allSelected && selectable.some((row) => row.selected)}
                          onChange={(checked) => {
                            const ids = new Set(selectable.map((row) => row.modelId));
                            setRows((current) =>
                              current.map((row) =>
                                ids.has(row.modelId) ? { ...row, selected: checked } : row,
                              ),
                            );
                          }}
                        />
                      </th>
                      <th>{t('modelId')}</th>
                      <th>{t('billing.modelType')}</th>
                      <th>{t('bulkPrices.rowPrice')}</th>
                      <th>{t('status')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((row) => (
                      <tr key={row.modelId}>
                        <td>
                          <Checkbox
                            aria-label={t('bulkPrices.selectModel', { model: row.modelId })}
                            checked={row.selected}
                            disabled={row.configured}
                            onChange={(selected) => patchRow(row.modelId, { selected })}
                          />
                        </td>
                        <td>
                          <strong>{row.displayName || row.modelId}</strong>
                          <div className={styles.muted}>{row.modelId}</div>
                        </td>
                        <td>
                          {row.configured ? (
                            '—'
                          ) : (
                            <Pick
                              label={`${row.modelId} · ${t('billing.modelType')}`}
                              options={modelTypes}
                              value={row.modelType}
                              onChange={(value) =>
                                patchRow(row.modelId, { modelType: value as Price['modelType'] })
                              }
                            />
                          )}
                        </td>
                        <td>
                          {!row.configured &&
                            (row.modelType === 'chat' ? (
                              <Flexbox gap={8}>
                                {amountField(
                                  `${row.modelId} · ${t('promptPrice')}`,
                                  row.promptCreditsPerKToken,
                                  (value) =>
                                    patchRow(row.modelId, { promptCreditsPerKToken: value }),
                                  !row.selected,
                                )}
                                {amountField(
                                  `${row.modelId} · ${t('completionPrice')}`,
                                  row.completionCreditsPerKToken,
                                  (value) =>
                                    patchRow(row.modelId, { completionCreditsPerKToken: value }),
                                  !row.selected,
                                )}
                              </Flexbox>
                            ) : (
                              amountField(
                                `${row.modelId} · ${t('billing.requestPrice')}`,
                                row.requestCreditsFlat,
                                (value) => patchRow(row.modelId, { requestCreditsFlat: value }),
                                !row.selected,
                              )
                            ))}
                        </td>
                        <td>
                          <Badge good={row.selected && row.isActive}>
                            {t(
                              row.configured
                                ? 'bulkPrices.existing'
                                : row.isActive
                                  ? 'bulkPrices.willEnable'
                                  : 'bulkPrices.willDraft',
                            )}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!visible.length && <span>{t('bulkPrices.noMatch')}</span>}
              </div>
              {selected.length > 200 && <span role="alert">{t('bulkPrices.limit')}</span>}
            </Flexbox>
          )}
        </DataState>
      )}
    </Editor>
  );
}
