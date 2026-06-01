import { serverGet } from '@/lib/serverFetch';
import { getEnabledLocales } from '@/lib/i18n/config';
import TagsPageClient from './page.client';
import { SITE_URL } from '@/lib/constants/site';
import type { Locale } from '@/lib/i18n/config';
import type { FrontendTag } from '@/lib/types/frontend-blog';
import type { Metadata } from 'next';

// Next.js 15 perfect cache pattern
// revalidate combination
// Each locale has independent cache, no cross contamination
export const revalidate = 3600;

// generate static params for all locales
export async function generateStaticParams() {
  return getEnabledLocales().map((locale: Locale) => ({ locale }));
}

/**
 * 生成标签列表页 SEO metadata
 * 包含 canonical URL + hreflang 多语言标记
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const baseUrl = SITE_URL;

  return {
    alternates: {
      canonical: `${baseUrl}/${locale}/tags`,
      languages: Object.fromEntries(
        getEnabledLocales()
          .filter((l: Locale) => l !== locale)
          .map((l: Locale) => [l, `${baseUrl}/${l}/tags`]),
      ),
    },
  };
}

interface TagsPageProps {
  params: Promise<{ locale: string }>;
}

export default async function TagsPage({ params }: TagsPageProps) {
  const { locale } = await params;
  let tags: FrontendTag[] = [];

  try {
    // 简化架构：直接API调用，避免复杂平台感知抽象
    tags = await serverGet<FrontendTag[]>('/v1/frontend/blog/tags', {
      lang: locale,
    });
  } catch (error) {
    console.error('Tags page server error:', error);
  }

  return <TagsPageClient initialTags={tags} />;
}
