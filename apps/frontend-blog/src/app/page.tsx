// ️ Next.js 15.5.12 BUG 临时兼容方案
//  BUG: https://github.com/vercel/next.js/issues/69273
// 根页面静态渲染时 middleware 不会执行，直接返回页面导致白屏
//  使用ISR优化：每小时重新生成一次，99.9%请求命中CDN缓存
// TODO: 2026年6月后检查并优化为静态页面

import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { DEFAULT_LOCALE, LOCALES } from '@/lib/i18n/config';

export const dynamic = 'force-dynamic';

//  ISR 配置：每小时重新生成一次
// 实际上几乎和静态页面一样快，服务器成本接近0
export const revalidate = 3600;

// CDN缓存头配置
export async function generateHeaders() {
  return {
    'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400',
  };
}

export default async function RootPage() {
  const cookieStore = await cookies();
  const cookieLocale =
    cookieStore.get('NEXT_LOCALE')?.value || cookieStore.get('locale')?.value;

  const locale =
    cookieLocale && LOCALES.includes(cookieLocale as (typeof LOCALES)[number])
      ? cookieLocale
      : DEFAULT_LOCALE;

  redirect(`/${locale}`);
}
