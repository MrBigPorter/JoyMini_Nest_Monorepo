'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useLocale } from 'next-intl';
import { detectLocaleFromBrowser, FALLBACK_LOCALE } from '@/lib/utils/locale';
import { AVAILABLE_LOCALES } from '@lucky/shared';
import type { Locale } from '@lucky/shared';

/**
 * Client-side I18nProvider — detects browser language on first visit only.
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
 *
 * IMPORTANT: Locale detection + router.refresh() only runs on FIRST MOUNT.
 * This prevents router.refresh() from being called during client-side
 * navigation, which can trigger an RSC re-fetch that destabilizes React's
 * hook chain during component transitions.
 */
export default function I18nProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const currentLocale = useLocale();
  const router = useRouter();
  const hasRunRef = useRef(false);

  useEffect(() => {
    if (typeof document === 'undefined') return;

    // Sync locale to document for CSS / third-party (always keep in sync)
    document.documentElement.lang = currentLocale;

    // Only run locale detection on first mount, NOT during navigation re-renders
    if (hasRunRef.current) return;
    hasRunRef.current = true;

    // If user has a NEXT_LOCALE cookie (manually chosen), skip detection
    const hasCookie = document.cookie.match(/(^| )NEXT_LOCALE=([^;]+)/);
    if (hasCookie) return;

    // Only auto-detect on first visit (no cookie)
    const browserLang = detectLocaleFromBrowser();

    // If browser language is already the current locale, nothing to do
    if (browserLang === currentLocale) return;

    // If browser language is the fallback (en) and current is also en, skip
    if (browserLang === FALLBACK_LOCALE && currentLocale === FALLBACK_LOCALE)
      return;

    // Set the cookie and refresh
    const expires = new Date(
      Date.now() + 365 * 24 * 60 * 60 * 1000,
    ).toUTCString();
    document.cookie = `NEXT_LOCALE=${browserLang}; path=/; expires=${expires}; SameSite=Lax`;

    // Refresh to re-render with the new locale
    router.refresh();
  }, [currentLocale, router]);

  return <>{children}</>;
}
