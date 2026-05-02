'use client';

import {
  useState,
  useCallback,
  useRef,
  useEffect,
  useMemo,
  Suspense,
} from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useQueryClient } from '@tanstack/react-query';
import { useCurrentLocale } from '@/lib/hooks/useCurrentLocale';
import { useFrontendArticles } from '@/lib/hooks/useFrontendArticles';
import { frontendBlogApi } from '@/lib/api/frontendBlogApi';
import { useBatchBookmarkStatusMap } from '@/lib/hooks/useBookmarks';
import { useNetworkQuality } from '@/lib/hooks/useNetworkQuality';
import { ArticleCard } from '@/components/blog/ArticleCard';
import { CategoryFilter } from '@/components/blog/CategoryFilter';
import { LoadMore } from '@/components/blog/LoadMore';
import { PageErrorBoundary } from '@/lib/components/ErrorBoundary';
import { HomePageSkeleton } from '@/lib/components/SkeletonLoader';
import { useHomePageContext } from '@/lib/providers/HomePageStateProvider';
import type {
  FrontendArticle,
  FrontendCategory,
} from '@/lib/types/frontend-blog';

interface HomePageClientProps {
  initialData?: {
    items: FrontendArticle[];
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
  };
  initialArticleIds?: string[];
  initialCategories?: FrontendCategory[];
  locale: string;
}

const PAGE_SIZE = 10;

/**
 * Wrapper with Suspense boundary required by useSearchParams().
 * Next.js requires this to avoid opting the page into client-side rendering at build time.
 */
export default function HomePageClient(props: HomePageClientProps) {
  return (
    <Suspense fallback={<HomePageSkeleton />}>
      <HomePageClientContent {...props} />
    </Suspense>
  );
}

function HomePageClientContent({ initialData, ...props }: HomePageClientProps) {
  const t = useTranslations();
  const currentLocale = useCurrentLocale();
  const searchParams = useSearchParams();
  const router = useRouter();

  // P0-3a: Network-aware adaptive quality
  const networkQuality = useNetworkQuality();

  // ──────────────────────────────────────────────────
  // Initialize state from URL search params (category)
  // ──────────────────────────────────────────────────
  const [selectedCategoryId, setSelectedCategoryId] = useState<
    string | undefined
  >(searchParams.get('category') || undefined);

  // ──────────────────────────────────────────────────
  // KeepAlive state from Layout-level Context.
  // allArticles + page + isInitialCategory survive home ↔ article-detail
  // navigation because the provider lives in [locale]/layout.tsx which
  // stays mounted while only children (the page) swap.
  // ──────────────────────────────────────────────────
  const {
    allArticles,
    page,
    isInitialCategory,
    setAllArticles,
    setPage,
    setIsInitialCategory,
    resetState,
  } = useHomePageContext();

  // On first mount (fresh load or hard refresh), seed Context from SSR
  // initialData and URL params. When returning from article detail,
  // Context already has the accumulated data → skip seeding.
  const initialSeedDone = useRef(false);

  useEffect(() => {
    if (initialSeedDone.current) return;
    initialSeedDone.current = true;

    // Seed accumulated articles from SSR data
    if (allArticles.length === 0 && initialData?.items?.length) {
      setAllArticles(initialData.items);
    }

    // On fresh load/hard refresh: clean stale ?page=N from URL.
    // Refreshing always goes to page 1, so the URL should reflect that.
    // The KeepAlive Context preserves page across SPA navigation instead.
    if (searchParams.get('page')) {
      const params = new URLSearchParams(searchParams.toString());
      params.delete('page');
      router.replace(`?${params.toString()}`, { scroll: false });
    }

    // Intentionally empty deps: runs once on mount only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Track latest scroll position in real-time via scroll event listener.
  // This avoids reading window.scrollY at cleanup time (which Next.js resets to 0 before unmount).
  const scrollPosRef = useRef(0);

  // ──────────────────────────────────────────────────
  // Sync state → URL search params (one-way, prevents infinite loop)
  // Updates the URL when category or page changes without triggering navigation
  // ──────────────────────────────────────────────────
  useEffect(() => {
    const params = new URLSearchParams(searchParams.toString());

    if (selectedCategoryId) {
      params.set('category', selectedCategoryId);
    } else {
      params.delete('category');
    }

    // Sync page to URL for SPA navigation (Load More).
    // On hard refresh, the seed effect above cleans ?page=N so we always start at page 1.
    if (page > 1) {
      params.set('page', String(page));
    } else {
      params.delete('page');
    }

    const newSearch = params.toString();
    const currentSearch = searchParams.toString();

    // Only update if actually changed (prevents infinite loop)
    if (newSearch !== currentSearch) {
      router.replace(`?${newSearch}`, { scroll: false });
    }
  }, [selectedCategoryId, page, searchParams, router]);

  // ──────────────────────────────────────────────────
  // Track scroll position in real-time + save on unmount
  // window.scrollY is reset to 0 by Next.js before the cleanup effect runs,
  // so we track position via scroll event listener and use ref value at cleanup.
  // ──────────────────────────────────────────────────
  useEffect(() => {
    const handleScroll = () => {
      scrollPosRef.current = window.scrollY;
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', handleScroll);
      // Use ref value (captured before Next.js reset scrollY to 0)
      sessionStorage.setItem('homeScrollY', String(scrollPosRef.current));
      sessionStorage.setItem('homeNavigatedTo', window.location.pathname);
    };
  }, []);

  // Main articles query (P0-1: Local-First with IndexedDB via useFrontendArticles)
  // NOTE: initialData is only passed for the initial SSR category. Once the user
  // switches to a different category, we clear it to avoid React Query treating
  // stale SSR data as valid data for the new query key.
  const { data, isLoading, error, refetch, isFetching } = useFrontendArticles({
    page,
    pageSize: PAGE_SIZE,
    categoryId: selectedCategoryId,
    initialData: isInitialCategory ? initialData : undefined,
    queryKeyPrefix: 'homeArticles',
  });

  const articles = useMemo(() => data?.items || [], [data?.items]);
  const totalPages = data?.totalPages || 0;
  const hasMore = page < totalPages;

  // Track previous page to detect page changes
  const prevPageRef = useRef(page);

  // Accumulate articles when data arrives:
  // - Load More (page > 1): append new articles
  // - First load or category switch resolved (page === 1): replace articles
  useEffect(() => {
    if (page > 1 && prevPageRef.current !== page) {
      // Page changed (Load More) — deduplicate by ID to prevent duplicates
      // when React Query reuses stale initialData for a different page query
      setAllArticles((prev) => {
        const existingIds = new Set(prev.map((a) => a.id));
        const newArticles = articles.filter((a) => !existingIds.has(a.id));
        return [...prev, ...newArticles];
      });
      prevPageRef.current = page;
    } else if (page === 1 && articles.length > 0) {
      // First load, category switch resolved, or SSR hydration
      setAllArticles(articles);
      prevPageRef.current = page;
    }
  }, [articles, page]);

  // ──────────────────────────────────────────────────
  // Restore scroll position after articles are rendered
  // Only restores if the previous navigation destination was an article detail page
  // (i.e., user clicked an article → read → router.back())
  // ──────────────────────────────────────────────────
  useEffect(() => {
    if (allArticles.length > 0) {
      const navigatedTo = sessionStorage.getItem('homeNavigatedTo');
      const savedScrollY = sessionStorage.getItem('homeScrollY');

      // Only restore if we came back from an article detail page
      if (navigatedTo?.includes('/articles/') && savedScrollY) {
        // Use requestAnimationFrame to ensure DOM is fully painted
        requestAnimationFrame(() => {
          window.scrollTo(0, Number(savedScrollY));
        });
      }

      // Always clean up session storage on mount
      sessionStorage.removeItem('homeScrollY');
      sessionStorage.removeItem('homeNavigatedTo');
    }
  }, [allArticles]);

  // ──────────────────────────────────────────────────
  // P0-2c: Bottom auto-prefetch — prefetch next page
  // when user scrolls near the bottom of the article list
  // ──────────────────────────────────────────────────
  const queryClient = useQueryClient();
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const sentinel = sentinelRef.current;

    if (!sentinel || !hasMore || isFetching) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const nextPage = page + 1;

            // 1. Prefetch API data for the next page
            // Note: manually constructed array instead of useLocalizedQueryKey hook
            // because hooks cannot be called inside callbacks (React Rules of Hooks)
            queryClient.prefetchQuery({
              queryKey: [
                'homeArticles',
                currentLocale,
                {
                  page: nextPage,
                  pageSize: PAGE_SIZE,
                  categoryId: selectedCategoryId,
                },
              ],
              queryFn: () =>
                frontendBlogApi.getArticles({
                  lang: currentLocale,
                  page: nextPage,
                  pageSize: PAGE_SIZE,
                  categoryId: selectedCategoryId,
                }),
              staleTime: 5 * 60 * 1000,
            });

            // 2. Also prefetch the next page via the existing Local-First hook
            //    to ensure IndexedDB is warmed
            frontendBlogApi
              .getArticles({
                lang: currentLocale,
                page: nextPage,
                pageSize: PAGE_SIZE,
                categoryId: selectedCategoryId,
              })
              .then((data) => {
                if (data?.items?.length) {
                  // Warm SW cache by fetching cover images
                  const coverUrls = data.items
                    .map((a: FrontendArticle) => a.coverImage)
                    .filter(Boolean);
                  for (const url of coverUrls) {
                    fetch(url as string, { mode: 'no-cors' }).catch(() => {
                      // Silent — SW will cache what it can
                    });
                  }
                }
              })
              .catch(() => {
                // Silent — don't block UI
              });

            observer.disconnect();
            break;
          }
        }
      },
      {
        // Trigger when sentinel is 400px from viewport (generous head start)
        rootMargin: '400px',
        threshold: 0,
      },
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [
    hasMore,
    isFetching,
    page,
    selectedCategoryId,
    queryClient,
    currentLocale,
  ]);

  // Handle category change
  const handleCategoryChange = useCallback(
    (categoryId?: string) => {
      // No-op: clicking the same tab that's already active should do nothing
      if (categoryId === selectedCategoryId) return;

      // Mark that user has switched away from the SSR-initial category,
      // reset accumulated data and page — all via context's resetState.
      setIsInitialCategory(false);

      // Use View Transitions API (Chrome 111+) for smooth crossfade
      if (
        typeof document !== 'undefined' &&
        'startViewTransition' in document
      ) {
        const transition = (
          document as Document & {
            startViewTransition: (cb: () => void) => {
              finished: Promise<void>;
            };
          }
        ).startViewTransition(() => {
          setSelectedCategoryId(categoryId);
          resetState();
        });
        // Ensure transition doesn't block for too long (fallback timeout)
        setTimeout(() => {
          transition.finished.catch(() => {});
        }, 1000);
      } else {
        // Fallback for browsers without View Transitions support
        setSelectedCategoryId(categoryId);
        resetState();
      }
    },
    [selectedCategoryId, setIsInitialCategory, resetState],
  );

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
  // Category is switching: query is fetching data for a newly selected category
  // (not first page load, not load more)
  const isCategorySwitching = isFetching && !isLoading && !!selectedCategoryId;

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
          onSelectCategoryAction={handleCategoryChange}
          initialCategories={initialData ? props.initialCategories : undefined}
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

          {/* Thin progress bar for category switch - keeps old articles visible */}
          {isCategorySwitching && (
            <div className="mb-4 h-1 w-full bg-blue-100 dark:bg-blue-900/30 rounded-full overflow-hidden">
              <div className="h-full w-2/3 bg-blue-500 rounded-full animate-loading-bar" />
            </div>
          )}

          {/* Article grid */}
          {allArticles.length > 0 ? (
            <>
              <div className="grid gap-6 md:grid-cols-2">
                {allArticles.map((article: FrontendArticle, index: number) => {
                  const bookmarkStatus = statusMap.get(article.id);
                  return (
                    <ArticleCard
                      key={article.id}
                      article={article}
                      bookmarkStatus={bookmarkStatus}
                      priority={index < 2}
                      networkQuality={networkQuality}
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
                onClickAction={handleLoadMore}
                loading={isFetching && page > 1}
                hasMore={hasMore}
              />
            </>
          ) : isCategorySwitching ? null : (
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

      {/* P0-2c: Sentinel for bottom auto-prefetch — invisible trigger */}
      {hasMore && !isFetching && (
        <div ref={sentinelRef} className="h-1 w-full" aria-hidden="true" />
      )}
    </div>
  );
}
