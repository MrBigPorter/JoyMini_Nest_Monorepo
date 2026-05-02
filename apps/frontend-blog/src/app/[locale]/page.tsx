import { serverGet } from '@/lib/serverFetch';
import { getEnabledLocales } from '@/lib/i18n/config';
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
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale: routeLocale } = await params;

  // 关键修复：SSR环境直接使用URL路径中的语言
  // 访问 /en/ 时，routeLocale = 'en'
  // 这确保SSR和CSR使用相同的语言，避免闪烁
  const locale = routeLocale;

  try {
    // P1-1 修复：并行请求 articles + categories，节省约 40-60% SSR 等待时间
    // 原因：两个 API 完全独立，串行等待白白翻倍 SSR 耗时
    // 证据：GET /zh/ Wall Time 1.21s，其中约 1.1s 全在等 API I/O
    const [initialData, initialCategories] = await Promise.all([
      serverGet<FrontendPaginatedResponse<FrontendArticle>>(
        '/v1/frontend/blog/articles',
        { lang: locale, page: 1, pageSize: 10 },
      ),
      serverGet<FrontendCategory[]>('/v1/frontend/blog/categories', {
        lang: locale,
      }).catch(() => [] as FrontendCategory[]), // categories 失败不阻断主流程
    ]);

    // 提取文章ID用于客户端查询收藏状态
    const articleIds =
      initialData.items?.map((article: FrontendArticle) => article.id) || [];

    // P1-1: LCP preload — extract first cover image for early hint
    const firstCoverImage = initialData.items?.[0]?.coverImage;

    return (
      <>
        {/* P1-1: Inject LCP image preload link into <head> via SSR */}
        {firstCoverImage && (
          <link
            rel="preload"
            as="image"
            href={firstCoverImage}
            fetchPriority="high"
          />
        )}
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
