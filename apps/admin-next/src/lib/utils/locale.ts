/**
 * Locale detection utilities — SSR (Accept-Language) & CSR (navigator.language)
 *
 * Priority: app_locale cookie (user's explicit choice / middleware detection) >
 *           URL locale (from next-intl /[locale]/path routing) >
 *           Accept-Language header (browser detection) >
 *           DEFAULT_LOCALE (zh)
 *
 * Forked from admin-blog's locale.ts, adapted for admin-next's URL-based routing.
 */

import type { NextRequest } from 'next/server';

/**
 * Supported locale codes — defined inline to avoid importing @lucky/shared.
 * @lucky/shared → order-no.helper.ts uses node:crypto which cannot be
 * resolved on Edge Runtime (where middleware runs).
 */
const SUPPORTED_LOCALES = ['en', 'zh', 'ja', 'ko', 'fr', 'de'] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];

/**
 * Fallback locale for Accept-Language parsing when nothing matches.
 * Note: This is ONLY for the parsing utility. The app's actual fallback
 * is DEFAULT_LOCALE ('zh') defined in i18n/request.ts.
 */
export const FALLBACK_LOCALE: Locale = 'en';

// ── SSR: Accept-Language parsing ────────────────────────────────────────────

/**
 * Parse Accept-Language header and return the best matching supported locale.
 *
 * Format: "zh-CN,zh;q=0.9,en;q=0.8"
 *
 * @returns Best matching locale, or null if nothing matches
 */
export function parseAcceptLanguage(header: string | null): Locale | null {
  if (!header) return null;

  const locales = header
    .split(',')
    .map((entry) => {
      const [tag, qPart] = entry.split(';');
      const q = qPart ? parseFloat(qPart.replace('q=', '')) : 1.0;
      // Extract primary language tag: "zh-CN" → "zh", "en-US" → "en"
      const primaryLang = tag.trim().split('-')[0].toLowerCase();
      return { lang: primaryLang, q };
    })
    .sort((a, b) => b.q - a.q); // Higher q value = higher priority

  for (const { lang } of locales) {
    if ((SUPPORTED_LOCALES as readonly string[]).includes(lang)) {
      return lang as Locale;
    }
  }

  return null;
}

/**
 * Detect locale from a NextRequest (middleware/SSR).
 *
 * Priority: app_locale cookie > Accept-Language > FALLBACK_LOCALE
 */
export function detectLocaleFromRequest(request: NextRequest): Locale {
  // 1. Cookie — user's explicit choice or middleware-set
  const cookieLocale = request.cookies.get('app_locale')?.value;
  if (cookieLocale && isSupportedLocale(cookieLocale)) {
    return cookieLocale as Locale;
  }

  // 2. Accept-Language — browser language detection
  const acceptLanguage = request.headers.get('accept-language');
  const browserLocale = parseAcceptLanguage(acceptLanguage);
  if (browserLocale) {
    return browserLocale;
  }

  // 3. Fallback (used as signal that nothing matched)
  return FALLBACK_LOCALE;
}

// ── CSR: navigator.language ─────────────────────────────────────────────────

/**
 * Client-side only: detect browser language from navigator.language.
 *
 * Returns FALLBACK_LOCALE if the language is unsupported or not in browser.
 */
export function detectLocaleFromBrowser(): Locale {
  if (typeof navigator === 'undefined') return FALLBACK_LOCALE;

  const raw = navigator.language;
  if (!raw) return FALLBACK_LOCALE;

  const primaryLang = raw.split('-')[0].toLowerCase();
  if ((SUPPORTED_LOCALES as readonly string[]).includes(primaryLang)) {
    return primaryLang as Locale;
  }

  return FALLBACK_LOCALE;
}

// ── Validation ──────────────────────────────────────────────────────────────

/**
 * Check whether a locale code is in the supported list.
 */
export function isSupportedLocale(code: string): code is Locale {
  return (SUPPORTED_LOCALES as readonly string[]).includes(code);
}
