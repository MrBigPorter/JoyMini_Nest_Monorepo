import { serverGet } from '@/lib/serverFetch';
import { getEnabledLocales } from '@/lib/i18n/config';
import cloudflareImageLoader, {
  getOptimizedImageUrl,
} from '@/lib/utils/cloudflareImageLoader';
import HomePageClient from './page.client.tsx';
import type { FrontendArticle } from '@/lib/types/frontend-blog';
import type { FrontendCategory } from '@/lib/types/frontend-blog';
import type { Locale } from '@/lib/i18n/config';
import type { FrontendPaginatedResponse } from '@/lib/types/frontend-blog';

// 无if架构：直接声明需求，构建时自动处理
// App构建时，output: 'export'会自动忽略ISR配置
// Web构建时，正常启用ISR/SSG
export const revalidate = 60; // 首页60秒ISR
export const dynamic = 'auto';

export async function generateHeaders() {
  return {
    'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=3600',
  };
}

// generate static params for all locales
export async function generateStaticParams() {
  return getEnabledLocales().map((locale: Locale) => ({ locale }));
}

export default async function HomePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { locale: routeLocale } = await params;
  const urlSearchParams = await searchParams;

  // 关键修复：SSR环境直接使用URL路径中的语言
  // 访问 /en/ 时，routeLocale = 'en'
  // 这确保SSR和CSR使用相同的语言，避免闪烁
  const locale = routeLocale;

  // 读取URL的category参数，确保SSR和客户端数据一致
  // 刷新页面时，tab UI和数据会保持同步
  const categoryId =
    typeof urlSearchParams.category === 'string'
      ? urlSearchParams.category
      : undefined;

  try {
    // P1-1 修复：并行请求 articles + categories，节省约 40-60% SSR 等待时间
    // 原因：两个 API 完全独立，串行等待白白翻倍 SSR 耗时
    // 证据：GET /zh/ Wall Time 1.21s，其中约 1.1s 全在等 API I/O
    // 修复：现在SSR会根据URL的category参数获取对应的文章数据
    const [initialData, initialCategories] = await Promise.all([
      serverGet<FrontendPaginatedResponse<FrontendArticle>>(
        '/v1/frontend/blog/articles',
        { lang: locale, page: 1, pageSize: 10, categoryId },
      ),
      serverGet<FrontendCategory[]>('/v1/frontend/blog/categories', {
        lang: locale,
      }).catch(() => [] as FrontendCategory[]), // categories 失败不阻断主流程
    ]);

    // 提取文章ID用于客户端查询收藏状态
    const articleIds =
      initialData.items?.map((article: FrontendArticle) => article.id) || [];

    // P1-1: LCP preload — extract first cover image + video poster (JPEG + WebP) for early hint
    const firstCoverImage = initialData.items?.[0]?.coverImage;
    const firstVideoPoster = initialData.items?.[0]?.meta?.video?.poster;
    const firstVideoPosterWebp =
      initialData.items?.[0]?.meta?.video?.posterWebp;

    // Transform cover image URL through cloudflareImageLoader so the preload URL
    // matches what Next.js <Image> will request via /cdn-cgi/image/... (Cloudflare Image Resizing).
    // Without this, the preload URL (raw R2) ≠ rendered URL (Cloudflare-transformed) → preload miss.
    // The hero image uses sizes="(max-width: 1024px) 100vw, 66vw", so at 1440px viewport
    // it renders ~950px wide. Preload at 1200px to cover desktop LCP scenarios.
    const preloadedCoverImage = firstCoverImage
      ? cloudflareImageLoader({
          src: firstCoverImage,
          width: 1200,
          quality: 75,
        })
      : undefined;

    // Collect unique image URLs to preload (cover + video poster, deduplicated)
    // Prefer WebP variant for video poster (~30-50% smaller file size)
    // ⚠️ CRITICAL: Must transform poster URLs through getOptimizedImageUrl() so the
    // preload URL matches what HlsVideoPlayer renders. If preload URL (raw R2) ≠
    // rendered URL (Cloudflare-transformed) → preload cache miss → wasted download.
    const preloadImages = new Set<string>();
    if (preloadedCoverImage) preloadImages.add(preloadedCoverImage);
    if (firstVideoPosterWebp) {
      preloadImages.add(
        getOptimizedImageUrl({
          src: firstVideoPosterWebp,
          width: 1200,
          quality: 75,
        }),
      );
    } else if (firstVideoPoster) {
      preloadImages.add(
        getOptimizedImageUrl({
          src: firstVideoPoster,
          width: 1200,
          quality: 75,
        }),
      );
    }

    return (
      <>
        {/* P1-1: Inject LCP image preload links into <head> via SSR */}
        {[...preloadImages].map((imgUrl) => (
          <link
            key={imgUrl}
            rel="preload"
            as="image"
            href={imgUrl}
            fetchPriority="high"
          />
        ))}
        <HomePageClient
          initialData={initialData}
          initialArticleIds={articleIds}
          initialCategories={initialCategories}
          locale={locale}
        />
      </>
    );
  } catch (error) {
    // 返回空数据，让客户端显示骨架屏
    return (
      <HomePageClient
        initialData={{
          items: [],
          total: 0,
          page: 1,
          pageSize: 10,
          totalPages: 0,
        }}
        initialArticleIds={[]}
        initialCategories={[]}
        locale={locale}
      />
    );
  }
}
