import { frontendBlogApi } from '@/lib/api/frontendBlogApi';
import { getEnabledLocales } from '@/lib/i18n/config';
import TagsPageClient from './page.client';
import type { Locale } from '@/lib/i18n/config';

// Next.js 15 perfect cache pattern
// revalidate combination
// Each locale has independent cache, no cross contamination
export const revalidate = 3600;
export const dynamic = 'auto';

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
  // 简化架构：直接API调用，避免复杂平台感知抽象
  const tags = await frontendBlogApi.getTags(params.locale);

  return <TagsPageClient initialTags={tags} />;
}
