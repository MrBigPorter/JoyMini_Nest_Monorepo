import { serverGet } from '@/lib/serverFetch';
import TagClientView from './TagClientView';
import type { FrontendTagWithArticles } from '@/lib/types/frontend-blog';

export const revalidate = 600;

export default async function TagPage({
  params,
}: {
  params: { locale: string; slug: string };
}) {
  const { locale, slug } = params;

  try {
    const data = await serverGet<FrontendTagWithArticles>(
      `/v1/frontend/blog/tags/${slug}`,
      { lang: locale, page: 1, pageSize: 10 },
    );

    return <TagClientView initialData={data} />;
  } catch (error) {
    console.error('Tag detail page server error:', error);

    return <TagClientView initialData={null} />;
  }
}
