import { serverGet } from '@/lib/serverFetch';
import { getEnabledLocales } from '@/lib/i18n/config';
import HomePageClient from './page.client.tsx';
import type { FrontendArticle } from '@/lib/types/frontend-blog';
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
    // SSR: Fetch articles (use native fetch, Cloudflare Workers compatible)
    const initialData = await serverGet<
      FrontendPaginatedResponse<FrontendArticle>
    >('/v1/frontend/blog/articles', { lang: locale, page: 1, pageSize: 10 });

    // 提取文章ID用于客户端查询收藏状态
    const articleIds =
      initialData.items?.map((article: FrontendArticle) => article.id) || [];

    return (
      <HomePageClient
        initialData={initialData}
        initialArticleIds={articleIds}
        locale={locale}
      />
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
        locale={locale}
      />
    );
  }
}
