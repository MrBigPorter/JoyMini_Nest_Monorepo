import { getCachedArticle } from '@/lib/cached/article';
import ArticlePageClient from './page.client';
import { getOptimizedImageUrl } from '@/lib/utils/cloudflareImageLoader';
import { generateArticleSchema } from '@/lib/seo/schema';
import type { Metadata } from 'next';
import { getEnabledLocales, type Locale } from '@/lib/i18n/config';

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
          : [
              {
                url: '/og-image.png',
                width: 1200,
                height: 630,
                alt: 'Tarsier Labs',
              },
            ],
      },

      // Twitter
      twitter: {
        card: 'summary_large_image',
        title: article.title,
        description,
        images: article.coverImage ? [article.coverImage] : ['/og-image.png'],
      },

      // 规范URL + hreflang 多语言标记
      // 告诉 Google 不同语言版本是翻译关系，而非重复内容
      // 这将解决 "Crawled - currently not indexed" 的跨语言重复判定问题
      alternates: {
        canonical: `${baseUrl}/${locale}/articles/${slug}`,
        languages: Object.fromEntries(
          getEnabledLocales()
            .filter((l: Locale) => l !== locale)
            .map((l: Locale) => [l, `${baseUrl}/${l}/articles/${slug}`]),
        ),
      },

      // 其他meta
      robots: {
        index: true,
        follow: true,
      },
    };
  } catch (error) {
    console.error('Failed to generate metadata for article:', error);

    // 降级方案：API可能因重启/网络抖动短暂超时，不影响SEO索引
    // 保持 index:true 防止临时故障导致 Google 永久排除页面
    return {
      title: 'Article Not Found',
      description: 'The requested article could not be found.',
      robots: {
        index: true,
        follow: true,
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
    // 剥离 content/contentMd/relatedArticles 大字段以减小 RSC 负载大小，
    // 避免 JSON 解析 + RSC 序列化超限。
    // meta 保留（仅含视频 URL/poster，通常 <5KB）以便 detail page 初始渲染时
    // 即可展示 coverImage video 和 contentVideo HLS 播放器。
    // 完整的文章正文由客户端通过 useFrontendArticleBySlug 异步加载。
    const initialArticle = article
      ? {
          ...article,
          content: undefined,
          contentMd: undefined,
          relatedArticles: undefined,
        }
      : undefined;

    // ── SSR preload for LCP cover image ──────────────────────────────────
    // Extract the cover image URL from the article (it IS available during SSR
    // since only content/contentMd/relatedArticles/meta are stripped above).
    // Transform it through Cloudflare Image Resizing so the preload URL matches
    // what the browser will eventually render (via /cdn-cgi/image/...).
    //
    // ⚠️ CRITICAL: preload width MUST match the rendered width. The article
    // content renders images through two paths:
    //   1. HTML path (Quill editor): transformMediaUrls() → 1200px
    //   2. Markdown path (contentMd): custom <img> → getOptimizedImageUrl(1200px)
    // Both now use getOptimizedImageUrl at 1200px width (since Fix C2 below).
    // 1200px covers PC desktop ~800px prose container + 1.5x HiDPI scaling.
    //
    // If preload width ≠ rendered width → cache miss → no benefit.
    //
    // ── SSR preload for video poster (if article has a hero video) ────────
    // `meta` is NOT stripped above (only content/contentMd/relatedArticles are),
    // so article.meta?.video?.poster is available during SSR.
    // Transform it through Cloudflare Image Resizing so the preload URL matches
    // what HlsVideoPlayer will render.
    const preloadedCoverImage = article?.coverImage
      ? getOptimizedImageUrl({
          src: article.coverImage,
          width: 1200,
          quality: 75,
        })
      : undefined;

    // Extract video poster from article meta. `meta` is retained in initialArticle
    // (only content/contentMd/relatedArticles are stripped), so video poster URL
    // is available during SSR.
    const videoPoster = article?.meta?.video?.poster;
    const preloadedVideoPoster = videoPoster
      ? getOptimizedImageUrl({
          src: videoPoster,
          width: 1200,
          quality: 75,
        })
      : undefined;

    // ── SSR JSON-LD structured data ────────────────────────────────────
    // Render structured data in the Server Component so it appears in the
    // initial HTML. This ensures Googlebot (URL Inspection Tool) and social
    // media crawlers (Facebook, Twitter, WhatsApp, Telegram, Discord) that
    // do NOT execute JavaScript can see the complete schema including
    // publisher/Organization/logo.
    const articleSchema = article
      ? generateArticleSchema(article, locale)
      : null;

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

        {/* SSR preload: inject <link rel="preload"> for the video poster.
            When the article has a hero video with a poster thumbnail, preload
            it here so the browser can start downloading immediately, avoiding
            the LCP penalty from waiting for client JS to hydrate and request
            the poster image. */}
        {preloadedVideoPoster && (
          <link
            rel="preload"
            as="image"
            href={preloadedVideoPoster}
            fetchPriority="high"
          />
        )}

        {/* SSR JSON-LD: in the initial HTML for crawlers that don't execute JS */}
        {articleSchema && (
          <script
            type="application/ld+json"
            dangerouslySetInnerHTML={{
              __html: JSON.stringify(articleSchema),
            }}
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
