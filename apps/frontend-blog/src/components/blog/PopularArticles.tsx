'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useFrontendPopularArticles } from '@/lib/hooks/useFrontendArticles';
import type { FrontendArticle } from '@/lib/types/frontend-blog';

/**
 * PopularArticles - Sidebar component showing most popular articles
 * Displays a ranked list of articles sorted by views
 * Responsive: horizontal scroll on mobile, stacked list on desktop
 */
export function PopularArticles() {
  const t = useTranslations();
  const { data: articles, isLoading } = useFrontendPopularArticles(5);

  // Loading skeleton
  if (isLoading) {
    return (
      <div className="space-y-3">
        <div className="h-6 w-32 bg-slate-200 dark:bg-slate-700 rounded-md animate-pulse mb-4" />
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex items-start gap-3">
            {/* Rank number skeleton */}
            <div className="flex-shrink-0 w-7 h-7 rounded-full bg-slate-200 dark:bg-slate-700 animate-pulse" />
            <div className="flex-1 space-y-1.5">
              <div className="h-4 bg-slate-200 dark:bg-slate-700 rounded animate-pulse" />
              <div className="h-3 w-20 bg-slate-200 dark:bg-slate-700 rounded animate-pulse" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (!articles || articles.length === 0) return null;

  return (
    <section aria-labelledby="popular-articles-heading">
      <h2
        id="popular-articles-heading"
        className="text-lg font-bold text-slate-900 dark:text-white mb-4 flex items-center gap-2"
      >
        {/* Fire icon */}
        <svg
          className="w-5 h-5 text-orange-500"
          fill="currentColor"
          viewBox="0 0 24 24"
        >
          <path d="M12 23c-3.866 0-7-3.134-7-7 0-3.866 3.134-7 7-7s7 3.134 7 7c0 3.866-3.134 7-7 7zm0-12c-2.76 0-5 2.24-5 5s2.24 5 5 5 5-2.24 5-5-2.24-5-5-5z" />
          <path d="M13.5 2.5c0 1.5-1.5 2-1.5 4s1.5 3.5 3 4.5c-1.5 0-3-1-3-3s1-3.5 1.5-5.5z" />
          <path d="M10.5 4c0 1-.5 1.5-1 2.5s.5 3 1.5 4c-1 0-2-1-2-2.5S10 5 10.5 4z" />
        </svg>
        {t('article.popularArticles')}
      </h2>

      <div className="space-y-3">
        {(articles as FrontendArticle[]).map((article, index) => (
          <Link
            key={article.id}
            href={`/articles/${article.slug}`}
            className="group flex items-start gap-3 p-3 rounded-xl transition-all duration-200 hover:bg-slate-50 dark:hover:bg-slate-800/50"
          >
            {/* Rank badge */}
            <span
              className={`
                flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center
                text-xs font-bold
                ${
                  index === 0
                    ? 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-600 dark:text-yellow-400'
                    : index === 1
                      ? 'bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400'
                      : index === 2
                        ? 'bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400'
                        : 'bg-slate-50 dark:bg-slate-800 text-slate-400 dark:text-slate-500'
                }
              `}
            >
              {index + 1}
            </span>

            <div className="flex-1 min-w-0">
              <h3 className="text-sm font-medium text-slate-700 dark:text-slate-200 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors line-clamp-2">
                {article.title}
              </h3>
              <div className="flex items-center gap-2 mt-1 text-xs text-slate-400 dark:text-slate-500">
                <span className="flex items-center gap-1">
                  <svg
                    className="w-3.5 h-3.5"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                    />
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
                    />
                  </svg>
                  {article.views}
                </span>
                {/* TODO: Restore published date display — hidden to avoid showing outdated dates */}
                {/* {article.publishedAt && (
                  <>
                    <span>·</span>
                    <span>
                      {new Date(article.publishedAt).toLocaleDateString()}
                    </span>
                  </>
                )} */}
              </div>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}
