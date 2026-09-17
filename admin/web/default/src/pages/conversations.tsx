import { Flexbox, Markdown } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { ArrowLeft } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';
import useSWRInfinite from 'swr/infinite';

import { api } from '../api';
import { Badge, DataState, date, Field, Pager, Pick, Search } from '../components';
import type { Conversation, MessagePage } from '../content-types';
import { styles } from '../styles';
import type { Page } from '../types';

export function JSONDetail({ label, value }: { label: string; value: unknown }) {
  if (value === undefined || value === null || (Array.isArray(value) && value.length === 0))
    return null;
  return (
    <details>
      <summary style={{ cursor: 'pointer', padding: '8px 0' }}>{label}</summary>
      <pre
        style={{
          whiteSpace: 'pre-wrap',
          overflowWrap: 'anywhere',
          maxHeight: 400,
          overflow: 'auto',
          fontSize: 12,
        }}
      >
        {typeof value === 'string' ? value : JSON.stringify(value, null, 2)}
      </pre>
    </details>
  );
}

function ConversationDetail({ id, close }: { id: string; close: () => void }) {
  const { t } = useTranslation();
  const { data, error, isLoading, isValidating, setSize, mutate } = useSWRInfinite<MessagePage>(
    (index, previous: MessagePage | null) => {
      if (previous && !previous.hasMore) return null;
      return `/api/admin/conversations/${encodeURIComponent(id)}/messages${index > 0 ? `?cursor=${encodeURIComponent(previous?.nextCursor ?? '')}` : ''}`;
    },
    api<MessagePage>,
  );
  const conversation = data?.[0]?.conversation;
  const messages =
    data
      ?.slice()
      .reverse()
      .flatMap((page) => page.items) ?? [];
  return (
    <Flexbox gap={24}>
      <Button icon={ArrowLeft} style={{ alignSelf: 'start' }} onClick={close}>
        {t('back')}
      </Button>
      <DataState empty={false} error={error} loading={isLoading} retry={() => void mutate()}>
        <div className={styles.card}>
          <Flexbox gap={12}>
            <h2 style={{ margin: 0 }}>{conversation?.title || id}</h2>
            <span className={styles.muted}>
              {conversation?.owner.email} · {conversation?.source_name} ·{' '}
              {conversation?.message_count} {t('messages')}
            </span>
            <span className={styles.muted}>{t('conversationReadOnly')}</span>
          </Flexbox>
        </div>
        {data?.at(-1)?.hasMore && (
          <Button loading={isValidating} onClick={() => void setSize((size) => size + 1)}>
            {t('olderMessages')}
          </Button>
        )}
        {messages.length === 0 && <div className={styles.empty}>{t('empty')}</div>}
        {messages.map((message) => (
          <article className={styles.card} data-message-id={message.id} key={message.id}>
            <Flexbox gap={16}>
              <Flexbox horizontal gap={12} justify="space-between" wrap="wrap">
                <Flexbox horizontal gap={12}>
                  <Badge good={message.role === 'assistant'}>{message.role}</Badge>
                  <strong>{message.actor_name || message.model || ''}</strong>
                </Flexbox>
                <span className={styles.muted}>{date(message.created_at)}</span>
              </Flexbox>
              {message.content && <Markdown>{message.content}</Markdown>}
              {message.attachments.length > 0 && (
                <Flexbox gap={8}>
                  {message.attachments.map((file) => (
                    <span key={file.id}>
                      {file.name} · {(file.size / 1024).toFixed(1)} KB
                    </span>
                  ))}
                </Flexbox>
              )}
              {(
                [
                  'reasoning',
                  'tools',
                  'plugin',
                  'translation',
                  'search',
                  'usage',
                  'error',
                  'metadata',
                  'queries',
                  'thread',
                  'message_group',
                  'tts',
                  'editor_data',
                ] as const
              ).map((key) => (
                <JSONDetail key={key} label={t(`message.${key}`)} value={message[key]} />
              ))}
            </Flexbox>
          </article>
        ))}
      </DataState>
    </Flexbox>
  );
}

export function ConversationsPage() {
  const { t } = useTranslation();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState('');
  const [advanced, setAdvanced] = useState(false);
  const [filters, setFilters] = useState({
    type: '',
    status: '',
    trigger: '',
    model: '',
    provider: '',
    from: '',
    to: '',
    sort: 'updated_at',
    order: 'desc',
  });
  const query = new URLSearchParams({ page: String(page), search, ...filters });
  const { data, error, isLoading, mutate } = useSWR(
    selected ? null : `/api/admin/conversations?${query}`,
    api<Page<Conversation>>,
  );
  const change = (key: keyof typeof filters, value: string) => {
    setFilters({ ...filters, [key]: value });
    setPage(1);
  };
  if (selected)
    return <ConversationDetail close={() => setSelected('')} id={selected} key={selected} />;
  return (
    <div className={styles.card}>
      <Flexbox horizontal className={styles.toolbar} gap={12} justify="space-between" wrap="wrap">
        <Search
          onSearch={(value) => {
            setSearch(value);
            setPage(1);
          }}
        />
        <Button onClick={() => setAdvanced(!advanced)}>{t('filters')}</Button>
        <Button onClick={() => void mutate()}>{t('refresh')}</Button>
      </Flexbox>
      {advanced && (
        <div className={styles.fields} style={{ paddingBottom: 24 }}>
          <Pick
            label={t('type')}
            value={filters.type}
            options={['', 'agent', 'group', 'unknown'].map((value) => ({
              value,
              label: value || t('all'),
            }))}
            onChange={(value) => change('type', value)}
          />
          {(['status', 'trigger', 'model', 'provider'] as const).map((key) => (
            <Field
              key={key}
              label={t(key)}
              value={filters[key]}
              onChange={(value) => change(key, value)}
            />
          ))}
          {(['from', 'to'] as const).map((key) => (
            <Field
              key={key}
              label={t(key)}
              type="datetime-local"
              value={
                filters[key]
                  ? new Date(
                      new Date(filters[key]).getTime() -
                        new Date(filters[key]).getTimezoneOffset() * 60000,
                    )
                      .toISOString()
                      .slice(0, 16)
                  : ''
              }
              onChange={(value) => change(key, value ? new Date(value).toISOString() : '')}
            />
          ))}
          <Pick
            label={t('sort')}
            value={filters.sort}
            options={[
              'updated_at',
              'created_at',
              'message_count',
              'total_tokens',
              'total_cost',
            ].map((value) => ({ value, label: t(value) }))}
            onChange={(value) => change('sort', value)}
          />
          <Pick
            label={t('order')}
            options={['asc', 'desc'].map((value) => ({ value, label: t(value) }))}
            value={filters.order}
            onChange={(value) => change('order', value)}
          />
        </div>
      )}
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
                  'conversations',
                  'owner',
                  'source',
                  'message_count',
                  'total_tokens',
                  'total_cost',
                  'updated_at',
                  'actions',
                ].map((key) => (
                  <th key={key}>{t(key)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data?.items.map((item) => (
                <tr key={item.id}>
                  <td>
                    <Flexbox gap={4}>
                      <strong>{item.title || item.id}</strong>
                      <span className={styles.muted}>
                        {item.model} · {item.provider}
                      </span>
                    </Flexbox>
                  </td>
                  <td>{item.owner.email || item.owner.username || item.owner.id}</td>
                  <td>{item.source_name || item.type}</td>
                  <td className={styles.number}>{item.message_count}</td>
                  <td className={styles.number}>{item.total_tokens?.toLocaleString() ?? '—'}</td>
                  <td className={styles.number}>{item.total_cost ?? '—'}</td>
                  <td className={styles.number}>{date(item.updated_at)}</td>
                  <td>
                    <Button onClick={() => setSelected(item.id)}>{t('view')}</Button>
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
