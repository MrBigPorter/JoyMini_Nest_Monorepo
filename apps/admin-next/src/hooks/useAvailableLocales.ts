'use client';

import { useRequest } from 'ahooks';
import { systemConfigApi } from '@/api';
import { AVAILABLE_LOCALES, type Locale } from '@lucky/shared';

interface LocaleConfig {
  code: Locale;
  name: string;
  nativeName: string;
  enabled: boolean;
  isDefault: boolean;
}

const LOCALE_METADATA: Record<Locale, { name: string; nativeName: string }> = {
  zh: { name: '中文', nativeName: 'Chinese' },
  en: { name: 'English', nativeName: 'English' },
  ja: { name: '日本語', nativeName: 'Japanese' },
  ko: { name: '한국어', nativeName: 'Korean' },
  fr: { name: 'Français', nativeName: 'Français' },
  de: { name: 'Deutsch', nativeName: 'Deutsch' },
};

/**
 * 全局唯一可用语言 Hook
 * 整个系统所有组件共享同一个状态
 * 自动缓存，实时更新
 */
export function useAvailableLocales() {
  const { data, error, mutate } = useRequest(
    async () => {
      try {
        const result = await systemConfigApi.getLocales();

        return result.list.map((item) => ({
          code: item.code as Locale,
          ...LOCALE_METADATA[item.code as Locale],
          enabled: item.enabled,
          isDefault: item.isDefault,
        })) as LocaleConfig[];
      } catch {
        // ignore
      }

      // 默认启用中英文
      return AVAILABLE_LOCALES.map((code) => ({
        code,
        ...LOCALE_METADATA[code],
        enabled: code === 'zh' || code === 'en',
        isDefault: code === 'zh',
      })) as LocaleConfig[];
    },
    {
      refreshOnWindowFocus: false,
      cacheKey: 'system/config/locales',
    },
  );

  async function toggleLocale(code: Locale) {
    if (!data) return;

    const locale = data.find((l) => l.code === code);
    if (!locale || locale.isDefault) return; // 默认语言不可切换

    const updatedLocales = data.map((l) =>
      l.code === code ? { ...l, enabled: !l.enabled } : l,
    );

    // 乐观更新
    mutate(updatedLocales);

    try {
      await systemConfigApi.toggleLocale(code, !locale.enabled);
    } catch {
      // 失败回滚
      mutate();
    }
  }

  return {
    locales: data ?? [],
    enabledLocales: data?.filter((l: LocaleConfig) => l.enabled) ?? [],
    isEnabled: (code: Locale) =>
      data?.find((l: LocaleConfig) => l.code === code)?.enabled ?? false,
    toggleLocale,
    loading: !error && !data,
    error,
  };
}
