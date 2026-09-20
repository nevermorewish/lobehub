import { Flexbox, Input, TextArea } from '@lobehub/ui';
import { Button, Select, Switch } from '@lobehub/ui/base-ui';
import type { FormEvent, ReactNode } from 'react';
import { createContext, use, useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { APIError } from './api';
import { styles } from './styles';

const EditorChangeContext = createContext<(() => void) | undefined>(undefined);

export function ErrorNotice({ error, retry }: { error: unknown; retry?: () => void }) {
  const { t } = useTranslation();
  return (
    <Flexbox className={styles.error} gap={12} role="alert">
      <span>{t(`error.${error instanceof APIError ? error.code : 'unavailable'}`)}</span>
      {retry && <Button onClick={retry}>{t('retry')}</Button>}
    </Flexbox>
  );
}

export function Badge({ good, children }: { good?: boolean; children: ReactNode }) {
  return <span className={`${styles.badge} ${good ? styles.good : ''}`}>{children}</span>;
}

export function Field({
  label,
  value,
  onChange: change,
  type = 'text',
  required,
  disabled,
  hint,
  multiline,
  min,
  max,
}: {
  label: string;
  value: string | number;
  onChange: (value: string) => void;
  type?: string;
  required?: boolean;
  disabled?: boolean;
  hint?: string;
  multiline?: boolean;
  min?: number;
  max?: number;
}) {
  const id = useId();
  const markChanged = use(EditorChangeContext);
  const onChange = (next: string) => {
    markChanged?.();
    change(next);
  };
  return (
    <div className={styles.field}>
      <label htmlFor={id}>{label}</label>
      {multiline ? (
        <TextArea
          autoComplete="off"
          id={id}
          required={required}
          rows={4}
          value={String(value)}
          onChange={(event) => onChange(event.target.value)}
        />
      ) : (
        <Input
          autoComplete={type === 'password' ? 'new-password' : 'off'}
          disabled={disabled}
          id={id}
          max={max}
          min={min}
          required={required}
          step={type === 'number' ? 1 : undefined}
          type={type}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
      {hint && <small>{hint}</small>}
    </div>
  );
}

export function Pick({
  label,
  value,
  options,
  onChange: change,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  const id = useId();
  const markChanged = use(EditorChangeContext);
  const onChange = (next: string) => {
    markChanged?.();
    change(next);
  };
  const emptyValue = '__admin_empty_option__';
  return (
    <div className={styles.field}>
      <label htmlFor={id}>{label}</label>
      <Select
        id={id}
        options={options.map((option) => ({ ...option, value: option.value || emptyValue }))}
        style={{ minWidth: 140 }}
        value={value || emptyValue}
        onChange={(next) => {
          if (typeof next === 'string') onChange(next === emptyValue ? '' : next);
        }}
      />
    </div>
  );
}

export function Toggle({
  label,
  value,
  onChange: change,
}: {
  label: string;
  value: boolean;
  onChange: (value: boolean) => void;
}) {
  const id = useId();
  const markChanged = use(EditorChangeContext);
  const onChange = (next: boolean) => {
    markChanged?.();
    change(next);
  };
  return (
    <Flexbox horizontal align="center" gap={12}>
      <Switch checked={value} id={id} onChange={onChange} />
      <label htmlFor={id}>{label}</label>
    </Flexbox>
  );
}

export function Editor({
  title,
  children,
  onSave,
  onClose,
  saveLabel,
  saveDisabled = false,
  dirty: externalDirty = false,
}: {
  title: string;
  children: ReactNode;
  onSave: () => Promise<void>;
  onClose: () => void;
  saveLabel?: string;
  saveDisabled?: boolean;
  dirty?: boolean;
}) {
  const { t } = useTranslation();
  const [pending, setPending] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<unknown>();
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (dirty || externalDirty) event.preventDefault();
    };
    const navigate = (event: Event) => {
      if ((dirty || externalDirty || pending) && (pending || !window.confirm(t('unsaved'))))
        event.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    window.addEventListener('admin:navigate', navigate);
    return () => {
      window.removeEventListener('beforeunload', warn);
      window.removeEventListener('admin:navigate', navigate);
    };
  }, [dirty, externalDirty, pending, t]);
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (pending || saveDisabled) return;
    setPending(true);
    setError(undefined);
    try {
      await onSave();
      setDirty(false);
      onClose();
    } catch (failure) {
      setError(failure);
    } finally {
      setPending(false);
    }
  };
  return (
    <EditorChangeContext value={() => setDirty(true)}>
      <form className={styles.editor} onSubmit={(event) => void save(event)}>
        <Flexbox gap={24}>
          <h2>{title}</h2>
          <fieldset disabled={pending} style={{ border: 0, padding: 0, margin: 0 }}>
            <Flexbox gap={24}>{children}</Flexbox>
          </fieldset>
          {error !== undefined && <ErrorNotice error={error} />}
          <Flexbox horizontal gap={12}>
            <Button disabled={saveDisabled} htmlType="submit" loading={pending} type="primary">
              {saveLabel ?? t('save')}
            </Button>
            <Button
              disabled={pending}
              onClick={() => {
                if ((!dirty && !externalDirty) || window.confirm(t('unsaved'))) onClose();
              }}
            >
              {t('cancel')}
            </Button>
          </Flexbox>
        </Flexbox>
      </form>
    </EditorChangeContext>
  );
}

export function Pager({
  page,
  total,
  size = 25,
  setPage,
}: {
  page: number;
  total: number;
  size?: number;
  setPage: (page: number) => void;
}) {
  const { t } = useTranslation();
  return (
    <Flexbox horizontal align="center" gap={16} justify="space-between" style={{ paddingTop: 20 }}>
      <span className={styles.muted}>{t('total', { count: total })}</span>
      <Flexbox horizontal align="center" gap={12}>
        <Button disabled={page <= 1} onClick={() => setPage(page - 1)}>
          {t('previous')}
        </Button>
        <span>{t('page', { page })}</span>
        <Button disabled={page * size >= total} onClick={() => setPage(page + 1)}>
          {t('next')}
        </Button>
      </Flexbox>
    </Flexbox>
  );
}

export function Search({ onSearch }: { onSearch: (value: string) => void }) {
  const { t } = useTranslation();
  const [value, setValue] = useState('');
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onSearch(value.trim());
      }}
    >
      <Flexbox horizontal gap={8}>
        <Input
          allowClear
          aria-label={t('search')}
          placeholder={t('searchHint')}
          style={{ width: 'min(320px, 50vw)' }}
          value={value}
          onChange={(event) => setValue(event.target.value)}
        />
        <Button htmlType="submit">{t('search')}</Button>
      </Flexbox>
    </form>
  );
}

export function DataState({
  loading,
  empty,
  error,
  retry,
  children,
}: {
  loading: boolean;
  empty: boolean;
  error: unknown;
  retry: () => void;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  if (error) return <ErrorNotice error={error} retry={retry} />;
  if (loading)
    return (
      <div className={styles.empty} role="status">
        {t('loading')}
      </div>
    );
  if (empty) return <div className={styles.empty}>{t('empty')}</div>;
  return <>{children}</>;
}

export const date = (value: string) =>
  value && !value.startsWith('0001') ? new Date(value).toLocaleString() : '—';
