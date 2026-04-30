import { serverGet } from '@/lib/serverFetch';
import CategoryClientView from './CategoryClientView';
import type { FrontendCategoryWithArticles } from '@/lib/types/frontend-blog';

export const revalidate = 600;

export default async function CategoryPage({
  params,
}: {
  params: { locale: string; slug: string };
}) {
  const { locale, slug } = params;

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
