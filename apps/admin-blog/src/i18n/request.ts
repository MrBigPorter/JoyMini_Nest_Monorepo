import { getRequestConfig } from "next-intl/server";
import { cookies } from "next/headers";
import { DEFAULT_LOCALE, AVAILABLE_LOCALES } from "@lucky/shared";
import type { Locale } from "@lucky/shared";

// ── Static imports — Turbopack compatible ─────────────────────────────────
// Dynamic import() of JSON files is not reliably supported under Turbopack.
// Using static imports + a locale map avoids the "No locale was returned from
// getRequestConfig" crash that occurs with dynamic import() under Turbopack.
import en from "./en.json";
import zh from "./zh.json";
import ja from "./ja.json";
import ko from "./ko.json";
import fr from "./fr.json";
import de from "./de.json";

const localeMap: Record<string, unknown> = { en, zh, ja, ko, fr, de };

type RawLocaleJson = {
  translations: Record<string, string>;
  blogCard?: Record<string, string>;
  systemConfig?: Record<string, unknown>;
  login?: Record<string, unknown>;
};

function flatten(raw: RawLocaleJson): Record<string, unknown> {
  return {
    ...raw.translations,
    ...(raw.blogCard ? { blogCard: raw.blogCard } : {}),
    ...(raw.systemConfig ? { systemConfig: raw.systemConfig } : {}),
    ...(raw.login ? { login: raw.login } : {}),
  };
}

export default getRequestConfig(async ({ requestLocale }) => {
  // ── 1. Resolve locale ─────────────────────────────────────────────────────
  // Priority: NEXT_LOCALE cookie > requestLocale (from next-intl routing) > DEFAULT_LOCALE
  // Note: next-intl middleware (createMiddleware) is NOT used in this project,
  // so requestLocale always returns undefined. We read NEXT_LOCALE cookie directly.
  let locale: Locale = DEFAULT_LOCALE;

  // Read NEXT_LOCALE cookie directly since no next-intl middleware exists
  try {
    const cookieStore = await cookies();
    const localeCookie = cookieStore.get("NEXT_LOCALE")?.value;
    if (localeCookie && AVAILABLE_LOCALES.includes(localeCookie as Locale)) {
      locale = localeCookie as Locale;
    }
  } catch {
    // cookies() can throw in some contexts — fall through
  }

  // Fallback to requestLocale if cookie wasn't set
  if (locale === DEFAULT_LOCALE) {
    try {
      const rl = await requestLocale;
      if (rl && AVAILABLE_LOCALES.includes(rl as Locale)) {
        locale = rl as Locale;
      }
    } catch {
      // requestLocale rejected — fall through to default
    }
  }

  // ── 2. Always load English as the baseline ─────────────────────────────────
  // Guarantees every key exists in messages. Any locale file that is incomplete
  // (missing keys) will silently show the English text — never MISSING_MESSAGE.
  const enRaw = localeMap["en"] as RawLocaleJson;
  const enFlat = flatten(enRaw);

  // ── 3. Overlay the target locale on top of the English base ────────────────
  let messages: Record<string, unknown> = enFlat;
  if (locale !== "en") {
    try {
      const localeRaw = localeMap[locale] as RawLocaleJson | undefined;
      if (localeRaw) {
        const localeFlat = flatten(localeRaw);
        messages = {
          ...enFlat, // English fills any gaps
          ...localeFlat, // target locale overrides where it has translations
          // blogCard needs its own deep merge
          blogCard: {
            ...(enFlat.blogCard as Record<string, string>),
            ...(localeFlat.blogCard as Record<string, string> | undefined),
          },
          // systemConfig needs its own deep merge (nested objects, not flat strings)
          systemConfig: {
            ...(enFlat.systemConfig as Record<string, unknown>),
            ...(localeFlat.systemConfig as Record<string, unknown> | undefined),
          },
          // login needs its own deep merge (nested objects, not flat strings)
          login: {
            ...(enFlat.login as Record<string, unknown>),
            ...(localeFlat.login as Record<string, unknown> | undefined),
          },
        };
      }
    } catch {
      // Locale file missing entirely – fall back to English
      messages = enFlat;
    }
  }

  // ── 4. Never crash on incomplete translations ───────────────────────────────
  // ⚠️  Do NOT include onError or getMessageFallback here — they are functions
  // that get serialized from Server Components to Client Components, causing
  // "Functions cannot be passed directly to Client Components" error.
  // next-intl has sensible defaults for both.
  return {
    locale,
    messages,
  };
});
