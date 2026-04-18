'use client';

import { useTranslations } from 'next-intl';
import { useArticlesInfiniteQuerySimple } from '@/lib/hooks/useArticlesInfiniteQuery';
import { useBatchBookmarkStatusMap } from '@/lib/hooks/useBatchBookmarkStatus';
import { ArticleCard } from '@/components/blog/ArticleCard';
import { InfiniteScrollLoader } from '@/components/shared/LoadingIndicator';
import type { FrontendArticle } from '@/lib/types/frontend-blog';

export default function HomePage() {
  const t = useTranslations();

  // 使用基于React Query的无限滚动钩子
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
  });

  // 提取文章ID用于批量查询收藏状态
  const articleIds = articles.map((article) => article.id) || [];

  // 批量查询收藏状态
  const { statusMap } = useBatchBookmarkStatusMap(articleIds);

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        <p className="mt-4 text-slate-500">{t('common.loading')}</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <p className="text-red-500">{t('common.error')}</p>
      </div>
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
        {articles.map((article) => {
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
