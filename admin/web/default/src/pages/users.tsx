import { Flexbox } from '@lobehub/ui';
import { Button, confirmModal } from '@lobehub/ui/base-ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import useSWR from 'swr';

import { api } from '../api';
import {
  Badge,
  DataState,
  date,
  Editor,
  ErrorNotice,
  Field,
  Pager,
  Pick,
  Search,
  Toggle,
} from '../components';
import { styles } from '../styles';
import type { Page, User } from '../types';
import { Adjustment, type Wallet } from './billing';

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
  const [wallet, setWallet] = useState<Wallet>();
  const [pending, setPending] = useState<string>();
  const [actionError, setActionError] = useState<unknown>();
  const [actionSuccess, setActionSuccess] = useState(false);
  const navigate = useNavigate();
  const { data, error, isLoading, mutate } = useSWR(
    `/api/admin/users?page=${page}&search=${encodeURIComponent(search)}&status=${status}`,
    api<Page<User>>,
  );
  return (
    <>
      {actionError !== undefined && <ErrorNotice error={actionError} />}
      {actionSuccess && <p role="status">{t('sessionsRevoked')}</p>}
      {wallet && <Adjustment close={() => setWallet(undefined)} refresh={mutate} wallet={wallet} />}
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
            <table className={styles.table} style={{ minWidth: 1120 }}>
              <thead>
                <tr>
                  {[
                    'users',
                    'role',
                    'status',
                    'billing.available',
                    'billing.spent',
                    'billing.requestCount',
                    'lastActiveAt',
                    'actions',
                  ].map((key) => (
                    <th key={key}>{t(key)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data?.items.map((user) => (
                  <tr key={user.id}>
                    <td style={{ minWidth: 180 }}>
                      <Flexbox gap={4}>
                        <strong>{user.fullName || user.username || user.email || user.id}</strong>
                        <span className={styles.muted}>{user.email ?? user.id}</span>
                        <small className={styles.muted}>{user.id}</small>
                      </Flexbox>
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {t(user.role === 'admin' ? 'admin' : 'user')}
                    </td>
                    <td>
                      <Badge good={!user.banned}>{t(user.banned ? 'banned' : 'active')}</Badge>
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {user.billingReady ? user.available : '—'}
                      <small style={{ display: 'block' }}>
                        {t('billing.reserved')}: {user.billingReady ? user.reserved : '—'}
                      </small>
                    </td>
                    <td>{user.billingReady ? user.spent : '—'}</td>
                    <td>{user.billingReady ? user.requestCount : '—'}</td>
                    <td className={styles.number}>{date(user.lastActiveAt)}</td>
                    <td>
                      <Flexbox horizontal gap={8} style={{ minWidth: 240 }} wrap="wrap">
                        <Button
                          disabled={!!editing || !!wallet || !!pending}
                          onClick={() => setEditing(user)}
                        >
                          {t('edit')}
                        </Button>
                        <Button
                          disabled={!user.billingReady || !!editing || !!wallet || !!pending}
                          onClick={async () => {
                            setPending(user.id);
                            setActionError(undefined);
                            try {
                              setWallet(
                                await api<Wallet>(
                                  `/api/admin/users/${encodeURIComponent(user.id)}/wallet`,
                                  'POST',
                                ),
                              );
                            } catch (failure) {
                              setActionError(failure);
                            } finally {
                              setPending(undefined);
                            }
                          }}
                        >
                          {t('billing.adjust')}
                        </Button>
                        <Button
                          onClick={() => navigate(`/ledger?user=${encodeURIComponent(user.id)}`)}
                        >
                          {t('ledger')}
                        </Button>
                        <Button
                          onClick={() => navigate(`/orders?search=${encodeURIComponent(user.id)}`)}
                        >
                          {t('orders')}
                        </Button>
                        <Button
                          disabled={!!pending}
                          onClick={() =>
                            confirmModal({
                              title: t('revokeSessions'),
                              content: t('revokeSessionsHint'),
                              okText: t('revokeSessions'),
                              cancelText: t('cancel'),
                              onOk: async () => {
                                setPending(user.id);
                                setActionError(undefined);
                                setActionSuccess(false);
                                try {
                                  await api(
                                    `/api/admin/users/${encodeURIComponent(user.id)}/revoke-sessions`,
                                    'POST',
                                  );
                                  setActionSuccess(true);
                                } catch (failure) {
                                  setActionError(failure);
                                } finally {
                                  setPending(undefined);
                                }
                              },
                            })
                          }
                        >
                          {t('revokeSessions')}
                        </Button>
                        <Button
                          danger
                          disabled={!!editing || !!wallet || !!pending}
                          onClick={() =>
                            confirmModal({
                              title: t('deleteUser'),
                              content: t('deleteUserHint', {
                                name: user.fullName || user.email || user.id,
                              }),
                              okText: t('deleteUser'),
                              cancelText: t('cancel'),
                              onOk: async () => {
                                setPending(user.id);
                                setActionError(undefined);
                                try {
                                  await api(
                                    `/api/admin/users/${encodeURIComponent(user.id)}`,
                                    'DELETE',
                                    { updatedAt: user.updatedAt },
                                  );
                                  await mutate();
                                } catch (failure) {
                                  setActionError(failure);
                                } finally {
                                  setPending(undefined);
                                }
                              },
                            })
                          }
                        >
                          {t('deleteUser')}
                        </Button>
                      </Flexbox>
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
