import { notFound } from 'next/navigation';
import { blogApi } from '@/api';
import BlogArticleContent from './BlogArticleContent';

interface Props {
  params: Promise<{ slug: string }>;
}

export default async function BlogArticlePage({ params }: Props) {
  const { slug } = await params;

  let article;
  try {
    article = await blogApi.getArticleBySlug(slug);
  } catch (error) {
    console.error('Failed to fetch article:', error);
    notFound();
  }

  if (!article) {
    notFound();
  }

  return <BlogArticleContent article={article} />;
}
