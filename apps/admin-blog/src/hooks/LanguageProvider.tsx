'use client';

import React, { createContext, useCallback, type ReactNode } from 'react';
import { useLocale } from 'next-intl';
import { useRouter } from 'next/navigation';
import { DEFAULT_LOCALE, type Locale } from '@lucky/shared';
import { useAppStore } from '@/store/useAppStore';

export interface LanguageContextType {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  translations?: Record<string, string>;
}

export const LanguageContext = createContext<LanguageContextType | undefined>(
  undefined,
);

export interface LanguageProviderProps {
  children: ReactNode;
  initialLocale?: Locale;
  initialTranslations?: Record<string, string>;
}

export const LanguageProvider: React.FC<LanguageProviderProps> = ({
  children,
}) => {
  return <>{children}</>;
};

export function useLanguage() {
  let locale: Locale = DEFAULT_LOCALE;
  try {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    locale = useLocale() as Locale;
  } catch {
    locale = DEFAULT_LOCALE;
  }

  let router: { refresh: () => void };
  try {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    router = useRouter();
  } catch {
    // useRouter() throws "invariant expected app router to be mounted" when called
    // outside the Next.js App Router context (e.g. inside a modal/portal).
    // Falling back to a no-op refresh via window reload.
    router = {
      refresh: () => {
        if (typeof window !== 'undefined') {
          window.location.reload();
        }
      },
    };
  }

  const setLocale = useCallback(
    (newLocale: Locale) => {
      if (typeof document !== 'undefined') {
        document.cookie = `app_locale=${newLocale};path=/;max-age=31536000;SameSite=Lax`;
        document.cookie = `NEXT_LOCALE=${newLocale};path=/;max-age=31536000;SameSite=Lax`;
        try {
          localStorage.setItem('app_locale', newLocale);
        } catch {
          // ignore
        }
      }
      const appStore = useAppStore.getState();
      if (appStore.lang !== newLocale) {
        appStore.setLang(newLocale);
      }
      router.refresh();
    },
    [router],
  );

  return { locale, setLocale, translations: undefined };
}

export function getLocalizedValue<T>(
  value: Record<string, T | undefined> | undefined,
  locale: Locale,
): T | undefined {
  if (!value) return undefined;
  return value[locale] as T;
}

export type { Locale };
