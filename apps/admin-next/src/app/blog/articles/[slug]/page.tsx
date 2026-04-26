import { notFound } from 'next/navigation';
import { cookies } from 'next/headers';
import { blogApi } from '@/api';
import BlogArticleContent from './BlogArticleContent';

interface Props {
  params: Promise<{ slug: string }>;
}

export default async function BlogArticlePage({ params }: Props) {
  const { slug } = await params;

  // 从 httpOnly cookie 中读取 auth_token，SSR 时传给后端 API
  const cookieStore = await cookies();
  const token = cookieStore.get('auth_token')?.value;

  let article;
  try {
    article = await blogApi.getArticleBySlug(slug, token);
  } catch (error) {
    console.error('Failed to fetch article:', error);
    notFound();
  }

  if (!article) {
    notFound();
  }

  return <BlogArticleContent article={article} />;
}
