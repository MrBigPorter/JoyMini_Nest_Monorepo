import { getTranslations } from 'next-intl/server';
import { getPlatformArticle } from '@/lib/platform/services/data.service';
import { ArticleDetailSkeleton } from '@/lib/components/SkeletonLoader';
import ArticlePageClient from './page.client';

// Next.js 15 perfect cache pattern
// force-dynamic + revalidate combination
// Each locale has independent cache, no cross contamination
export const dynamic = 'force-dynamic';
export const revalidate = 3600; // 1 hour cache for articles

export async function generateHeaders() {
  return {
    'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400',
  };
}

export default async function ArticlePage({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale: routeLocale, slug } = await params;
  const locale = routeLocale;

  const t = await getTranslations({ locale });

  try {
    const article = await getPlatformArticle(slug, locale);

    return (
      <ArticlePageClient initialData={article} locale={locale} slug={slug} />
    );
  } catch (error) {
    console.error('Article page server error:', error);

    return <ArticlePageClient initialData={null} locale={locale} slug={slug} />;
  }
}
