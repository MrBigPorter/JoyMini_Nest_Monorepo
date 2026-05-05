import { getRequestConfig } from 'next-intl/server';
import { cookies } from 'next/headers';
import { DEFAULT_LOCALE, AVAILABLE_LOCALES } from '@lucky/shared';
import type { Locale } from '@lucky/shared';

// ── Static imports — Turbopack compatible ─────────────────────────────────
// Dynamic import() of JSON files is not reliably supported under Turbopack.
// Using static imports + a locale map avoids the "No locale was returned from
// getRequestConfig" crash that occurs with dynamic import() under Turbopack.
import en from './en.json';
import zh from './zh.json';
import ja from './ja.json';
import ko from './ko.json';
import fr from './fr.json';
import de from './de.json';

const localeMap: Record<string, unknown> = { en, zh, ja, ko, fr, de };

type RawLocaleJson = {
  translations: Record<string, string>;
  actSections?: Record<string, string>;
  orders?: Record<string, string>;
  groups?: Record<string, string>;
  coupon?: Record<string, string>;
  ads?: Record<string, string>;
  flashSale?: Record<string, string>;
  luckyDraw?: Record<string, string>;
  notifications?: Record<string, string>;
  customerService?: Record<string, string>;
  supportChannels?: Record<string, string>;
  analytics?: Record<string, string>;
  operationLogs?: Record<string, string>;
  loginLogs?: Record<string, string>;
  finance?: Record<string, unknown>;
  paymentChannel?: Record<string, unknown>;
  adminUsers?: Record<string, unknown>;
  roles?: Record<string, unknown>;
  systemConfig?: Record<string, unknown>;
  login?: Record<string, unknown>;
};

function flatten(raw: RawLocaleJson): Record<string, unknown> {
  return {
    ...raw.translations,
    // Flatten role keys (roleSuperAdmin, roleAdmin, etc.) to top level so
    // next-intl can resolve them without requiring dot-path traversal into
    // nested adminUsers objects, which can throw MISSING_MESSAGE in raw().
    ...(raw.adminUsers
      ? Object.fromEntries(
          Object.entries(raw.adminUsers).filter(([k]) => k.startsWith('role')),
        )
      : {}),
    ...(raw.actSections ? { actSections: raw.actSections } : {}),
    ...(raw.orders ? { orders: raw.orders } : {}),
    ...(raw.groups ? { groups: raw.groups } : {}),
    ...(raw.coupon ? { coupon: raw.coupon } : {}),
    ...(raw.ads ? { ads: raw.ads } : {}),
    ...(raw.flashSale ? { flashSale: raw.flashSale } : {}),
    ...(raw.luckyDraw ? { luckyDraw: raw.luckyDraw } : {}),
    ...(raw.notifications ? { notifications: raw.notifications } : {}),
    ...(raw.customerService ? { customerService: raw.customerService } : {}),
    ...(raw.supportChannels ? { supportChannels: raw.supportChannels } : {}),
    ...(raw.analytics ? { analytics: raw.analytics } : {}),
    ...(raw.operationLogs ? { operationLogs: raw.operationLogs } : {}),
    ...(raw.loginLogs ? { loginLogs: raw.loginLogs } : {}),
    ...(raw.finance ? { finance: raw.finance } : {}),
    ...(raw.paymentChannel ? { paymentChannel: raw.paymentChannel } : {}),
    ...(raw.adminUsers ? { adminUsers: raw.adminUsers } : {}),
    ...(raw.roles ? { roles: raw.roles } : {}),
    ...(raw.systemConfig ? { systemConfig: raw.systemConfig } : {}),
    ...(raw.login ? { login: raw.login } : {}),
  };
}

export default getRequestConfig(async ({ requestLocale }) => {
  // ── 1. Resolve locale ─────────────────────────────────────────────────────
  // Priority: URL locale (from next-intl /[locale]/path routing) >
  //           app_locale cookie (set by middleware from Accept-Language,
  //             or by LanguageProvider.setLocale) >
  //           DEFAULT_LOCALE (zh)
  let locale: Locale = DEFAULT_LOCALE;

  try {
    const rl = await requestLocale;
    if (rl && AVAILABLE_LOCALES.includes(rl as Locale)) {
      locale = rl as Locale;
    }
  } catch {
    // requestLocale rejected — fall through to cookie
  }

  // Fall back to app_locale cookie.
  // Now set by middleware.ts from Accept-Language header (first visit),
  // or by LanguageProvider.setLocale() (manual switch).
  if (locale === DEFAULT_LOCALE) {
    try {
      const cookieStore = await cookies();
      const c = cookieStore.get('app_locale')?.value;
      if (c && AVAILABLE_LOCALES.includes(c as Locale)) {
        locale = c as Locale;
      }
    } catch {
      // outside request context – use default
    }
  }

  // ── 2. Always load English as the baseline ─────────────────────────────────
  // Guarantees every key exists in messages. Any locale file that is incomplete
  // (missing keys) will silently show the English text — never MISSING_MESSAGE.
  const enRaw = localeMap['en'] as RawLocaleJson;
  const enFlat = flatten(enRaw);

  // ── 3. Overlay the target locale on top of the English base ────────────────
  let messages: Record<string, unknown> = enFlat;
  if (locale !== 'en') {
    try {
      const localeRaw = localeMap[locale] as RawLocaleJson | undefined;
      if (localeRaw) {
        const localeFlat = flatten(localeRaw);
        messages = {
          ...enFlat, // English fills any gaps
          ...localeFlat, // target locale overrides where it has translations
          // actSections needs its own deep merge
          actSections: {
            ...(enFlat.actSections as Record<string, string>),
            ...(localeFlat.actSections as Record<string, string> | undefined),
          },
          // orders needs its own deep merge
          orders: {
            ...(enFlat.orders as Record<string, string>),
            ...(localeFlat.orders as Record<string, string> | undefined),
          },
          // groups needs its own deep merge
          groups: {
            ...(enFlat.groups as Record<string, string>),
            ...(localeFlat.groups as Record<string, string> | undefined),
          },
          // coupon needs its own deep merge
          coupon: {
            ...(enFlat.coupon as Record<string, string>),
            ...(localeFlat.coupon as Record<string, string> | undefined),
          },
          // ads needs its own deep merge
          ads: {
            ...(enFlat.ads as Record<string, string>),
            ...(localeFlat.ads as Record<string, string> | undefined),
          },
          // flashSale needs its own deep merge
          flashSale: {
            ...(enFlat.flashSale as Record<string, string>),
            ...(localeFlat.flashSale as Record<string, string> | undefined),
          },
          // luckyDraw needs its own deep merge
          luckyDraw: {
            ...(enFlat.luckyDraw as Record<string, string>),
            ...(localeFlat.luckyDraw as Record<string, string> | undefined),
          },
          // notifications needs its own deep merge
          notifications: {
            ...(enFlat.notifications as Record<string, string>),
            ...(localeFlat.notifications as Record<string, string> | undefined),
          },
          // customerService needs its own deep merge
          customerService: {
            ...(enFlat.customerService as Record<string, string>),
            ...(localeFlat.customerService as
              | Record<string, string>
              | undefined),
          },
          // supportChannels needs its own deep merge
          supportChannels: {
            ...(enFlat.supportChannels as Record<string, string>),
            ...(localeFlat.supportChannels as
              | Record<string, string>
              | undefined),
          },
          // analytics needs its own deep merge
          analytics: {
            ...(enFlat.analytics as Record<string, string>),
            ...(localeFlat.analytics as Record<string, string> | undefined),
          },
          // operationLogs needs its own deep merge
          operationLogs: {
            ...(enFlat.operationLogs as Record<string, string>),
            ...(localeFlat.operationLogs as Record<string, string> | undefined),
          },
          // loginLogs needs its own deep merge
          loginLogs: {
            ...(enFlat.loginLogs as Record<string, string>),
            ...(localeFlat.loginLogs as Record<string, string> | undefined),
          },
          // finance needs its own deep merge (nested objects, not flat strings)
          finance: {
            ...(enFlat.finance as Record<string, unknown>),
            ...(localeFlat.finance as Record<string, unknown> | undefined),
          },
          // paymentChannel needs its own deep merge (nested objects, not flat strings)
          paymentChannel: {
            ...(enFlat.paymentChannel as Record<string, unknown>),
            ...(localeFlat.paymentChannel as
              | Record<string, unknown>
              | undefined),
          },
          // adminUsers needs its own deep merge (nested objects, not flat strings)
          adminUsers: {
            ...(enFlat.adminUsers as Record<string, unknown>),
            ...(localeFlat.adminUsers as Record<string, unknown> | undefined),
          },
          // roles needs its own deep merge (nested objects, not flat strings)
          roles: {
            ...(enFlat.roles as Record<string, unknown>),
            ...(localeFlat.roles as Record<string, unknown> | undefined),
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
