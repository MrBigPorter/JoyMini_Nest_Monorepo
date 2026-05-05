'use client';

import { useCallback } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { useLanguage } from '@/hooks/LanguageProvider';
import type { Locale } from '@lucky/shared';

export type TFunc = (
  key: string,
  params?: Record<string, string | number>,
) => string;

export function useTranslation() {
  const tNext = useTranslations();
  const lang = useLocale() as Locale;
  const { setLocale } = useLanguage();

  const t: TFunc = useCallback(
    (key: string, params?: Record<string, string | number>) => {
      // Use tNext.raw() to check if the key resolves to a string first.
      // Some keys (e.g. 'systemConfig') match namespace objects, which would
      // cause INSUFFICIENT_PATH errors with tNext() — even when caught,
      // next-intl still logs them via its internal onError handler.
      // Additionally, raw() can throw MISSING_MESSAGE for keys that don't
      // exist in messages (e.g. 'roleSuperAdmin' when adminUsers isn't
      // flattened). We catch that and return the key as fallback.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let raw: unknown;
      try {
        raw = (tNext as any).raw?.(key as any);
      } catch {
        raw = undefined;
      }
      if (typeof raw !== 'string') {
        return key;
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return tNext(key as any, params as any) as string;
    },
    [tNext],
  );

  const setLang = useCallback((next: Locale) => setLocale(next), [setLocale]);

  return { t, lang, setLang } as const;
}
