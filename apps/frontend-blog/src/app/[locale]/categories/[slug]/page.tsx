import { serverGet } from '@/lib/serverFetch';
import CategoryClientView from './CategoryClientView';
import { SITE_URL } from '@/lib/constants/site';
import type { FrontendCategoryWithArticles } from '@/lib/types/frontend-blog';
import type { Metadata } from 'next';
import { getEnabledLocales, type Locale } from '@/lib/i18n/config';

export const revalidate = 600;

/**
 * 生成分类详情页 SEO metadata
 * 包含 canonical URL + hreflang 多语言标记
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}): Promise<Metadata> {
  const { locale, slug } = await params;
  const baseUrl = SITE_URL;

  return {
    alternates: {
      canonical: `${baseUrl}/${locale}/categories/${slug}`,
      languages: Object.fromEntries(
        getEnabledLocales()
          .filter((l: Locale) => l !== locale)
          .map((l: Locale) => [l, `${baseUrl}/${l}/categories/${slug}`]),
      ),
    },
    robots: {
      index: true,
      follow: true,
    },
  };
}

export default async function CategoryPage({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale, slug } = await params;

  try {
    const data = await serverGet<FrontendCategoryWithArticles>(
      `/v1/frontend/blog/categories/${slug}`,
      { lang: locale, page: 1, pageSize: 10 },
    );

    return <CategoryClientView initialData={data} />;
  } catch (error) {
    console.error('Category detail page server error:', error);

    return <CategoryClientView initialData={null} />;
  }
}
