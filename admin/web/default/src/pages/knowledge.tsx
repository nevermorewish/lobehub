import { Flexbox } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { ArrowLeft } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';

import { api } from '../api';
import { Badge, DataState, date, Editor, Field, Pager, Pick, Search } from '../components';
import type { Chunk, KnowledgeBase, KnowledgeDocument, KnowledgeFile } from '../content-types';
import { styles } from '../styles';
import type { Page } from '../types';
import { JSONDetail } from './conversations';

function KnowledgeEditor({
  library,
  close,
  refresh,
}: {
  library: KnowledgeBase;
  close: () => void;
  refresh: () => Promise<unknown>;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState({
    name: library.name,
    description: library.description ?? '',
    avatar: library.avatar ?? '',
    updatedAt: library.updated_at,
  });
  return (
    <Editor
      title={t('edit')}
      onClose={close}
      onSave={async () => {
        await api(`/api/admin/knowledge-bases/${encodeURIComponent(library.id)}`, 'PATCH', draft);
        await refresh();
      }}
    >
      <Field
        required
        label={t('name')}
        value={draft.name}
        onChange={(name) => setDraft({ ...draft, name })}
      />
      <Field
        multiline
        label={t('description')}
        value={draft.description}
        onChange={(description) => setDraft({ ...draft, description })}
      />
      <Field
        label={t('avatar')}
        value={draft.avatar}
        onChange={(avatar) => setDraft({ ...draft, avatar })}
      />
    </Editor>
  );
}

function Chunks({
  libraryID,
  file,
  close,
}: {
  libraryID: string;
  file: KnowledgeFile;
  close: () => void;
}) {
  const { t } = useTranslation();
  const [page, setPage] = useState(1);
  const { data, error, isLoading, mutate } = useSWR(
    `/api/admin/knowledge-bases/${encodeURIComponent(libraryID)}/files/${encodeURIComponent(file.id)}/chunks?page=${page}`,
    api<Page<Chunk>>,
  );
  return (
    <Flexbox gap={24}>
      <Button style={{ alignSelf: 'start' }} onClick={close}>
        {t('back')}
      </Button>
      <h3>
        {file.name} · {t('chunks')}
      </h3>
      <DataState
        empty={data?.items.length === 0}
        error={error}
        loading={isLoading}
        retry={() => void mutate()}
      >
        {data?.items.map((chunk) => (
          <div className={styles.card} key={chunk.id}>
            <Flexbox gap={12}>
              <Flexbox horizontal justify="space-between">
                <strong>#{chunk.index ?? '—'}</strong>
                <Badge good={chunk.has_embedding}>
                  {chunk.has_embedding ? chunk.model || t('indexed') : t('unindexed')}
                </Badge>
              </Flexbox>
              <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{chunk.text}</pre>
              <JSONDetail label={t('abstract')} value={chunk.abstract} />
              <JSONDetail label={t('message.metadata')} value={chunk.metadata} />
            </Flexbox>
          </div>
        ))}
      </DataState>
      {data && <Pager page={page} setPage={setPage} total={data.total} />}
    </Flexbox>
  );
}

function Document({
  libraryID,
  documentID,
  close,
}: {
  libraryID: string;
  documentID: string;
  close: () => void;
}) {
  const { t } = useTranslation();
  const { data, error, isLoading, mutate } = useSWR(
    `/api/admin/knowledge-bases/${encodeURIComponent(libraryID)}/documents/${encodeURIComponent(documentID)}`,
    api<KnowledgeDocument>,
  );
  return (
    <Flexbox gap={24}>
      <Button style={{ alignSelf: 'start' }} onClick={close}>
        {t('back')}
      </Button>
      <DataState empty={false} error={error} loading={isLoading} retry={() => void mutate()}>
        <div className={styles.card}>
          <h3>{data?.title || data?.filename || documentID}</h3>
          <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{data?.content}</pre>
          <JSONDetail label={t('pages')} value={data?.pages} />
          <JSONDetail label={t('message.editor_data')} value={data?.editor_data} />
          <JSONDetail label={t('message.metadata')} value={data?.metadata} />
        </div>
      </DataState>
    </Flexbox>
  );
}

function KnowledgeDetail({ id, close }: { id: string; close: () => void }) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<'files' | 'documents'>('files');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState(false);
  const [file, setFile] = useState<KnowledgeFile>();
  const [documentID, setDocumentID] = useState('');
  const base = `/api/admin/knowledge-bases/${encodeURIComponent(id)}`;
  const library = useSWR(base, api<KnowledgeBase>);
  const files = useSWR(
    tab === 'files' && !file ? `${base}/files?page=${page}` : null,
    api<Page<KnowledgeFile>>,
  );
  const documents = useSWR(
    tab === 'documents' && !documentID ? `${base}/documents?page=${page}` : null,
    api<Page<KnowledgeDocument>>,
  );
  if (file) return <Chunks close={() => setFile(undefined)} file={file} libraryID={id} />;
  if (documentID)
    return <Document close={() => setDocumentID('')} documentID={documentID} libraryID={id} />;
  const state = tab === 'files' ? files : documents;
  return (
    <Flexbox gap={24}>
      <Button
        icon={ArrowLeft}
        style={{ alignSelf: 'start' }}
        onClick={() => {
          if (window.dispatchEvent(new Event('admin:navigate', { cancelable: true }))) close();
        }}
      >
        {t('back')}
      </Button>
      <DataState
        empty={false}
        error={library.error}
        loading={library.isLoading}
        retry={() => void library.mutate()}
      >
        {library.data && (
          <>
            {editing && (
              <KnowledgeEditor
                close={() => setEditing(false)}
                library={library.data}
                refresh={library.mutate}
              />
            )}
            <div className={styles.card}>
              <Flexbox gap={16}>
                <Flexbox horizontal align="center" justify="space-between">
                  <h2 style={{ margin: 0 }}>{library.data.name}</h2>
                  <Button disabled={editing} onClick={() => setEditing(true)}>
                    {t('edit')}
                  </Button>
                </Flexbox>
                <p className={styles.muted}>{library.data.description}</p>
                <Flexbox horizontal gap={24} wrap="wrap">
                  <span>
                    {t('owner')}: {library.data.owner.email || library.data.owner.id}
                  </span>
                  <span>
                    {t('workspace')}: {library.data.workspace?.name || t('personal')}
                  </span>
                  <Badge good={library.data.rag_status === 'ready'}>
                    {t(`rag.${library.data.rag_status}`)}
                  </Badge>
                </Flexbox>
                <Flexbox horizontal gap={24} wrap="wrap">
                  <span>
                    {t('files')}: {library.data.file_count}
                  </span>
                  <span>
                    {t('documents')}: {library.data.document_count}
                  </span>
                  <span>
                    {t('chunks')}: {library.data.chunk_count}
                  </span>
                  <span>
                    {t('embeddingCoverage')}: {library.data.embedded_chunk_count} /{' '}
                    {library.data.chunk_count}
                  </span>
                  <span>
                    {t('storage')}: {(library.data.total_size / 1024 / 1024).toFixed(2)} MB
                  </span>
                </Flexbox>
              </Flexbox>
            </div>
            <div className={styles.card}>
              <Flexbox horizontal className={styles.toolbar} gap={12}>
                {(['files', 'documents'] as const).map((key) => (
                  <Button
                    key={key}
                    type={tab === key ? 'primary' : 'default'}
                    onClick={() => {
                      setTab(key);
                      setPage(1);
                    }}
                  >
                    {t(key)}
                  </Button>
                ))}
              </Flexbox>
              <DataState
                empty={state.data?.items.length === 0}
                error={state.error}
                loading={state.isLoading}
                retry={() => void state.mutate()}
              >
                <div className={styles.scroll}>
                  {tab === 'files' ? (
                    <table className={styles.table}>
                      <thead>
                        <tr>
                          {['name', 'chunking', 'embedding', 'chunks', 'actions'].map((key) => (
                            <th key={key}>{t(key)}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {files.data?.items.map((item) => (
                          <tr key={item.id}>
                            <td>
                              {item.name}
                              <div className={styles.muted}>
                                {item.file_type} · {(item.size / 1024).toFixed(1)} KB
                              </div>
                            </td>
                            <td>
                              <Badge good={item.chunking_status === 'success'}>
                                {item.chunking_status || '—'}
                              </Badge>
                              <JSONDetail label={t('message.error')} value={item.chunking_error} />
                            </td>
                            <td>
                              <Badge good={item.embedding_status === 'success'}>
                                {item.embedding_status || '—'}
                              </Badge>
                              <JSONDetail label={t('message.error')} value={item.embedding_error} />
                            </td>
                            <td>
                              {item.embedded_chunk_count} / {item.chunk_count}
                            </td>
                            <td>
                              <Button disabled={editing} onClick={() => setFile(item)}>
                                {t('viewChunks')}
                              </Button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <table className={styles.table}>
                      <thead>
                        <tr>
                          {['name', 'type', 'characters', 'actions'].map((key) => (
                            <th key={key}>{t(key)}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {documents.data?.items.map((item) => (
                          <tr key={item.id}>
                            <td>{item.title || item.filename || item.id}</td>
                            <td>{item.file_type}</td>
                            <td>{item.total_char_count}</td>
                            <td>
                              <Button disabled={editing} onClick={() => setDocumentID(item.id)}>
                                {t('view')}
                              </Button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </DataState>
              {state.data && <Pager page={page} setPage={setPage} total={state.data.total} />}
            </div>
          </>
        )}
      </DataState>
    </Flexbox>
  );
}

export function KnowledgePage() {
  const { t } = useTranslation();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState('');
  const [filters, setFilters] = useState({
    scope: '',
    visibility: '',
    ragStatus: '',
    workspace: '',
    sort: 'updated_at',
    order: 'desc',
  });
  const query = new URLSearchParams({ page: String(page), search, ...filters });
  const { data, error, isLoading, mutate } = useSWR(
    selected ? null : `/api/admin/knowledge-bases?${query}`,
    api<Page<KnowledgeBase>>,
  );
  if (selected)
    return <KnowledgeDetail close={() => setSelected('')} id={selected} key={selected} />;
  const change = (key: keyof typeof filters, value: string) => {
    setFilters({ ...filters, [key]: value });
    setPage(1);
  };
  return (
    <div className={styles.card}>
      <Flexbox horizontal align="end" className={styles.toolbar} gap={16} wrap="wrap">
        <Search
          onSearch={(value) => {
            setSearch(value);
            setPage(1);
          }}
        />
        <Pick
          label={t('scope')}
          value={filters.scope}
          options={['', 'personal', 'workspace'].map((value) => ({
            value,
            label: t(value || 'all'),
          }))}
          onChange={(value) => change('scope', value)}
        />
        <Pick
          label={t('visibility')}
          options={['', 'private', 'public'].map((value) => ({ value, label: t(value || 'all') }))}
          value={filters.visibility}
          onChange={(value) => change('visibility', value)}
        />
        <Pick
          label={t('ragStatus')}
          value={filters.ragStatus}
          options={['', 'ready', 'empty', 'processing', 'unindexed', 'error'].map((value) => ({
            value,
            label: value ? t(`rag.${value}`) : t('all'),
          }))}
          onChange={(value) => change('ragStatus', value)}
        />
        <Field
          label={t('workspaceId')}
          value={filters.workspace}
          onChange={(value) => change('workspace', value)}
        />
        <Pick
          label={t('sort')}
          value={filters.sort}
          options={['updated_at', 'created_at', 'file_count', 'total_size'].map((value) => ({
            value,
            label: t(value),
          }))}
          onChange={(value) => change('sort', value)}
        />
      </Flexbox>
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
                  'name',
                  'owner',
                  'workspace',
                  'files',
                  'documents',
                  'embeddingCoverage',
                  'ragStatus',
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
                      <strong>{item.name}</strong>
                      <span className={styles.muted}>{date(item.updated_at)}</span>
                    </Flexbox>
                  </td>
                  <td>{item.owner.email || item.owner.id}</td>
                  <td>{item.workspace?.name || t('personal')}</td>
                  <td>{item.file_count}</td>
                  <td>{item.document_count}</td>
                  <td>
                    {item.embedded_chunk_count} / {item.chunk_count}
                  </td>
                  <td>
                    <Badge good={item.rag_status === 'ready'}>{t(`rag.${item.rag_status}`)}</Badge>
                  </td>
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
