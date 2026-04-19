'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { detectLocale, removeLocaleFromPath } from '@/lib/utils/locale';

export default function I18nProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const routerLocale = useLocale();
  const t = useTranslations();
  const router = useRouter();

  //  终极语言同步：Cookie是用户意图的唯一可信来源
  const actualLocale = detectLocale();

  useEffect(() => {
    //【客户端】 全局语言上下文同步
    if (typeof document !== 'undefined') {
      document.documentElement.lang = actualLocale;
      (globalThis as any).__NEXT_INTL_LOCALE__ = actualLocale;
    }

    //  语言状态一致性保证
    // 当Cookie和当前路由语言不一致时，立即同步路径
    // 解决路由异步跳转期间静态文本语言不更新的问题
    if (actualLocale !== routerLocale && typeof window !== 'undefined') {
      const cleanPath = removeLocaleFromPath(window.location.pathname);
      router.replace(`/${actualLocale}${cleanPath}`, { scroll: false });
    }
  }, [actualLocale, routerLocale, router]);

  return <>{children}</>;
}
