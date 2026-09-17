import { Flexbox } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';

import { api } from '../api';
import { Badge, DataState, Editor, Field, Pick, Toggle } from '../components';
import { styles } from '../styles';
import type { Provider } from '../types';

const emptyProvider: Provider = {
  id: '',
  name: '',
  sdkType: 'openai',
  baseURL: '',
  region: '',
  enabled: false,
  configured: false,
  revision: 0,
};

function ProviderEditor({
  provider,
  onClose,
  refresh,
}: {
  provider: Provider;
  onClose: () => void;
  refresh: () => Promise<unknown>;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState({
    ...provider,
    apiKey: '',
    accessKeyId: '',
    secretAccessKey: '',
    sessionToken: '',
    clearSecrets: false,
  });
  return (
    <Editor
      title={t(provider.id ? 'edit' : 'newProvider')}
      onClose={onClose}
      onSave={async () => {
        const {
          name,
          sdkType,
          baseURL,
          region,
          enabled,
          revision,
          apiKey,
          accessKeyId,
          secretAccessKey,
          sessionToken,
          clearSecrets,
        } = draft;
        await api(`/api/admin/providers/${encodeURIComponent(draft.id)}`, 'PUT', {
          name,
          sdkType,
          baseURL,
          region,
          enabled,
          revision,
          apiKey,
          accessKeyId,
          secretAccessKey,
          sessionToken,
          clearSecrets,
        });
        await refresh();
      }}
    >
      <div className={styles.fields}>
        <Field
          required
          disabled={!!provider.id}
          hint={t('providerIdHint')}
          label={t('id')}
          value={draft.id}
          onChange={(id) => setDraft({ ...draft, id })}
        />
        <Field
          required
          label={t('name')}
          value={draft.name}
          onChange={(name) => setDraft({ ...draft, name })}
        />
        <Pick
          label={t('sdkType')}
          value={draft.sdkType}
          options={[
            'openai',
            'anthropic',
            'google',
            'deepseek',
            'qwen',
            'volcengine',
            'azure',
            'bedrock',
            'ollama',
            'openrouter',
            'moonshot',
          ].map((value) => ({ label: value, value }))}
          onChange={(sdkType) => setDraft({ ...draft, sdkType })}
        />
        <Field
          label={t('baseURL')}
          type="url"
          value={draft.baseURL}
          onChange={(baseURL) => setDraft({ ...draft, baseURL })}
        />
        <Field
          label={t('apiKey')}
          type="password"
          value={draft.apiKey}
          onChange={(apiKey) => setDraft({ ...draft, apiKey })}
        />
        {draft.sdkType === 'bedrock' && (
          <>
            <Field
              label={t('region')}
              value={draft.region}
              onChange={(region) => setDraft({ ...draft, region })}
            />
            <Field
              label={t('accessKeyId')}
              type="password"
              value={draft.accessKeyId}
              onChange={(accessKeyId) => setDraft({ ...draft, accessKeyId })}
            />
            <Field
              label={t('secretAccessKey')}
              type="password"
              value={draft.secretAccessKey}
              onChange={(secretAccessKey) => setDraft({ ...draft, secretAccessKey })}
            />
            <Field
              label={t('sessionToken')}
              type="password"
              value={draft.sessionToken}
              onChange={(sessionToken) => setDraft({ ...draft, sessionToken })}
            />
          </>
        )}
      </div>
      <span className={styles.muted}>{t('secretHint')}</span>
      <Flexbox horizontal gap={24} wrap="wrap">
        <Toggle
          label={t('enabled')}
          value={draft.enabled}
          onChange={(enabled) => setDraft({ ...draft, enabled })}
        />
        <Toggle
          label={t('clearSecrets')}
          value={draft.clearSecrets}
          onChange={(clearSecrets) =>
            setDraft({ ...draft, clearSecrets, enabled: clearSecrets ? false : draft.enabled })
          }
        />
      </Flexbox>
    </Editor>
  );
}

export function ProvidersPage() {
  const { t } = useTranslation();
  const [editing, setEditing] = useState<Provider>();
  const { data, error, isLoading, mutate } = useSWR('/api/admin/providers', api<Provider[]>);
  return (
    <>
      {editing && (
        <ProviderEditor
          key={editing.id}
          provider={editing}
          refresh={mutate}
          onClose={() => setEditing(undefined)}
        />
      )}
      <div className={styles.card}>
        <Flexbox horizontal className={styles.toolbar} justify="space-between">
          <Button
            disabled={!!editing}
            icon={Plus}
            type="primary"
            onClick={() => setEditing(emptyProvider)}
          >
            {t('newProvider')}
          </Button>
          <Button onClick={() => void mutate()}>{t('refresh')}</Button>
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
                  {['name', 'sdkType', 'baseURL', 'status', 'actions'].map((key) => (
                    <th key={key}>{t(key)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data?.map((provider) => (
                  <tr key={provider.id}>
                    <td>
                      <Flexbox gap={4}>
                        <strong>{provider.name}</strong>
                        <span className={styles.muted}>{provider.id}</span>
                      </Flexbox>
                    </td>
                    <td>{provider.sdkType}</td>
                    <td>{provider.baseURL || '—'}</td>
                    <td>
                      <Flexbox horizontal gap={8}>
                        <Badge good={provider.enabled}>
                          {t(provider.enabled ? 'enabled' : 'disabled')}
                        </Badge>
                        <Badge good={provider.configured}>
                          {t(provider.configured ? 'configured' : 'unconfigured')}
                        </Badge>
                      </Flexbox>
                    </td>
                    <td>
                      <Button disabled={!!editing} onClick={() => setEditing(provider)}>
                        {t('edit')}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </DataState>
      </div>
    </>
  );
}
