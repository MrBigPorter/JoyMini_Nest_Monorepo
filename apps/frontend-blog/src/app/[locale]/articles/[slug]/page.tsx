import { getCachedArticle } from '@/lib/cached/article';
import ArticlePageClient from './page.client';
import { getOptimizedImageUrl } from '@/lib/utils/cloudflareImageLoader';
import type { Metadata } from 'next';

// Next.js 15 perfect cache pattern
// ISR: revalidate every hour, cache between requests
// Each locale has independent cache, no cross contamination
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
    const article = await getCachedArticle(slug, locale);
    if (!article) throw new Error('Article not found');

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
    // 使用缓存函数，与 generateMetadata 共享同一个 API 调用结果
    const article = await getCachedArticle(slug, locale);

    // Cloudflare Workers 免费版有 10ms CPU 限制。
    // 剥离 content/contentMd/relatedArticles/meta 大字段以减小 RSC 负载大小，
    // 避免 JSON 解析 + RSC 序列化超限。
    // 完整的文章正文由客户端通过 useFrontendArticleBySlug 异步加载。
    const initialArticle = article
      ? {
          ...article,
          content: undefined,
          contentMd: undefined,
          relatedArticles: undefined,
          meta: undefined,
        }
      : undefined;

    // ── SSR preload for LCP cover image ──────────────────────────────────
    // Extract the cover image URL from the article (it IS available during SSR
    // since only content/contentMd/relatedArticles/meta are stripped above).
    // Transform it through Cloudflare Image Resizing so the preload URL matches
    // what the browser will eventually render (via /cdn-cgi/image/...).
    //
    // Width=1200 covers desktop ~950px hero scenarios (article page prose container
    // max-width is ~800px, so 1200px generously covers both use cases).
    //
    // NOTE: Video poster URLs (meta.video.poster/posterWebp) are NOT available
    // during SSR because `meta` is stripped above to reduce RSC payload size.
    // Those are transformed client-side via `getOptimizedImageUrl` in:
    //   - HlsVideoPlayer.tsx (for hero section video posters)
    //   - ArticleMarkdown.tsx (for inline article content image/video poster)
    // See: apps/frontend-blog/src/components/blog/HlsVideoPlayer.tsx
    // See: apps/frontend-blog/src/components/blog/ArticleMarkdown.tsx
    const preloadedCoverImage = article?.coverImage
      ? getOptimizedImageUrl({
          src: article.coverImage,
          width: 1200,
          quality: 75,
        })
      : undefined;

    return (
      <>
        {/* SSR preload: inject <link rel="preload"> for the cover image.
            Next.js App Router automatically hoists <link> elements from Server
            Component JSX into the <head> during SSR, so these preload hints
            are available in the initial HTML before any client JS executes. */}
        {preloadedCoverImage && (
          <link
            rel="preload"
            as="image"
            href={preloadedCoverImage}
            fetchPriority="high"
          />
        )}
        <ArticlePageClient initialArticle={initialArticle} />
      </>
    );
  } catch (error) {
    console.error('Article page server error:', error);

    return <ArticlePageClient initialArticle={undefined} />;
  }
}
