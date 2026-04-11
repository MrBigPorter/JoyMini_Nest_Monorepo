'use client';

import { useRequest } from 'ahooks';
import { systemConfigApi } from '@/api';
import { AVAILABLE_LOCALES, type Locale } from '@lucky/shared';

interface LocaleConfig {
  code: Locale;
  name: string;
  nativeName: string;
  enabled: boolean;
}

const LOCALE_METADATA: Record<Locale, { name: string; nativeName: string }> = {
  zh: { name: '中文', nativeName: '简体中文' },
  en: { name: 'English', nativeName: 'English' },
  ja: { name: '日本語', nativeName: '日本語' },
  ko: { name: '한국어', nativeName: '한국어' },
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
        const result = await systemConfigApi.getAll();
        const config = result.list.find(
          (item) => item.key === 'enabled_locales',
        );

        if (config) {
          let enabledLocales: Locale[] = [];
          try {
            // 首先尝试 JSON 格式解析
            enabledLocales = JSON.parse(config.value) as Locale[];
          } catch {
            // 解析失败则尝试逗号分隔格式
            enabledLocales = config.value
              .split(',')
              .map((s) => s.trim() as Locale);
          }

          return AVAILABLE_LOCALES.map((code) => ({
            code,
            ...LOCALE_METADATA[code],
            enabled: enabledLocales.includes(code),
          })) as LocaleConfig[];
        }
      } catch {
        // ignore
      }
      // 默认启用中英文
      return AVAILABLE_LOCALES.map((code) => ({
        code,
        ...LOCALE_METADATA[code],
        enabled: code === 'zh' || code === 'en',
      })) as LocaleConfig[];
    },
    {
      refreshOnWindowFocus: false,
      cacheKey: 'system/config/enabled_locales',
    },
  );

  async function toggleLocale(code: Locale) {
    if (!data) return;

    const updatedLocales = data.map((l) =>
      l.code === code ? { ...l, enabled: !l.enabled } : l,
    );

    // 乐观更新
    mutate(updatedLocales);

    try {
      const enabledCodes = updatedLocales
        .filter((l) => l.enabled)
        .map((l) => l.code);
      await systemConfigApi.update(
        'enabled_locales',
        JSON.stringify(enabledCodes),
      );
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
