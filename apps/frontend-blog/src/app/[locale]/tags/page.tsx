import { getPlatformTags } from '@/lib/platform/services/data.service';
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
  const tags = await getPlatformTags(params.locale);

  return <TagsPageClient initialTags={tags} />;
}
