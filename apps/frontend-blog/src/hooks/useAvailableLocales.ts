'use client';

import { useQuery } from '@tanstack/react-query';
import { blogApi } from '@/lib/api/blogApi';
import { LOCALES_METADATA, type Locale } from '@/lib/i18n/config';

interface LocaleConfig {
  code: string;
  name: string;
  nativeName: string;
  enabled: boolean;
  isDefault: boolean;
}

/**
 * 全局可用语言 Hook
 * 从系统配置API动态获取启用的语言列表
 * 通过前端API路由代理，提供更好的抽象和缓存控制
 * 整个应用共享同一个状态，自动缓存
 */
export function useAvailableLocales() {
  const { data, error, isLoading } = useQuery({
    queryKey: ['system-config', 'locales'],
    queryFn: async () => {
      try {
        // 通过 blogApi 封装层调用API
        const response = await blogApi.getEnabledLocales();
        return response.list;
      } catch (error) {
        console.warn(
          'Failed to fetch locales from API, falling back to defaults:',
          error,
        );

        // API失败时回退到共享配置中的语言
        return Object.values(LOCALES_METADATA).map((locale) => ({
          code: locale.code,
          name: locale.name,
          nativeName: locale.nativeName,
          enabled: true,
          isDefault: locale.isDefault,
        })) as LocaleConfig[];
      }
    },
    staleTime: 5 * 60 * 1000, // 5分钟缓存
    gcTime: 10 * 60 * 1000, // 10分钟垃圾回收时间
    retry: 2, // 失败时重试2次
    retryDelay: 1000, // 重试间隔1秒
  });

  const enabledLocales =
    data?.filter((locale: LocaleConfig) => locale.enabled) ?? [];

  return {
    locales: data ?? [],
    enabledLocales,
    isEnabled: (code: string) =>
      data?.find((locale: LocaleConfig) => locale.code === code)?.enabled ??
      false,
    isLoading,
    error,
  };
}
