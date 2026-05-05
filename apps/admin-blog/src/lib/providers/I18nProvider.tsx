'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useLocale } from 'next-intl';
import { detectLocaleFromBrowser, FALLBACK_LOCALE } from '@/lib/utils/locale';
import { AVAILABLE_LOCALES } from '@lucky/shared';
import type { Locale } from '@lucky/shared';

/**
 * Client-side I18nProvider — detects browser language on first visit.
 *
 * On first visit (no NEXT_LOCALE cookie), reads navigator.language and
 * auto-switches to the matching locale if one is found and it differs
 * from the current locale.
 *
 * If the browser language doesn't match any supported locale, does nothing
 * (server will use English fallback).
 *
 * Once the user manually switches language (via LanguageSwitch), the
 * NEXT_LOCALE cookie is set and this provider skips detection entirely.
 */
export default function I18nProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const currentLocale = useLocale();
  const router = useRouter();

  useEffect(() => {
    if (typeof document === 'undefined') return;

    // 1. Sync locale to document for CSS / third-party
    document.documentElement.lang = currentLocale;

    // 2. If user has a NEXT_LOCALE cookie (manually chosen), skip detection
    const hasCookie = document.cookie.match(/(^| )NEXT_LOCALE=([^;]+)/);
    if (hasCookie) return;

    // 3. Only auto-detect on first visit (no cookie)
    const browserLang = detectLocaleFromBrowser();

    // If browser language is already the current locale, nothing to do
    if (browserLang === currentLocale) return;

    // If browser language is the fallback (en) and current is also en, skip
    if (browserLang === FALLBACK_LOCALE && currentLocale === FALLBACK_LOCALE)
      return;

    // 4. Set the cookie and refresh
    const expires = new Date(
      Date.now() + 365 * 24 * 60 * 60 * 1000,
    ).toUTCString();
    document.cookie = `NEXT_LOCALE=${browserLang}; path=/; expires=${expires}; SameSite=Lax`;

    // Refresh to re-render with the new locale
    router.refresh();
  }, [currentLocale, router]);

  return <>{children}</>;
}
