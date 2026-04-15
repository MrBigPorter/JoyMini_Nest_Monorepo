'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useEffect } from 'react';

export default function I18nProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const currentLocale = useLocale();
  const t = useTranslations();

  useEffect(() => {
    // ✅ 【客户端】 全局语言上下文变化
    console.log(
      `\n🟢 [CLIENT] I18nProvider 检测到语言变化 locale =`,
      currentLocale,
    );
    console.log(`🟢 [CLIENT] 翻译测试 common.home =`, t('common.home'));

    if (typeof document !== 'undefined') {
      document.documentElement.lang = currentLocale;
      // 设置全局变量，供HTTP客户端在SSR环境下读取
      // 注意：在客户端环境下，HTTP客户端会优先从URL路径或cookie读取
      // 但在某些SSR场景下，全局变量是唯一可用的方式
      (globalThis as any).__NEXT_INTL_LOCALE__ = currentLocale;

      // 同时更新localStorage，供HTTP客户端在客户端环境下读取
      // next-intl v3 RC版本可能使用不同的存储方式，我们同时设置多个可能的键
      try {
        localStorage.setItem('NEXT_LOCALE', currentLocale);
        // 有些版本可能存储为JSON对象
        localStorage.setItem(
          'next-intl',
          JSON.stringify({ locale: currentLocale }),
        );
      } catch (error) {
        // localStorage可能不可用（如SSR环境或隐私模式）
        console.warn('Failed to update localStorage with locale:', error);
      }
    }
  }, [currentLocale, t]);

  return <>{children}</>;
}
