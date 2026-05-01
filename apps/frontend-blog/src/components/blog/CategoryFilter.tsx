'use client';

import { useCallback, useEffect, useState } from 'react';
import useEmblaCarousel from 'embla-carousel-react';
import { useTranslations } from 'next-intl';
import { useQueryClient } from '@tanstack/react-query';
import { useCurrentLocale } from '@/lib/hooks/useCurrentLocale';
import { useFrontendCategories } from '@/lib/hooks/useFrontendArticles';
import { frontendBlogApi } from '@/lib/api/frontendBlogApi';
import type { FrontendCategory } from '@/lib/types/frontend-blog';

interface CategoryFilterProps {
  selectedCategoryId?: string;
  onSelectCategoryAction: (categoryId?: string) => void;
  isSticky?: boolean;
  initialCategories?: FrontendCategory[];
}

export function CategoryFilter({
  selectedCategoryId,
  onSelectCategoryAction,
  isSticky = false,
  initialCategories,
}: CategoryFilterProps) {
  const t = useTranslations();
  const { data: categories, isLoading } =
    useFrontendCategories(initialCategories);
  const queryClient = useQueryClient();
  const locale = useCurrentLocale();

  // Hover prefetching: warm up query cache for category articles
  const prefetchCategory = useCallback(
    (categoryId?: string) => {
      // Skip if already cached (will be a no-op if fresh enough)
      queryClient.prefetchQuery({
        queryKey: [
          'homeArticles',
          locale,
          {
            page: 1,
            pageSize: 10,
            categoryId,
          },
        ],
        queryFn: () =>
          frontendBlogApi.getArticles({
            lang: locale,
            page: 1,
            pageSize: 10,
            categoryId,
          }),
        staleTime: 5 * 60 * 1000,
      });
    },
    [queryClient, locale],
  );
  const [emblaRef, emblaApi] = useEmblaCarousel({
    align: 'center',
    containScroll: 'keepSnaps',
    dragFree: false,
    slidesToScroll: 1,
  });
  const [canScrollPrev, setCanScrollPrev] = useState(false);
  const [canScrollNext, setCanScrollNext] = useState(false);

  const onSelect = useCallback(() => {
    if (!emblaApi) return;
    setCanScrollPrev(emblaApi.canScrollPrev());
    setCanScrollNext(emblaApi.canScrollNext());
  }, [emblaApi]);

  useEffect(() => {
    if (!emblaApi) return;
    onSelect();
    emblaApi.on('select', onSelect);
    emblaApi.on('reInit', onSelect);
    return () => {
      emblaApi.off('select', onSelect);
      emblaApi.off('reInit', onSelect);
    };
  }, [emblaApi, onSelect]);

  // Scroll to selected category when it changes
  useEffect(() => {
    if (!emblaApi || !categories) return;
    const idx = categories.findIndex(
      (c: FrontendCategory) => c.id === selectedCategoryId,
    );
    if (idx >= 0) {
      // +1 because "All" is at index 0
      emblaApi.scrollTo(idx + 1);
    } else {
      emblaApi.scrollTo(0);
    }
  }, [selectedCategoryId, categories, emblaApi]);

  // Loading skeleton
  if (isLoading) {
    return (
      <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-hide px-4 sm:px-0">
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className="flex-shrink-0 h-10 w-24 rounded-lg bg-slate-200 dark:bg-slate-700 animate-pulse"
          />
        ))}
      </div>
    );
  }

  if (!categories || categories.length === 0) return null;

  return (
    <div
      className={`relative px-4 sm:px-0 transition-all duration-300 ${
        isSticky
          ? 'bg-background/95 backdrop-blur-md shadow-[0_1px_3px_rgba(0,0,0,0.06)] dark:shadow-[0_1px_3px_rgba(0,0,0,0.3)]'
          : ''
      }`}
    >
      {/* Scroll left button */}
      {canScrollPrev && (
        <button
          onClick={() => emblaApi?.scrollPrev()}
          className="absolute left-0 top-3 bottom-0 z-10 w-8 flex items-center justify-start bg-gradient-to-r from-background via-background/90 to-transparent"
          aria-label="Scroll left"
        >
          <svg
            className="w-4 h-4 text-slate-500"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M15 19l-7-7 7-7"
            />
          </svg>
        </button>
      )}

      {/* Scroll right button */}
      {canScrollNext && (
        <button
          onClick={() => emblaApi?.scrollNext()}
          className="absolute right-0 top-3 bottom-0 z-10 w-8 flex items-center justify-end bg-gradient-to-l from-background via-background/90 to-transparent"
          aria-label="Scroll right"
        >
          <svg
            className="w-4 h-4 text-slate-500"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9 5l7 7-7 7"
            />
          </svg>
        </button>
      )}

      {/* Embla carousel */}
      <div ref={emblaRef} className="overflow-hidden pt-3">
        <div
          className="flex gap-2"
          role="tablist"
          aria-label={t('categories.title')}
        >
          {/* "All" chip */}
          <button
            onClick={() => onSelectCategoryAction(undefined)}
            onMouseEnter={() => prefetchCategory(undefined)}
            role="tab"
            aria-selected={!selectedCategoryId}
            className={`
              flex-shrink-0 px-5 py-2.5 rounded-lg text-sm font-semibold
              transition-all duration-200 whitespace-nowrap
              ${
                !selectedCategoryId
                  ? 'bg-blue-600 text-white shadow-sm shadow-blue-300 dark:shadow-blue-900'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }
            `}
          >
            {t('common.all')}
          </button>

          {/* Category chips */}
          {(categories as FrontendCategory[]).map((category) => {
            const isActive = selectedCategoryId === category.id;
            return (
              <button
                key={category.id}
                onClick={() => onSelectCategoryAction(category.id)}
                onMouseEnter={() => prefetchCategory(category.id)}
                role="tab"
                aria-selected={isActive}
                className={`
                  flex-shrink-0 px-5 py-2.5 rounded-lg text-sm font-semibold
                  transition-all duration-200 whitespace-nowrap
                  ${
                    isActive
                      ? 'bg-blue-600 text-white shadow-sm shadow-blue-300 dark:shadow-blue-900'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                  }
                `}
              >
                {category.name}
                {category.articleCount !== undefined && (
                  <span
                    className={`ml-1.5 text-xs ${
                      isActive
                        ? 'text-blue-400 dark:text-blue-500'
                        : 'text-slate-400 dark:text-slate-500'
                    }`}
                  >
                    {category.articleCount}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
