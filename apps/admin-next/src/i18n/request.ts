import { getRequestConfig } from 'next-intl/server';
import { cookies } from 'next/headers';
import { DEFAULT_LOCALE, AVAILABLE_LOCALES } from '@lucky/shared';
import type { Locale } from '@lucky/shared';

export default getRequestConfig(async () => {
  // Read locale from cookie (same key used by the existing LanguageProvider)
  let locale: Locale = DEFAULT_LOCALE;
  try {
    const cookieStore = await cookies();
    const c = cookieStore.get('app_locale')?.value;
    if (c && AVAILABLE_LOCALES.includes(c as Locale)) {
      locale = c as Locale;
    }
  } catch {
    // ignore – e.g. when called outside of a request context
  }

  // Dynamic import so bundler can split locale files.
  // JSON shape: { translations: {...}, blogCard: {...} }
  // We merge them into a flat messages object so next-intl can serve both.
  const raw = (await import(`./${locale}.json`)) as {
    default: { translations: Record<string, string>; blogCard?: Record<string, string> };
  };

  const messages: Record<string, unknown> = {
    ...raw.default.translations,
    ...(raw.default.blogCard ? { blogCard: raw.default.blogCard } : {}),
  };

  return { locale, messages };
});

