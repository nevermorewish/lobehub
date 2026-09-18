import { Flexbox } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';

import { api } from '../api';
import { Badge, DataState, Editor, Field, Toggle } from '../components';
import { styles } from '../styles';

interface SettingsData {
  configured: boolean;
  revision: number;
  values: Record<string, string>;
}

const storageFields = [
  'S3_ENDPOINT',
  'S3_INTERNAL_ENDPOINT',
  'S3_BUCKET',
  'S3_REGION',
  'S3_PUBLIC_DOMAIN',
  'S3_PREVIEW_URL_EXPIRE_IN',
  'S3_ACCESS_KEY_ID',
  'S3_SECRET_ACCESS_KEY',
];
const systemFields = ['APP_URL', 'INTERNAL_APP_URL', 'SEARXNG_URL'];
const secretKeys = new Set(['S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY']);

function SettingsEditor({
  section,
  data,
  onClose,
  onSaved,
}: {
  section: 'storage' | 'system';
  data: SettingsData;
  onClose: () => void;
  onSaved: (data: SettingsData) => Promise<unknown>;
}) {
  const { t } = useTranslation();
  const [values, setValues] = useState<Record<string, string>>({
    ...(section === 'storage'
      ? { S3_ENABLE_PATH_STYLE: '1', S3_SET_ACL: '0', S3_PREVIEW_URL_EXPIRE_IN: '7200' }
      : { LLM_VISION_IMAGE_USE_BASE64: '1' }),
    ...data.values,
  });
  const fields = section === 'storage' ? storageFields : systemFields;
  const toggles =
    section === 'storage'
      ? ['S3_ENABLE_PATH_STYLE', 'S3_SET_ACL']
      : ['LLM_VISION_IMAGE_USE_BASE64'];
  return (
    <Editor
      title={t('edit')}
      onClose={onClose}
      onSave={async () => {
        const saved = await api<SettingsData>(`/api/admin/settings/${section}`, 'PUT', {
          values,
          revision: data.revision,
        });
        await onSaved(saved);
      }}
    >
      <div className={styles.fields}>
        {fields.map((key) => (
          <Field
            hint={secretKeys.has(key) ? t('storageSecretHint') : undefined}
            key={key}
            label={t(`config.${key}`)}
            max={key === 'S3_PREVIEW_URL_EXPIRE_IN' ? 604800 : undefined}
            min={key === 'S3_PREVIEW_URL_EXPIRE_IN' ? 1 : undefined}
            value={values[key] || ''}
            required={
              key === 'APP_URL' || key === 'S3_BUCKET' || (secretKeys.has(key) && !data.configured)
            }
            type={
              secretKeys.has(key)
                ? 'password'
                : key === 'S3_PREVIEW_URL_EXPIRE_IN'
                  ? 'number'
                  : /URL|ENDPOINT|DOMAIN/.test(key)
                    ? 'url'
                    : 'text'
            }
            onChange={(value) => setValues({ ...values, [key]: value })}
          />
        ))}
      </div>
      <Flexbox gap={16}>
        {toggles.map((key) => (
          <Toggle
            key={key}
            label={t(`config.${key}`)}
            value={values[key] === '1'}
            onChange={(value) => setValues({ ...values, [key]: value ? '1' : '0' })}
          />
        ))}
      </Flexbox>
    </Editor>
  );
}

function SettingsPage({ section }: { section: 'storage' | 'system' }) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [saved, setSaved] = useState(false);
  const { data, error, isLoading, mutate } = useSWR(
    `/api/admin/settings/${section}`,
    api<SettingsData>,
  );
  const fields = section === 'storage' ? storageFields : systemFields;
  return (
    <Flexbox gap={24}>
      <div className={styles.card}>
        <Flexbox gap={12}>
          <strong>{t('settingsRestart')}</strong>
          <span className={styles.muted}>
            {t(section === 'storage' ? 'storageMigrationHint' : 'settingsURLHint')}
          </span>
          {saved && <span role="status">{t('settingsSaved')}</span>}
        </Flexbox>
      </div>
      {editing && data ? (
        <SettingsEditor
          data={data}
          section={section}
          onClose={() => setEditing(false)}
          onSaved={async (next) => {
            await mutate(next, { revalidate: false });
            setSaved(true);
          }}
        />
      ) : (
        <div className={styles.card}>
          <DataState empty={false} error={error} loading={isLoading} retry={() => void mutate()}>
            {data && (
              <Flexbox gap={24}>
                <Flexbox horizontal align="center" gap={12}>
                  <Badge good={data.configured}>
                    {t(data.configured ? 'configured' : 'unconfigured')}
                  </Badge>
                  <Button type="primary" onClick={() => setEditing(true)}>
                    {t('edit')}
                  </Button>
                  <Button onClick={() => void mutate()}>{t('refresh')}</Button>
                </Flexbox>
                <dl className={styles.fields}>
                  {fields
                    .filter((key) => !secretKeys.has(key))
                    .map((key) => (
                      <div key={key}>
                        <dt className={styles.muted}>{t(`config.${key}`)}</dt>
                        <dd style={{ margin: 0, overflowWrap: 'anywhere' }}>
                          {data.values[key] || '—'}
                        </dd>
                      </div>
                    ))}
                </dl>
              </Flexbox>
            )}
          </DataState>
        </div>
      )}
    </Flexbox>
  );
}

export function StoragePage() {
  return <SettingsPage section="storage" />;
}
export function SystemSettingsPage() {
  return <SettingsPage section="system" />;
}
