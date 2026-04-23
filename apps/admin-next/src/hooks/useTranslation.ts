'use client';

import { useCallback } from 'react';
import { useLanguage } from '@/hooks/LanguageProvider';
import type { Locale } from '@lucky/shared';
import * as I18n from '@/i18n';

export type TFunc = (
  key: string,
  params?: Record<string, string | number>,
) => string;

/**
 * Client-side hook to read translations and switch language.
 * It intentionally keeps implementation simple and synchronous by default
 * (reading from the in-memory TRANSLATIONS provided by ./index.ts). For
 * large locale sets you may call `loadLocale(lang)` before switching to
 * reduce initial bundle size (the project already provides `loadLocale`).
 */
export function useTranslation() {
  const { locale, setLocale, translations: ctxTranslations } = useLanguage();
  const lang = locale as Locale;

  const t: TFunc = useCallback(
      (key: string, params?: Record<string, string | number>) => {
      const translations =
        ctxTranslations || I18n.TRANSLATIONS[lang] || I18n.TRANSLATIONS['en'] || {};
      let text = translations[key] ?? I18n.TRANSLATIONS['en'][key] ?? key;

      if (params) {
        Object.entries(params).forEach(([k, v]) => {
          text = text.replace(`{${k}}`, String(v));
        });
      }

      return text;
    },
    [lang],
  );

  const setLang = useCallback(
    (next: Locale) => {
      // update provider state
      setLocale(next);
      // sync document lang for accessibility
      if (typeof document !== 'undefined') {
        document.documentElement.lang = next;
        try {
          // persist choice
          localStorage.setItem('app_locale', next);
        } catch {
          // ignore
        }
      }
    },
    [setLocale],
  );

  // note: loaders are available from `@/i18n` if callers need them
  return {
    t,
    lang,
    setLang,
    translations: ctxTranslations || I18n.TRANSLATIONS[lang] || {},
  } as const;
}
