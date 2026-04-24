import { getRequestConfig } from 'next-intl/server';
import { cookies } from 'next/headers';
import { DEFAULT_LOCALE, AVAILABLE_LOCALES } from '@lucky/shared';
import type { Locale } from '@lucky/shared';

type RawLocaleJson = {
  translations: Record<string, string>;
  blogCard?: Record<string, string>;
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
    ...(raw.blogCard ? { blogCard: raw.blogCard } : {}),
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
          ...(localeFlat.customerService as Record<string, string> | undefined),
        },
        // supportChannels needs its own deep merge
        supportChannels: {
          ...(enFlat.supportChannels as Record<string, string>),
          ...(localeFlat.supportChannels as Record<string, string> | undefined),
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
          ...(localeFlat.paymentChannel as Record<string, unknown> | undefined),
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
