'use client';

import { useTranslations } from 'next-intl';
import { useArticlesInfiniteQuerySimple } from '@/lib/hooks/usePlatformArticlesInfiniteQuery';
import { useBatchBookmarkStatusMap } from '@/lib/hooks/usePlatformBookmarks';
import { ArticleCard } from '@/components/blog/ArticleCard';
import { InfiniteScrollLoader } from '@/components/shared/LoadingIndicator';
import { PageErrorBoundary } from '@/lib/components/ErrorBoundary';
import { HomePageSkeleton } from '@/lib/components/SkeletonLoader';
import type { FrontendArticle } from '@/lib/types/frontend-blog';

interface HomePageClientProps {
  initialData?: {
    items: FrontendArticle[];
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
  };
  initialArticleIds: string[];
  locale: string;
}

export default function HomePageClient({
  initialData,
  initialArticleIds,
  locale,
}: HomePageClientProps) {
  // 客户端组件自己管理翻译
  const t = useTranslations();
  // 使用基于React Query的无限滚动钩子，传入初始数据
  const {
    items: articles,
    total,
    page,
    pageSize,
    totalPages,
    isLoading,
    isLoadingMore,
    hasMore,
    error,
    loadMore,
    reload,
  } = useArticlesInfiniteQuerySimple({
    pageSize: 10,
    initialData, // 服务端获取的初始数据
  });

  // 提取文章ID用于批量查询收藏状态
  const articleIds =
    articles.map((article: FrontendArticle) => article.id) || [];

  // 批量查询收藏状态
  const { statusMap } = useBatchBookmarkStatusMap(articleIds);

  // 零骨架屏优化逻辑：
  // 1. 有初始数据时：立即显示内容，后台静默更新
  // 2. 无初始数据但正在加载：显示骨架屏
  // 3. 有数据时即使出错也继续显示现有数据
  const hasInitialData = initialData?.items && initialData.items.length > 0;
  const hasCurrentData = articles.length > 0;

  // 只在完全没有任何数据时才显示骨架屏
  if (isLoading && !hasInitialData && !hasCurrentData) {
    return <HomePageSkeleton />;
  }

  // 有数据时即使出错也继续显示现有数据
  if (error && !hasCurrentData) {
    return (
      <PageErrorBoundary>
        <div className="flex flex-col items-center justify-center py-20">
          <p className="text-red-500">{t('common.error')}</p>
          <button
            onClick={() => reload()}
            className="mt-4 px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary-600 transition-colors"
          >
            {t('common.retry')}
          </button>
        </div>
      </PageErrorBoundary>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 md:px-6 lg:px-8 py-12 md:py-16">
      <div className="mb-12 text-center md:text-left">
        <h1 className="text-4xl md:text-5xl font-bold text-slate-900 dark:text-white mb-4">
          {t('home.title')}
        </h1>
        <p className="text-lg text-slate-600 dark:text-slate-400 max-w-2xl">
          {t('home.subtitle')}
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        {articles.map((article: FrontendArticle) => {
          const bookmarkStatus = statusMap.get(article.id);
          return (
            <ArticleCard
              key={article.id}
              article={article}
              bookmarkStatus={bookmarkStatus}
            />
          );
        })}
      </div>

      {/* 无限滚动加载器（自动加载） */}
      <InfiniteScrollLoader
        isLoadingMore={isLoadingMore}
        hasMore={hasMore}
        error={error}
        onRetryAction={loadMore}
      />

      {/* 分页信息（仅在开发环境显示） */}
      {process.env.NODE_ENV === 'development' && (
        <div className="mt-4 text-center">
          <p className="text-xs text-muted-foreground">
            {articles.length} / {total} •{' '}
            {t('common.pageInfo', { page, totalPages })}
          </p>
        </div>
      )}

      {articles.length === 0 && (
        <div className="text-center py-20">
          <p className="text-slate-500">{t('home.empty')}</p>
        </div>
      )}
    </div>
  );
}
