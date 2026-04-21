import CategoryClientView from './CategoryClientView';

// 静态导出支持：返回空数组，不预生成任何页面
import { getEnabledLocales } from '@/lib/i18n/config';
import type { Locale } from '@/lib/i18n/config';

export async function generateStaticParams() {
  return getEnabledLocales().flatMap((locale: Locale) => [
    { locale, slug: '_' },
  ]);
}

export const dynamic = 'force-static';

interface CategoryPageProps {
  params: {
    slug: string;
  };
}

export default function CategoryPage({ params }: CategoryPageProps) {
  return <CategoryClientView params={params} />;
}
