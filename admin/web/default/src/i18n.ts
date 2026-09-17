import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import { contentEN, contentZH } from './locales/content';
import en from './locales/en-US.json';
import zh from './locales/zh-CN.json';

void i18n.use(initReactI18next).init({
  resources: {
    en: { translation: { ...en, ...contentEN } },
    zh: { translation: { ...zh, ...contentZH } },
  },
  lng:
    localStorage.getItem('admin-language') ?? (navigator.language.startsWith('zh') ? 'zh' : 'en'),
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
});

export { i18n };
