"use client";

import { useCallback } from "react";
import { useTranslations, useLocale } from "next-intl";
import { useLanguage } from "@/hooks/LanguageProvider";
import type { Locale } from "@lucky/shared";

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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const raw = (tNext as any).raw?.(key as any);
      if (typeof raw !== "string") {
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
