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
    }
  }, [currentLocale, t]);

  return <>{children}</>;
}
