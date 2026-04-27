import { frontendBlogApi } from '@/lib/api/frontendBlogApi';
import { getEnabledLocales } from '@/lib/i18n/config';
import CategoriesPageClient from './page.client';
import type { Locale } from '@/lib/i18n/config';

// Next.js 15 perfect cache pattern
// revalidate combination
// Each locale has independent cache, no cross contamination
export const revalidate = 600;
export const dynamic = 'force-static';

// generate static params for all locales
export async function generateStaticParams() {
  return getEnabledLocales().map((locale: Locale) => ({ locale }));
}

// cloudflare cache headers
export async function generateHeaders() {
  return {
    'Cache-Control': 'public, s-maxage=600, stale-while-revalidate=3600',
  };
}

export default async function CategoriesPage({
  params,
}: {
  params: { locale: string };
}) {
  const { locale: routeLocale } = params;
  const locale = routeLocale;

  try {
    // 简化架构：直接API调用，避免复杂平台感知抽象
    const categories = await frontendBlogApi.getCategories(locale);

    return <CategoriesPageClient initialData={categories} />;
  } catch (error) {
    console.error('Categories page server error:', error);

    return <CategoriesPageClient initialData={[]} />;
  }
}
