'use client';

import { useEffect } from 'react';
import { useCurrentLocale } from '@/lib/hooks/useCurrentLocale';

export default function I18nProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const actualLocale = useCurrentLocale();

  useEffect(() => {
    // 客户端全局语言上下文同步
    if (typeof document !== 'undefined') {
      document.documentElement.lang = actualLocale;
      (globalThis as any).__NEXT_INTL_LOCALE__ = actualLocale;
    }

    //  修复：永远不应该重定向到不同的语言
    // URL是唯一真实来源，Cookie不应该覆盖用户当前浏览的语言
    // 语言切换只能由用户主动点击语言按钮触发
  }, [actualLocale]);

  return <>{children}</>;
}
