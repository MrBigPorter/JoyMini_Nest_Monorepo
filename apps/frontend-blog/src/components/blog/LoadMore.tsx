'use client';

import { useTranslations } from 'next-intl';

interface LoadMoreProps {
  onClickAction: () => void;
  loading?: boolean;
  hasMore?: boolean;
}

/**
 * LoadMore - Pagination button for loading additional articles
 * Shows a "Load More" button when there are more pages
 * Displays a loading spinner while fetching
 * Hides when all articles are loaded
 */
export function LoadMore({
  onClickAction,
  loading = false,
  hasMore = true,
}: LoadMoreProps) {
  const t = useTranslations();

  if (!hasMore) return null;

  return (
    <div className="mt-10 flex justify-center">
      <button
        onClick={onClickAction}
        disabled={loading}
        className="
          group relative inline-flex items-center gap-2
          px-8 py-3.5 rounded-xl
          text-sm font-semibold
          bg-slate-100 dark:bg-slate-800
          text-slate-700 dark:text-slate-300
          hover:bg-slate-200 dark:hover:bg-slate-700
          hover:text-slate-900 dark:hover:text-white
          border border-slate-200 dark:border-slate-700
          hover:border-blue-300 dark:hover:border-blue-700
          disabled:opacity-50 disabled:cursor-not-allowed
          transition-all duration-200
        "
      >
        {loading ? (
          <>
            {/* Spinner */}
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
          </>
        ) : (
          <>
            <span>{t('common.loadMore')}</span>
            {/* Down arrow */}
            <svg
              className="w-4 h-4 transition-transform duration-200 group-hover:translate-y-0.5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M19 14l-7 7m0 0l-7-7m7 7V3"
              />
            </svg>
          </>
        )}
      </button>
    </div>
  );
}
