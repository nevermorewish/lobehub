import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';

import { api } from '../api';
import { DataState, date, Pager } from '../components';
import { styles } from '../styles';
import type { Audit, Page } from '../types';

export function AuditPage() {
  const { t } = useTranslation();
  const [page, setPage] = useState(1);
  const { data, error, isLoading, mutate } = useSWR(
    `/api/admin/audit?page=${page}`,
    api<Page<Audit>>,
  );
  return (
    <div className={styles.card}>
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
                {['time', 'actor', 'action', 'target'].map((key) => (
                  <th key={key}>{t(key)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data?.items.map((item) => (
                <tr key={item.id}>
                  <td className={styles.number}>{date(item.createdAt)}</td>
                  <td>{item.actor}</td>
                  <td>{item.action}</td>
                  <td>{item.target}</td>
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
