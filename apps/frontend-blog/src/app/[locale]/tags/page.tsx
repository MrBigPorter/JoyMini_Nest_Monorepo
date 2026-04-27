import { serverGet } from '@/lib/serverFetch';
import { getEnabledLocales } from '@/lib/i18n/config';
import TagsPageClient from './page.client';
import type { Locale } from '@/lib/i18n/config';
import type { FrontendTag } from '@/lib/types/frontend-blog';

// Next.js 15 perfect cache pattern
// revalidate combination
// Each locale has independent cache, no cross contamination
export const revalidate = 3600;
export const dynamic = 'force-static';

// generate static params for all locales
export async function generateStaticParams() {
  return getEnabledLocales().map((locale: Locale) => ({ locale }));
}

interface TagsPageProps {
  params: {
    locale: string;
  };
}

export default async function TagsPage({ params }: TagsPageProps) {
  let tags: FrontendTag[] = [];

  try {
    // 简化架构：直接API调用，避免复杂平台感知抽象
    tags = await serverGet<FrontendTag[]>('/v1/frontend/blog/tags', { lang: params.locale });
  } catch (error) {
    console.error('Tags page server error:', error);
  }

  return <TagsPageClient initialTags={tags} />;
}
