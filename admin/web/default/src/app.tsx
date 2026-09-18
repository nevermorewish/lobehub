import { Flexbox } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import {
  BookOpen,
  CircleDollarSign,
  History,
  Layers,
  LogOut,
  MessagesSquare,
  Moon,
  Shield,
  Sun,
  Users,
  Wallet,
} from 'lucide-react';
import type { FormEvent } from 'react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import useSWR, { useSWRConfig } from 'swr';

import { api, APIError } from './api';
import { ErrorNotice, Field } from './components';
import { AuditPage } from './pages/audit';
import { LedgerPage, OrdersPage, PacksPage, WalletsPage } from './pages/billing';
import { ConversationsPage } from './pages/conversations';
import { KnowledgePage } from './pages/knowledge';
import { PaymentsPage } from './pages/payments';
import { PricesPage } from './pages/prices';
import { ProvidersPage } from './pages/providers';
import { UsersPage } from './pages/users';
import { styles } from './styles';

const pages = {
  wallets: WalletsPage,
  orders: OrdersPage,
  ledger: LedgerPage,
  packs: PacksPage,
  users: UsersPage,
  conversations: ConversationsPage,
  knowledge: KnowledgePage,
  providers: ProvidersPage,
  prices: PricesPage,
  payments: PaymentsPage,
  audit: AuditPage,
};
const icons = {
  wallets: Wallet,
  orders: CircleDollarSign,
  ledger: History,
  packs: Layers,
  users: Users,
  conversations: MessagesSquare,
  knowledge: BookOpen,
  providers: Layers,
  prices: CircleDollarSign,
  payments: Wallet,
  audit: History,
};
type Section = keyof typeof pages;

function Login({ refresh }: { refresh: () => Promise<unknown> }) {
  const { t } = useTranslation();
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>();
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setPending(true);
    setError(undefined);
    try {
      await api('/api/auth/login', 'POST', { username, password });
      await refresh();
    } catch (failure) {
      setError(failure);
    } finally {
      setPending(false);
    }
  };
  return (
    <main className={styles.login}>
      <form className={styles.loginCard} onSubmit={(event) => void submit(event)}>
        <Flexbox gap={24}>
          <Shield size={36} />
          <Flexbox gap={12}>
            <h1>{t('brand')}</h1>
            <span className={styles.muted}>{t('loginHint')}</span>
          </Flexbox>
          <Field required label={t('username')} value={username} onChange={setUsername} />
          <Field
            required
            label={t('password')}
            type="password"
            value={password}
            onChange={setPassword}
          />
          {error !== undefined && (
            <div className={styles.error} role="alert">
              {t('loginError')}
            </div>
          )}
          <Button htmlType="submit" loading={pending} type="primary">
            {t('login')}
          </Button>
        </Flexbox>
      </form>
    </main>
  );
}

export function App({ dark, setDark }: { dark: boolean; setDark: (value: boolean) => void }) {
  const { t, i18n } = useTranslation();
  const { mutate: mutateAll } = useSWRConfig();
  const [section, setSection] = useState<Section>('users');
  const [actionError, setActionError] = useState<unknown>();
  const { data, error, isLoading, mutate } = useSWR('/api/auth/me', api<{ username: string }>, {
    shouldRetryOnError: false,
  });
  useEffect(() => {
    const refresh = () => {
      void mutateAll((key) => key !== '/api/auth/me', undefined, { revalidate: false });
      void mutate();
    };
    window.addEventListener('admin:unauthorized', refresh);
    return () => window.removeEventListener('admin:unauthorized', refresh);
  }, [mutate, mutateAll]);
  if (isLoading)
    return (
      <div className={styles.login} role="status">
        {t('loading')}
      </div>
    );
  if (error instanceof APIError && error.status === 401) return <Login refresh={mutate} />;
  if (error || !data)
    return (
      <div className={styles.login}>
        <ErrorNotice error={error} retry={() => void mutate()} />
      </div>
    );
  const PageComponent = pages[section];
  const logout = async () => {
    if (!window.dispatchEvent(new Event('admin:navigate', { cancelable: true }))) return;
    try {
      await api('/api/auth/logout', 'POST');
      await mutateAll(() => true, undefined, { revalidate: false });
      await mutate();
    } catch (failure) {
      setActionError(failure);
    }
  };
  return (
    <div className={styles.shell}>
      <aside className={styles.sidebar}>
        <Flexbox gap={12}>
          <Shield size={28} />
          <div className={styles.brand}>{t('brand')}</div>
          <span className={styles.muted}>{t('subtitle')}</span>
        </Flexbox>
        <nav aria-label={t('brand')} className={styles.nav}>
          {(Object.keys(pages) as Section[]).map((key) => (
            <Button
              aria-current={section === key ? 'page' : undefined}
              className={styles.navItem}
              icon={icons[key]}
              key={key}
              type={section === key ? 'primary' : 'text'}
              onClick={() => {
                if (
                  key === section ||
                  window.dispatchEvent(new Event('admin:navigate', { cancelable: true }))
                )
                  setSection(key);
              }}
            >
              {t(key)}
            </Button>
          ))}
        </nav>
      </aside>
      <main className={styles.main}>
        <Flexbox className={styles.content} gap={24}>
          <Flexbox horizontal align="center" gap={12} justify="space-between" wrap="wrap">
            <span className={styles.muted}>{data.username}</span>
            <Flexbox horizontal gap={8}>
              <Button
                onClick={() => {
                  const next = i18n.language === 'zh' ? 'en' : 'zh';
                  localStorage.setItem('admin-language', next);
                  void i18n.changeLanguage(next);
                }}
              >
                {i18n.language === 'zh' ? 'English' : '中文'}
              </Button>
              <Button
                aria-label={t(dark ? 'lightMode' : 'darkMode')}
                icon={dark ? Sun : Moon}
                onClick={() => setDark(!dark)}
              />
              <Button icon={LogOut} onClick={() => void logout()}>
                {t('logout')}
              </Button>
            </Flexbox>
          </Flexbox>
          <header className={styles.header}>
            <h1>{t(section)}</h1>
            <p>{t(`${section}Hint`)}</p>
          </header>
          {actionError !== undefined && <ErrorNotice error={actionError} />}
          <PageComponent />
        </Flexbox>
      </main>
    </div>
  );
}
