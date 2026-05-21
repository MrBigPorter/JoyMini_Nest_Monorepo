import { serverGet } from '@/lib/serverFetch';
import { getEnabledLocales } from '@/lib/i18n/config';
import CategoriesPageClient from './page.client';
import type { FrontendCategory } from '@/lib/types/frontend-blog';
import type { Locale } from '@/lib/i18n/config';
import type { Metadata } from 'next';

// Next.js 15 perfect cache pattern
// revalidate combination
// Each locale has independent cache, no cross contamination
export const revalidate = 600;

// generate static params for all locales
export async function generateStaticParams() {
  return getEnabledLocales().map((locale: Locale) => ({ locale }));
}

/**
 * 生成分类列表页 SEO metadata
 * 包含 canonical URL + hreflang 多语言标记
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const baseUrl =
    process.env.NEXT_PUBLIC_SITE_URL || 'https://blog.joyminis.com';

  return {
    alternates: {
      canonical: `${baseUrl}/${locale}/categories`,
      languages: Object.fromEntries(
        getEnabledLocales()
          .filter((l: Locale) => l !== locale)
          .map((l: Locale) => [l, `${baseUrl}/${l}/categories`]),
      ),
    },
  };
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
  const { locale } = await params;

  try {
    // SSG: Fetch categories at build time via serverFetch (uses INTERNAL_API_URL)
    const initialData = await serverGet<FrontendCategory[]>(
      '/v1/frontend/blog/categories',
      { lang: locale },
    );
    console.log('initialData,initialData', initialData);

    return <CategoriesPageClient initialData={initialData} />;
  } catch (error) {
    console.error(
      '[CategoriesPage] SSG fetch failed, falling back to client fetch:',
      error,
    );
    // Fallback: empty array, client-side useFrontendCategories() will refetch
    return <CategoriesPageClient initialData={[]} />;
  }
}
