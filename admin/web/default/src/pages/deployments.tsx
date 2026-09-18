import { Flexbox } from '@lobehub/ui';
import { Button, confirmModal } from '@lobehub/ui/base-ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';

import { api } from '../api';
import { DataState, date, Editor, ErrorNotice, Field } from '../components';
import { styles } from '../styles';

interface DeploymentConfig {
  configured: boolean;
  revision: number;
  values: Record<string, string>;
}
interface Deployment {
  actor: string;
  createdAt: string;
  id: string;
  log?: string;
  status: 'running' | 'unknown' | 'failed' | 'succeeded';
}

const configURL = '/api/admin/settings/deployment';
const jobsURL = '/api/admin/deployments';

function DeploymentEditor({
  data,
  close,
  saved,
}: {
  data: DeploymentConfig;
  close: () => void;
  saved: (next: DeploymentConfig) => Promise<unknown>;
}) {
  const { t } = useTranslation();
  const [values, setValues] = useState<Record<string, string>>({
    DEPLOY_HOST: '',
    DEPLOY_PORT: '22',
    DEPLOY_USER: 'root',
    DEPLOY_REPOSITORY: 'https://github.com/nevermorewish/lobehub.git',
    DEPLOY_BRANCH: 'canary',
    DEPLOY_DIRECTORY: '/opt/lobehub',
    ...data.values,
  });
  const [probing, setProbing] = useState(false);
  const [error, setError] = useState<unknown>();
  return (
    <Editor
      title={t('deploymentConfig')}
      onClose={close}
      onSave={async () => {
        await saved(
          await api<DeploymentConfig>(configURL, 'PUT', { values, revision: data.revision }),
        );
      }}
    >
      <div className={styles.fields}>
        {[
          'DEPLOY_HOST',
          'DEPLOY_PORT',
          'DEPLOY_USER',
          'DEPLOY_PASSWORD',
          'DEPLOY_REPOSITORY',
          'DEPLOY_BRANCH',
          'DEPLOY_DIRECTORY',
          'DEPLOY_HOST_KEY',
        ].map((key) => (
          <Field
            hint={key === 'DEPLOY_PASSWORD' ? t('storageSecretHint') : undefined}
            key={key}
            label={t(`config.${key}`)}
            max={key === 'DEPLOY_PORT' ? 65535 : undefined}
            min={key === 'DEPLOY_PORT' ? 1 : undefined}
            required={key !== 'DEPLOY_PASSWORD' || !data.configured}
            value={values[key] || ''}
            type={
              key === 'DEPLOY_PASSWORD' ? 'password' : key === 'DEPLOY_PORT' ? 'number' : 'text'
            }
            onChange={(value) =>
              setValues({
                ...values,
                [key]: value,
                ...(['DEPLOY_HOST', 'DEPLOY_PORT'].includes(key) ? { DEPLOY_HOST_KEY: '' } : {}),
              })
            }
          />
        ))}
      </div>
      <span className={styles.muted}>{t('deploymentFingerprintHint')}</span>
      <Button
        loading={probing}
        onClick={async () => {
          setProbing(true);
          setError(undefined);
          try {
            const result = await api<{ fingerprint: string }>(`${jobsURL}/probe`, 'POST', {
              host: values.DEPLOY_HOST,
              port: values.DEPLOY_PORT,
            });
            setValues((current) => ({ ...current, DEPLOY_HOST_KEY: result.fingerprint }));
          } catch (failure) {
            setError(failure);
          } finally {
            setProbing(false);
          }
        }}
      >
        {t('deploymentProbe')}
      </Button>
      {error !== undefined && <ErrorNotice error={error} />}
    </Editor>
  );
}

function DeploymentLog({ job }: { job: Deployment }) {
  const { t } = useTranslation();
  const { data, error, mutate } = useSWR(`${jobsURL}/${job.id}`, api<Deployment>, {
    refreshInterval: (latest) =>
      !latest || ['running', 'unknown'].includes(latest.status) ? 5000 : 0,
  });
  return (
    <Flexbox className={styles.card} gap={16}>
      <Flexbox horizontal gap={12} justify="space-between" wrap="wrap">
        <strong>
          {t('deploymentLog')} · {t(`deploymentStatus.${data?.status || job.status}`)}
        </strong>
        <Button onClick={() => void mutate()}>{t('refresh')}</Button>
      </Flexbox>
      {error && <ErrorNotice error={error} retry={() => void mutate()} />}
      <pre
        style={{
          maxHeight: 480,
          overflow: 'auto',
          whiteSpace: 'pre-wrap',
          overflowWrap: 'anywhere',
        }}
      >
        {data?.log || t('deploymentWaiting')}
      </pre>
    </Flexbox>
  );
}

export function DeploymentsPage() {
  const { t } = useTranslation();
  const config = useSWR(configURL, api<DeploymentConfig>);
  const jobs = useSWR(jobsURL, api<Deployment[]>, { refreshInterval: 5000 });
  const [editing, setEditing] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>();
  const [selected, setSelected] = useState<Deployment>();
  const active = jobs.data?.some((job) => ['running', 'unknown'].includes(job.status));
  const latest = selected || jobs.data?.[0];
  return (
    <Flexbox gap={24}>
      <div className={styles.card}>
        <Flexbox gap={12}>
          <strong>{t('deploymentWorkflow')}</strong>
          <span className={styles.muted}>{t('deploymentPrerequisites')}</span>
        </Flexbox>
      </div>
      {editing && config.data ? (
        <DeploymentEditor
          close={() => setEditing(false)}
          data={config.data}
          saved={(next) => config.mutate(next, { revalidate: false })}
        />
      ) : (
        <div className={styles.card}>
          <DataState
            empty={false}
            error={config.error}
            loading={config.isLoading}
            retry={() => void config.mutate()}
          >
            <Flexbox gap={16}>
              <span>
                {config.data?.configured
                  ? `${config.data.values.DEPLOY_USER}@${config.data.values.DEPLOY_HOST}:${config.data.values.DEPLOY_PORT} · ${config.data.values.DEPLOY_BRANCH} · ${config.data.values.DEPLOY_DIRECTORY}`
                  : t('unconfigured')}
              </span>
              <Flexbox horizontal gap={12} wrap="wrap">
                <Button disabled={!config.data || pending} onClick={() => setEditing(true)}>
                  {t('deploymentConfig')}
                </Button>
                <Button
                  disabled={!config.data?.configured || active || !!jobs.error || jobs.isLoading}
                  loading={pending}
                  type="primary"
                  onClick={() => {
                    if (!config.data) return;
                    const configuration = config.data;
                    confirmModal({
                      title: t('deploymentStart'),
                      content: t('deploymentConfirm', {
                        host: configuration.values.DEPLOY_HOST,
                        branch: configuration.values.DEPLOY_BRANCH,
                      }),
                      okText: t('deploymentStart'),
                      cancelText: t('cancel'),
                      onOk: async () => {
                        setPending(true);
                        setError(undefined);
                        try {
                          const job = await api<Deployment>(jobsURL, 'POST', {
                            revision: configuration.revision,
                          });
                          setSelected(job);
                        } catch (failure) {
                          setError(failure);
                        } finally {
                          setPending(false);
                          void jobs.mutate();
                        }
                      },
                    });
                  }}
                >
                  {t('deploymentStart')}
                </Button>
              </Flexbox>
            </Flexbox>
          </DataState>
          {error !== undefined && <ErrorNotice error={error} />}
        </div>
      )}
      <div className={styles.card}>
        <DataState
          empty={jobs.data?.length === 0}
          error={jobs.error}
          loading={jobs.isLoading}
          retry={() => void jobs.mutate()}
        >
          <Flexbox gap={12}>
            {jobs.data?.map((job) => (
              <Flexbox horizontal gap={12} justify="space-between" key={job.id} wrap="wrap">
                <span>
                  {date(job.createdAt)} · {job.actor} · {t(`deploymentStatus.${job.status}`)}
                </span>
                <Button onClick={() => setSelected(job)}>{t('deploymentLog')}</Button>
              </Flexbox>
            ))}
          </Flexbox>
        </DataState>
      </div>
      {latest && <DeploymentLog job={latest} key={latest.id} />}
    </Flexbox>
  );
}
