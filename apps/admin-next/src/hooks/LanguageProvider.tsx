'use client';

/**
 * LanguageProvider — thin shim that bridges next-intl with the existing codebase.
 *
 * Locale is now driven by `next-intl`:
 *   - Server reads locale from the `app_locale` cookie (see src/i18n/request.ts).
 *   - Client locale comes from <NextIntlClientProvider> rendered in app/layout.tsx.
 *
 * `setLocale` writes the cookie + refreshes server components so next-intl picks up
 * the new locale on the next RSC render cycle.
 *
 * All existing imports of `useLanguage`, `getLocalizedValue`, and `Locale` continue
 * to work without changes in the consuming files.
 */

import React, { createContext, useCallback, type ReactNode } from 'react';
import { useLocale } from 'next-intl';
import { useRouter } from 'next/navigation';
import { DEFAULT_LOCALE, type Locale } from '@lucky/shared';
import { useAppStore } from '@/store/useAppStore';

export interface LanguageContextType {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  /** @deprecated translations are now provided by next-intl; always undefined */
  translations?: Record<string, string>;
}

export const LanguageContext = createContext<LanguageContextType | undefined>(
  undefined,
);

export interface LanguageProviderProps {
  children: ReactNode;
  /** @deprecated no longer needed; locale is driven by next-intl */
  initialLocale?: Locale;
  /** @deprecated no longer needed; messages are provided by next-intl */
  initialTranslations?: Record<string, string>;
}

/**
 * LanguageProvider is kept for backward compatibility.
 * In the new architecture it is a no-op wrapper; the real provider is
 * <NextIntlClientProvider> in app/layout.tsx.
 */
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

  // eslint-disable-next-line react-hooks/rules-of-hooks
  const router = useRouter();

  const setLocale = useCallback(
    (newLocale: Locale) => {
      if (typeof document !== 'undefined') {
        document.cookie = `app_locale=${newLocale};path=/;max-age=31536000;SameSite=Lax`;
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

// Re-export Locale type for backward compatibility
export type { Locale };
