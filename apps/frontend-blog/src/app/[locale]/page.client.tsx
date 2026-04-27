'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import { useCurrentLocale } from '@/lib/hooks/useCurrentLocale';
import { useLocalizedQueryKey } from '@/lib/api/queryKeys';
import { frontendBlogApi } from '@/lib/api/frontendBlogApi';
import { useBatchBookmarkStatusMap } from '@/lib/hooks/useBookmarks';
import { ArticleCard } from '@/components/blog/ArticleCard';
import { CategoryFilter } from '@/components/blog/CategoryFilter';
import { LoadMore } from '@/components/blog/LoadMore';
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
  initialArticleIds?: string[];
  locale: string;
}

const PAGE_SIZE = 10;

export default function HomePageClient({ initialData }: HomePageClientProps) {
  const t = useTranslations();
  const currentLocale = useCurrentLocale();

  // Category filter state
  const [selectedCategoryId, setSelectedCategoryId] = useState<
    string | undefined
  >(undefined);
  // Pagination
  const [page, setPage] = useState(1);
  // Accumulated articles for "Load More"
  const [allArticles, setAllArticles] = useState<FrontendArticle[]>(
    () => initialData?.items || [],
  );

  // Main articles query
  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: useLocalizedQueryKey('homeArticles', {
      page,
      pageSize: PAGE_SIZE,
      categoryId: selectedCategoryId,
    }),
    queryFn: () =>
      frontendBlogApi.getArticles({
        lang: currentLocale,
        page,
        pageSize: PAGE_SIZE,
        categoryId: selectedCategoryId,
      }),
    staleTime: 5 * 60 * 1000,
  });

  const articles = data?.items || [];
  const totalPages = data?.totalPages || 0;

  // Track previous page to detect page changes
  const prevPageRef = useRef(page);
  const prevCategoryRef = useRef(selectedCategoryId);

  // Accumulate articles when page changes
  useEffect(() => {
    // Category changed: reset accumulated list
    if (prevCategoryRef.current !== selectedCategoryId) {
      setAllArticles(articles);
      prevCategoryRef.current = selectedCategoryId;
      prevPageRef.current = page;
      return;
    }

    // Page changed (load more): append new articles
    if (prevPageRef.current !== page && page > 1) {
      setAllArticles((prev) => [...prev, ...articles]);
      prevPageRef.current = page;
      return;
    }

    // First load or SSR data: use articles directly
    if (page === 1 && articles.length > 0) {
      setAllArticles(articles);
      prevPageRef.current = page;
    }
  }, [articles, page, selectedCategoryId]);

  // Handle category change
  const handleCategoryChange = useCallback((categoryId?: string) => {
    setSelectedCategoryId(categoryId);
    setPage(1);
    setAllArticles([]);
  }, []);

  // Handle load more
  const handleLoadMore = useCallback(() => {
    if (isFetching) return;
    setPage((p) => p + 1);
  }, [isFetching]);

  // Bookmark status
  const articleIds = allArticles.map((a: FrontendArticle) => a.id);
  const { statusMap } = useBatchBookmarkStatusMap(articleIds);

  // State checks
  const hasInitialData = initialData?.items && initialData.items.length > 0;
  const hasCurrentData = allArticles.length > 0;
  const hasMore = page < totalPages;
  const isCategoryLoading = isLoading && selectedCategoryId;

  // Skeleton: only when completely empty on first load
  if (isLoading && !hasInitialData && !hasCurrentData) {
    return <HomePageSkeleton />;
  }

  // Error: only when no data at all
  if (error && !hasCurrentData) {
    return (
      <PageErrorBoundary>
        <div className="flex flex-col items-center justify-center py-20">
          <p className="text-red-500">{t('common.error')}</p>
          <button
            onClick={() => refetch()}
            className="mt-4 px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary-600 transition-colors"
          >
            {t('common.retry')}
          </button>
        </div>
      </PageErrorBoundary>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 md:px-6 lg:px-8">
      {/* Category Filter - sticky on mobile only */}
      <div className="sticky top-0 z-40 md:static md:z-auto -mx-4 md:-mx-6 lg:-mx-8 px-4 md:px-6 lg:px-8 bg-background/95 backdrop-blur-md">
        <CategoryFilter
          selectedCategoryId={selectedCategoryId}
          onSelectCategory={handleCategoryChange}
        />
      </div>

      <div className="py-6 md:py-10">
        {/* Main content: articles */}
        <section>
          <div className="mb-8">
            <h1 className="text-3xl md:text-4xl font-bold text-slate-900 dark:text-white mb-3">
              {selectedCategoryId ? t('categories.title') : t('home.title')}
            </h1>
            <p className="text-base text-slate-600 dark:text-slate-400">
              {t('home.subtitle')}
            </p>
          </div>

          {/* Loading overlay for category switch */}
          {isCategoryLoading && (
            <div className="mb-6 flex items-center gap-3 text-sm text-slate-500 bg-slate-50 dark:bg-slate-800/50 rounded-xl px-4 py-3">
              <svg
                className="animate-spin w-4 h-4 text-blue-500"
                fill="none"
                viewBox="0 0 24 24"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                />
              </svg>
              <span>{t('common.loading')}</span>
            </div>
          )}

          {/* Article grid */}
          {allArticles.length > 0 ? (
            <>
              <div className="grid gap-6 md:grid-cols-2">
                {allArticles.map((article: FrontendArticle) => {
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

              {/* Loading indicator for load more */}
              {isFetching && page > 1 && (
                <div className="mt-6 flex justify-center">
                  <div className="flex items-center gap-2 text-sm text-slate-500">
                    <svg
                      className="animate-spin w-4 h-4"
                      fill="none"
                      viewBox="0 0 24 24"
                    >
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                      />
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                      />
                    </svg>
                    <span>{t('common.loading')}</span>
                  </div>
                </div>
              )}

              {/* Load More */}
              <LoadMore
                onClick={handleLoadMore}
                loading={isFetching && page > 1}
                hasMore={hasMore}
              />
            </>
          ) : (
            /* Empty state */
            <div className="text-center py-20">
              <svg
                className="w-16 h-16 mx-auto mb-4 text-slate-300 dark:text-slate-600"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1}
                  d="M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1m2 13a2 2 0 01-2-2V7m2 13a2 2 0 002-2V9a2 2 0 00-2-2h-2m-4-3H9M7 16h6M7 8h6v4H7V8z"
                />
              </svg>
              <p className="text-slate-500 dark:text-slate-400 mt-4">
                {t('home.empty')}
              </p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
