// ️ Next.js 15.5.12 BUG 临时兼容方案
//  BUG: https://github.com/vercel/next.js/issues/69273
// 根页面静态渲染时 middleware 不会执行，直接返回页面导致白屏
//  使用ISR优化：每小时重新生成一次，99.9%请求命中CDN缓存
// TODO: 2026年6月后检查并优化为静态页面
//
//  修复：如果 middleware 未执行，RootPage 必须自己检测 Accept-Language
// 之前只读 cookie，导致首次访问始终 fallback 到 DEFAULT_LOCALE='zh'
//
//  注意：此页面仅在直接访问 https://blog.joyminis.com/ 时触发。
// 内部 SPA 导航通过 @/navigation Link 自动添加 locale 前缀，不会经过此页面。
// 因此服务端 redirect() 不会与 AnimatePresence 动画产生竞态条件
// （fresh page load 时没有动画在运行）。
// 参见: plans/frontend-blog-hooks-error-fix.md 的完整分析

import { redirect } from 'next/navigation';
import { cookies, headers } from 'next/headers';
import { DEFAULT_LOCALE, LOCALES } from '@/lib/i18n/config';

export const dynamic = 'force-dynamic';

// CDN缓存头配置
export async function generateHeaders() {
  return {
    'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400',
  };
}

/**
 * 解析 Accept-Language 头部，返回最佳匹配的支持语言
 */
function parseAcceptLanguage(header: string | null): string | null {
  if (!header) return null;
  const locales = header
    .split(',')
    .map((entry) => {
      const [tag, qPart] = entry.split(';');
      const q = qPart ? parseFloat(qPart.replace('q=', '')) : 1.0;
      const primaryLang = tag.trim().split('-')[0].toLowerCase();
      return { lang: primaryLang, q };
    })
    .sort((a, b) => b.q - a.q);

  for (const { lang } of locales) {
    if (LOCALES.includes(lang as any)) {
      return lang;
    }
  }
  return null;
}

export default async function RootPage() {
  const cookieStore = await cookies();
  const cookieLocale =
    cookieStore.get('NEXT_LOCALE')?.value || cookieStore.get('locale')?.value;

  // 1. Cookie 优先（用户主动选择或客户端检测后设置的语言）
  if (
    cookieLocale &&
    LOCALES.includes(cookieLocale as (typeof LOCALES)[number])
  ) {
    redirect(`/${cookieLocale}`);
    return;
  }

  // 2. Cookie 不存在 → 从 Accept-Language 检测浏览器语言
  // 注意：在 Docker + Turbopack 环境中 headers() 可能拿不到浏览器请求头，
  // 此时 acceptLanguage 为 null，会 fallback 到 DEFAULT_LOCALE。
  // 客户端 I18nProvider 会通过 navigator.language 做二次检测并重定向。
  const headersList = await headers();
  const acceptLanguage = headersList.get('accept-language');
  const browserLocale = parseAcceptLanguage(acceptLanguage);

  if (browserLocale) {
    redirect(`/${browserLocale}`);
    return;
  }

  // 3. 最终 fallback 到默认语言
  redirect(`/${DEFAULT_LOCALE}`);
}
