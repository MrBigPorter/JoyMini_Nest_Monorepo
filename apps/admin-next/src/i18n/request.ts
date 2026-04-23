import { getRequestConfig } from 'next-intl/server';
import { cookies } from 'next/headers';
import { DEFAULT_LOCALE, AVAILABLE_LOCALES } from '@lucky/shared';
import type { Locale } from '@lucky/shared';

type RawLocaleJson = {
  translations: Record<string, string>;
  blogCard?: Record<string, string>;
  actSections?: Record<string, string>;
};

function flatten(raw: RawLocaleJson): Record<string, unknown> {
  return {
    ...raw.translations,
    ...(raw.blogCard ? { blogCard: raw.blogCard } : {}),
    ...(raw.actSections ? { actSections: raw.actSections } : {}),
  };
}

export default getRequestConfig(async () => {
  // ── 1. Resolve locale from cookie ──────────────────────────────────────────
  let locale: Locale = DEFAULT_LOCALE;
  try {
    const cookieStore = await cookies();
    const c = cookieStore.get('app_locale')?.value;
    if (c && AVAILABLE_LOCALES.includes(c as Locale)) {
      locale = c as Locale;
    }
  } catch {
    // outside request context – use default
  }

  // ── 2. Always load English as the baseline ─────────────────────────────────
  // Guarantees every key exists in messages. Any locale file that is incomplete
  // (missing keys) will silently show the English text — never MISSING_MESSAGE.
  const enRaw = (await import('./en.json')) as { default: RawLocaleJson };
  const enFlat = flatten(enRaw.default);

  // ── 3. Overlay the target locale on top of the English base ────────────────
  let messages: Record<string, unknown> = enFlat;
  if (locale !== 'en') {
    try {
      const localeRaw = (await import(`./${locale}.json`)) as {
        default: RawLocaleJson;
      };
      const localeFlat = flatten(localeRaw.default);
      messages = {
        ...enFlat, // English fills any gaps
        ...localeFlat, // target locale overrides where it has translations
        // blogCard needs its own deep merge
        blogCard: {
          ...(enFlat.blogCard as Record<string, string>),
          ...(localeFlat.blogCard as Record<string, string> | undefined),
        },
        // actSections needs its own deep merge
        actSections: {
          ...(enFlat.actSections as Record<string, string>),
          ...(localeFlat.actSections as Record<string, string> | undefined),
        },
      };
    } catch {
      // Locale file missing entirely – fall back to English
      messages = enFlat;
    }
  }

  // ── 4. Never crash on incomplete translations ───────────────────────────────
  return {
    locale,
    messages,
    onError(error: Error & { code?: string }) {
      // In development, only surface non-MISSING_MESSAGE errors
      if (
        process.env.NODE_ENV !== 'production' &&
        error.code !== 'MISSING_MESSAGE'
      ) {
        console.error('[next-intl]', error);
      }
    },
    getMessageFallback({
      key,
      namespace,
    }: {
      key: string;
      namespace?: string;
    }) {
      // Return the dotted key path — never throw
      return namespace ? `${namespace}.${key}` : key;
    },
  };
});
