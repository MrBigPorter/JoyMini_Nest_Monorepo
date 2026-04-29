import { serverGet } from '@/lib/serverFetch';
import ArticlePageClient from './page.client';
import type { Metadata } from 'next';
import type { FrontendArticle } from '@/lib/types/frontend-blog';

// Next.js 15 perfect cache pattern
// force-dynamic + revalidate combination
// Each locale has independent cache, no cross contamination
export const dynamic = 'auto';
export const revalidate = 3600; // 1 hour cache for articles

// 不预生成任何文章页，运行时按需 ISR
export async function generateStaticParams() {
  return [];
}

export async function generateHeaders() {
  return {
    'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400',
  };
}

/**
 * 生成文章页面的动态metadata
 * 包含文章标题、描述、Open Graph、Twitter Cards等
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}): Promise<Metadata> {
  const { locale, slug } = await params;
  const baseUrl =
    process.env.NEXT_PUBLIC_SITE_URL || 'https://blog.joyminis.com';

  try {
    const article = await serverGet<FrontendArticle>(
      `/v1/frontend/blog/articles/${slug}`,
      { lang: locale },
    );

    // 构建文章描述
    const description =
      article.excerpt ||
      (article.content
        ? article.content.substring(0, 160) + '...'
        : 'Read this article on Tarsier Labs');

    // 构建关键词
    const keywords = [
      ...(article.tags?.map((tag) => tag.name) || []),
      'technology',
      'software development',
      'AI',
      'Bohol',
      'Philippines',
    ];

    return {
      title: article.title,
      description,
      keywords,

      // Open Graph
      openGraph: {
        type: 'article',
        title: article.title,
        description,
        publishedTime: article.publishedAt,
        modifiedTime: article.updatedAt,
        authors: [article.author?.name || 'Tarsier Labs'],
        tags: article.tags?.map((tag) => tag.name) || [],
        images: article.coverImage
          ? [
              {
                url: article.coverImage,
                width: 1200,
                height: 630,
                alt: article.title,
              },
            ]
          : [],
      },

      // Twitter
      twitter: {
        card: 'summary_large_image',
        title: article.title,
        description,
        images: article.coverImage ? [article.coverImage] : [],
      },

      // 规范URL
      alternates: {
        canonical: `${baseUrl}/${locale}/articles/${slug}`,
      },

      // 其他meta
      robots: {
        index: true,
        follow: true,
      },
    };
  } catch (error) {
    console.error('Failed to generate metadata for article:', error);

    // 降级方案：返回基础metadata
    return {
      title: 'Article Not Found',
      description: 'The requested article could not be found.',
      robots: {
        index: false,
        follow: false,
      },
    };
  }
}

export default async function ArticlePage({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale: routeLocale, slug } = await params;
  const locale = routeLocale;

  try {
    // 简化架构：直接API调用，避免复杂平台感知抽象
    const article = await serverGet<FrontendArticle>(
      `/v1/frontend/blog/articles/${slug}`,
      { lang: locale },
    );

    return <ArticlePageClient initialArticle={article} />;
  } catch (error) {
    console.error('Article page server error:', error);

    return <ArticlePageClient initialArticle={undefined} />;
  }
}
