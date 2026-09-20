import { Flexbox } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';

import { api } from '../api';
import { DataState, Pick } from '../components';
import { styles } from '../styles';

interface RemoteModel {
  id: string;
  displayName: string;
}

// Mount with key=provider so an old provider's selection cannot cross into a new draft.
export function ProviderModelPicker({
  provider,
  modelId,
  onSelect,
}: {
  provider: string;
  modelId: string;
  onSelect: (model: RemoteModel) => void;
}) {
  const { t } = useTranslation();
  const [requested, setRequested] = useState(false);
  const { data, error, isLoading, isValidating, mutate } = useSWR(
    requested ? `/api/admin/providers/${encodeURIComponent(provider)}/models` : null,
    api<RemoteModel[]>,
    { revalidateOnFocus: false, shouldRetryOnError: false },
  );
  return (
    <Flexbox gap={12}>
      <Button
        disabled={!provider}
        loading={isValidating}
        onClick={() => (requested ? void mutate() : setRequested(true))}
      >
        {t('fetchProviderModels')}
      </Button>
      <span className={styles.muted}>{t('fetchProviderModelsHint')}</span>
      {requested && (
        <DataState
          empty={data?.length === 0}
          error={error}
          loading={isLoading}
          retry={() => void mutate()}
        >
          {!!data?.length && (
            <Pick
              label={t('selectFetchedModel')}
              value={data.some((model) => model.id === modelId) ? modelId : ''}
              options={[
                { value: '', label: t('selectFetchedModel') },
                ...data.map((model) => ({
                  value: model.id,
                  label: `${model.displayName} (${model.id})`,
                })),
              ]}
              onChange={(id) => {
                const model = data.find((item) => item.id === id);
                if (model) onSelect(model);
              }}
            />
          )}
        </DataState>
      )}
    </Flexbox>
  );
}
