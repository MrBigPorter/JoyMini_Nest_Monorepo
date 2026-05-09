'use client';

import { useEffect, useRef } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useCurrentLocale } from '@/lib/hooks/useCurrentLocale';
import { LOCALES, DEFAULT_LOCALE } from '@/lib/i18n/config';

export default function I18nProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const actualLocale = useCurrentLocale();
  const pathname = usePathname();
  const router = useRouter();
  const hasRunLocaleDetection = useRef(false);

  // Effect 1: 浏览器语言检测 — 仅在首次挂载时运行一次
  // 目的：避免 router.push() 在导航过渡中触发二次导航，与 AnimatePresence 产生竞态
  useEffect(() => {
    if (typeof document === 'undefined') return;
    if (hasRunLocaleDetection.current) return;
    hasRunLocaleDetection.current = true;

    // 1. 如果用户已有 NEXT_LOCALE cookie（手动选择过语言），跳过浏览器检测
    //    这确保用户手动切换语言后不会被浏览器语言覆盖
    const hasUserCookie = document.cookie.match(
      new RegExp('(^| )NEXT_LOCALE=([^;]+)'),
    );
    if (hasUserCookie) return;

    // 2. 如果当前 URL 语言不是默认语言，说明用户主动导航到了这个语言，也跳过检测
    if (actualLocale !== DEFAULT_LOCALE) return;

    // 3. 只有首次访问（无 cookie、在默认语言）才做浏览器语言检测
    //    从 navigator.language 提取主语言代码（'en-US' → 'en'）
    const browserLang = navigator.language.split('-')[0].toLowerCase();

    // 只在浏览器语言在支持列表中且与当前语言不同时才跳转
    if (!browserLang || browserLang === actualLocale) return;
    if (!(LOCALES as readonly string[]).includes(browserLang)) return;

    // 4. 设置 NEXT_LOCALE cookie，后续请求服务端就能直接识别
    const expires = new Date(
      Date.now() + 365 * 24 * 60 * 60 * 1000,
    ).toUTCString();
    document.cookie = `NEXT_LOCALE=${browserLang}; path=/; expires=${expires}; SameSite=Lax`;

    // 5. 使用 router.push() 替代 window.location.href
    //    原因：硬跳转会销毁整个 React 树，导致白屏闪烁。
    //    router.push() 保持 React 树存活，
    //    HomePageClient 的 <Suspense fallback={<HomePageSkeleton />}>
    //    会在新页面 RSC 加载过程中自然显示 skeleton，提升首次访问体验。
    //    Cookie 已在上一步设置，RSC fetch 请求会自动携带，服务端正确识别。
    const newPathname = pathname.replace(`/${actualLocale}`, `/${browserLang}`);
    console.log(
      `[I18nProvider] Client-side locale redirect: ${actualLocale} → ${browserLang}`,
    );
    router.push(newPathname);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // 空 deps — 仅在 mount 时执行，避免导航过程中触发

  // Effect 2: 语言同步到 HTML — 随 locale 变化更新
  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.documentElement.lang = actualLocale;
    (globalThis as any).__NEXT_INTL_LOCALE__ = actualLocale;
  }, [actualLocale]);

  return <>{children}</>;
}
