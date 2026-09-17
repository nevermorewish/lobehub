import './i18n';

import { ConfigProvider, ThemeProvider } from '@lobehub/ui';
import { motion } from 'motion/react';
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { SWRConfig } from 'swr';

import { App } from './app';

function Root() {
  const [dark, setDark] = useState(localStorage.getItem('admin-theme') === 'dark');
  return (
    <ThemeProvider enableGlobalStyle appearance={dark ? 'dark' : 'light'}>
      <ConfigProvider motion={motion}>
        <SWRConfig value={{ revalidateOnFocus: false, shouldRetryOnError: false }}>
          <App
            dark={dark}
            setDark={(value) => {
              setDark(value);
              localStorage.setItem('admin-theme', value ? 'dark' : 'light');
            }}
          />
        </SWRConfig>
      </ConfigProvider>
    </ThemeProvider>
  );
}

const container = document.getElementById('root');
if (!container) throw new Error('Root element is missing');
createRoot(container).render(<Root />);
