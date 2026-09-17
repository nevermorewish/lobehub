import { Flexbox } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';

import { api } from '../api';
import { Badge, DataState, date, Editor, Field, Pager, Pick, Search, Toggle } from '../components';
import { styles } from '../styles';
import type { Page, User } from '../types';

function UserEditor({
  user,
  onClose,
  refresh,
}: {
  user: User;
  onClose: () => void;
  refresh: () => Promise<unknown>;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState({
    username: user.username ?? '',
    email: user.email ?? '',
    fullName: user.fullName ?? '',
    role: user.role ?? 'user',
    banned: user.banned,
    banReason: user.banReason ?? '',
    updatedAt: user.updatedAt,
  });
  return (
    <Editor
      title={`${t('edit')} · ${user.email ?? user.id}`}
      onClose={onClose}
      onSave={async () => {
        await api(`/api/admin/users/${encodeURIComponent(user.id)}`, 'PUT', draft);
        await refresh();
      }}
    >
      <div className={styles.fields}>
        <Field
          label={t('username')}
          value={draft.username}
          onChange={(username) => setDraft({ ...draft, username })}
        />
        <Field
          required
          label={t('email')}
          type="email"
          value={draft.email}
          onChange={(email) => setDraft({ ...draft, email })}
        />
        <Field
          label={t('fullName')}
          value={draft.fullName}
          onChange={(fullName) => setDraft({ ...draft, fullName })}
        />
        <Pick
          label={t('role')}
          value={draft.role}
          options={[
            { value: 'user', label: t('user') },
            { value: 'admin', label: t('admin') },
          ]}
          onChange={(role) => setDraft({ ...draft, role })}
        />
      </div>
      <Toggle
        label={t('banned')}
        value={draft.banned}
        onChange={(banned) => setDraft({ ...draft, banned })}
      />
      <span className={styles.muted}>{t('userBanHint')}</span>
      {draft.banned && (
        <Field
          required
          label={t('banReason')}
          value={draft.banReason}
          onChange={(banReason) => setDraft({ ...draft, banReason })}
        />
      )}
    </Editor>
  );
}

export function UsersPage() {
  const { t } = useTranslation();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [editing, setEditing] = useState<User>();
  const { data, error, isLoading, mutate } = useSWR(
    `/api/admin/users?page=${page}&search=${encodeURIComponent(search)}&status=${status}`,
    api<Page<User>>,
  );
  return (
    <>
      {editing && (
        <UserEditor
          key={editing.id}
          refresh={mutate}
          user={editing}
          onClose={() => setEditing(undefined)}
        />
      )}
      <div className={styles.card}>
        <Flexbox
          horizontal
          align="end"
          className={styles.toolbar}
          gap={16}
          justify="space-between"
          wrap="wrap"
        >
          <Search
            onSearch={(value) => {
              setSearch(value);
              setPage(1);
            }}
          />
          <Pick
            label={t('status')}
            value={status}
            options={[
              { value: '', label: t('all') },
              { value: 'active', label: t('active') },
              { value: 'banned', label: t('banned') },
            ]}
            onChange={(value) => {
              setStatus(value);
              setPage(1);
            }}
          />
          <Button onClick={() => void mutate()}>{t('refresh')}</Button>
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
                  {['users', 'role', 'status', 'lastActiveAt', 'actions'].map((key) => (
                    <th key={key}>{t(key)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data?.items.map((user) => (
                  <tr key={user.id}>
                    <td>
                      <Flexbox gap={4}>
                        <strong>{user.fullName || user.username || user.email || user.id}</strong>
                        <span className={styles.muted}>{user.email ?? user.id}</span>
                      </Flexbox>
                    </td>
                    <td>{t(user.role === 'admin' ? 'admin' : 'user')}</td>
                    <td>
                      <Badge good={!user.banned}>{t(user.banned ? 'banned' : 'active')}</Badge>
                    </td>
                    <td className={styles.number}>{date(user.lastActiveAt)}</td>
                    <td>
                      <Button disabled={!!editing} onClick={() => setEditing(user)}>
                        {t('edit')}
                      </Button>
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
