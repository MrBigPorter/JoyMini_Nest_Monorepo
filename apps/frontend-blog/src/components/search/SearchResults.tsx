'use client';

import { useTranslations } from 'next-intl';
import { FileText, Loader2, Search } from 'lucide-react';
import { ArticleCard } from '@/components/blog/ArticleCard';
import type { FrontendArticle } from '@/lib/types/frontend-blog';

interface SearchResultsProps {
  query: string;
  results: FrontendArticle[];
  totalResults: number;
  isLoading: boolean;
  error: Error | null;
  onArticleClick?: () => void;
}

export function SearchResults({
  query,
  results,
  totalResults,
  isLoading,
  error,
  onArticleClick,
}: SearchResultsProps) {
  const t = useTranslations();

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-primary mb-4" />
        <p className="text-slate-500">{t('common.loading')}</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <p className="text-red-500">{t('common.error')}</p>
        <p className="text-sm text-muted-foreground mt-2">
          {t('search.loadFailed')}
        </p>
      </div>
    );
  }

  if (!query) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <Search className="w-16 h-16 text-muted-foreground/30 mb-4" />
        <h3 className="text-xl font-semibold text-muted-foreground mb-2">
          {t('search.emptyTitle')}
        </h3>
        <p className="text-muted-foreground">{t('search.emptyDescription')}</p>
      </div>
    );
  }

  if (results.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <Search className="w-16 h-16 text-muted-foreground/30 mb-4" />
        <h3 className="text-xl font-semibold text-muted-foreground mb-2">
          {t('search.noResults')}
        </h3>
        <p className="text-muted-foreground">
          {t('search.noResultsDescription')}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* 统计信息 */}
      <div className="p-4 rounded-lg border border-border bg-muted/30">
        <div className="flex items-center gap-3">
          <FileText className="w-5 h-5 text-muted-foreground" />
          <span className="text-muted-foreground">
            {t('search.result', { count: totalResults })}
          </span>
        </div>
      </div>

      {/* 结果列表 */}
      <div className="space-y-4">
        {results.map((article) => (
          <div
            key={article.id}
            onClick={onArticleClick}
            className="cursor-pointer hover:bg-accent/50 transition-colors rounded-lg"
          >
            <ArticleCard article={article} compact />
          </div>
        ))}
      </div>

      {/* 查看更多提示 */}
      {totalResults > results.length && (
        <div className="text-center pt-4 border-t border-border">
          <p className="text-sm text-muted-foreground">
            {t('search.showingFirst', { count: results.length })}
            <br />
            <span className="text-xs">{t('search.visitFullPage')}</span>
          </p>
        </div>
      )}
    </div>
  );
}
