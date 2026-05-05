'use client';

/**
 * useTranslation — backward-compatible shim over next-intl.
 *
 * All existing call sites (`const { t, lang, setLang } = useTranslation()`) work unchanged.
 * Missing keys never throw: request.ts uses English as a baseline so every key
 * is always present in messages, and onError is configured to be a no-op.
 *
 * NOTE: Some route names (e.g. operationLogs) are also used as i18n namespace keys.
 * In the flattened messages these resolve to objects, not strings, causing next-intl
 * to throw INSUFFICIENT_PATH. We catch that and return the key as fallback.
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
      // Use tNext.raw() to check if the key resolves to a string first.
      // Some keys (e.g. 'finance') match namespace objects, which would cause
      // INSUFFICIENT_PATH errors with tNext() — even when caught, next-intl
      // still logs them via its internal onError handler.
      // Additionally, raw() can throw MISSING_MESSAGE for dot-path keys
      // (e.g. 'adminUsers.roleSuperAdmin') when resolution fails internally,
      // even though the translated value exists in the nested object. We catch
      // that and return the key as fallback.
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
