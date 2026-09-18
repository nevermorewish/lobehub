import { Flexbox } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';

import { api } from '../api';
import { Badge, DataState, Editor, Field, Pick, Toggle } from '../components';
import { styles } from '../styles';
import type { Payment } from '../types';

function PaymentEditor({
  payment,
  onClose,
  refresh,
}: {
  payment: Payment;
  onClose: () => void;
  refresh: () => Promise<unknown>;
}) {
  const { t } = useTranslation();
  const [config, setConfig] = useState(payment.config);
  const [enabled, setEnabled] = useState(payment.enabled);
  const [clearSecrets, setClearSecrets] = useState(false);
  const [secrets, setSecrets] = useState({
    privateKey: '',
    publicKey: '',
    secretKey: '',
    webhookSecret: '',
  });
  return (
    <Editor
      title={`${t('edit')} · ${t(payment.id)}`}
      onClose={onClose}
      onSave={async () => {
        await api(`/api/admin/payments/${payment.id}`, 'PUT', {
          config,
          secrets,
          enabled,
          clearSecrets,
          revision: payment.revision,
        });
        await refresh();
      }}
    >
      <span className={styles.muted}>{t('paymentValidationHint')}</span>
      <div className={styles.fields}>
        {payment.id === 'alipay' ? (
          <>
            <Field
              label={t('appId')}
              required={enabled}
              value={config.appId}
              onChange={(appId) => setConfig({ ...config, appId })}
            />
            <Field
              label={t('merchantId')}
              required={enabled}
              value={config.merchantId}
              onChange={(merchantId) => setConfig({ ...config, merchantId })}
            />
          </>
        ) : (
          <Field
            label={t('publishableKey')}
            required={enabled}
            value={config.publishableKey}
            onChange={(publishableKey) => setConfig({ ...config, publishableKey })}
          />
        )}
        <Field
          label={t('notifyURL')}
          required={enabled}
          type="url"
          value={config.notifyURL}
          onChange={(notifyURL) => setConfig({ ...config, notifyURL })}
        />
        <Field
          label={t('returnURL')}
          required={enabled}
          type="url"
          value={config.returnURL}
          onChange={(returnURL) => setConfig({ ...config, returnURL })}
        />
        <Pick
          label={t('currency')}
          options={(payment.id === 'alipay' ? ['CNY'] : ['CNY', 'USD']).map((value) => ({ value, label: value }))}
          value={config.currency}
          onChange={(currency) => setConfig({ ...config, currency })}
        />

      </div>
      <span className={styles.muted}>{t('secretHint')}</span>
      <div className={styles.fields}>
        {(payment.id === 'alipay'
          ? (['privateKey', 'publicKey'] as const)
          : (['secretKey', 'webhookSecret'] as const)
        ).map((key) => (
          <Field
            key={key}
            label={`${t(key)} · ${t(payment.configured[key] ? 'configured' : 'unconfigured')}`}
            multiline={payment.id === 'alipay'}
            type="password"
            value={secrets[key]}
            onChange={(value) => setSecrets({ ...secrets, [key]: value })}
          />
        ))}
      </div>
      <Flexbox horizontal gap={24} wrap="wrap">
        <Toggle label={t('enabled')} value={enabled} onChange={setEnabled} />
        <Toggle
          label={t('sandbox')}
          value={config.sandbox}
          onChange={(sandbox) => setConfig({ ...config, sandbox })}
        />
        <Toggle
          label={t('clearSecrets')}
          value={clearSecrets}
          onChange={(value) => {
            setClearSecrets(value);
            if (value) setEnabled(false);
          }}
        />
      </Flexbox>
    </Editor>
  );
}

export function PaymentsPage() {
  const { t } = useTranslation();
  const [editing, setEditing] = useState<Payment>();
  const { data, error, isLoading, mutate } = useSWR('/api/admin/payments', api<Payment[]>);
  return (
    <>
      {editing && (
        <PaymentEditor
          key={editing.id}
          payment={editing}
          refresh={mutate}
          onClose={() => setEditing(undefined)}
        />
      )}
      <DataState
        empty={data?.length === 0}
        error={error}
        loading={isLoading}
        retry={() => void mutate()}
      >
        <div className={styles.grid}>
          {data?.filter((payment) => payment.id === 'alipay').map((payment) => (
            <Flexbox className={styles.card} gap={24} key={payment.id}>
              <Flexbox horizontal align="center" justify="space-between">
                <h2 style={{ margin: 0 }}>{t(payment.id)}</h2>
                <Badge good={payment.enabled}>{t(payment.enabled ? 'enabled' : 'disabled')}</Badge>
              </Flexbox>
              <Flexbox gap={12}>
                <span>
                  {t('currency')}: {payment.config.currency}
                </span>
                <span>
                  {t('billing.packHint')}
                </span>
                <span className={styles.muted}>
                  {t('sandbox')}: {t(payment.config.sandbox ? 'enabled' : 'disabled')}
                </span>
                {Object.entries(payment.configured)
                  .filter(([key]) =>
                    payment.id === 'alipay'
                      ? key === 'privateKey' || key === 'publicKey'
                      : key === 'secretKey' || key === 'webhookSecret',
                  )
                  .map(([key, value]) => (
                    <Flexbox horizontal justify="space-between" key={key}>
                      <span>{t(key)}</span>
                      <Badge good={value}>{t(value ? 'configured' : 'unconfigured')}</Badge>
                    </Flexbox>
                  ))}
              </Flexbox>
              <Button disabled={!!editing} onClick={() => setEditing(payment)}>
                {t('edit')}
              </Button>
            </Flexbox>
          ))}
        </div>
      </DataState>
    </>
  );
}
