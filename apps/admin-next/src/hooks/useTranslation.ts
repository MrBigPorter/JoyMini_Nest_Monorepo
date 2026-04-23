'use client';

/**
 * useTranslation — backward-compatible shim over next-intl.
 *
 * All existing call sites (`const { t, lang, setLang } = useTranslation()`) work unchanged.
 * Missing keys never throw: request.ts uses English as a baseline so every key
 * is always present in messages, and onError is configured to be a no-op.
 */

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
      // next-intl never throws here: en.json baseline + onError no-op in request.ts
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return tNext(key as any, params as any) as string;
    },
    [tNext],
  );

  const setLang = useCallback((next: Locale) => setLocale(next), [setLocale]);

  return { t, lang, setLang } as const;
}
