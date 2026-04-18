'use client';

import { useState, useTransition, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { Search, X, FileText, Loader2 } from 'lucide-react';
import { ArticleCard } from '@/components/blog/ArticleCard';
import { useFrontendSearchArticles } from '@/lib/hooks/useFrontendArticles';

export default function SearchPage() {
  const t = useTranslations();
  const searchParams = useSearchParams();
  const [query, setQuery] = useState('');
  const [isPending, startTransition] = useTransition();

  // 从URL参数读取搜索关键词
  useEffect(() => {
    const urlQuery = searchParams.get('q');
    if (urlQuery) {
      setQuery(urlQuery);
    }
  }, [searchParams]);

  const { data, isLoading, error } = useFrontendSearchArticles(query, {
    page: 1,
    pageSize: 12,
  });

  const hasResults = query.length > 0;
  const results = data?.items || [];
  const totalResults = data?.total || 0;

  const handleClear = () => {
    setQuery('');
  };

  const handleSearch = (value: string) => {
    startTransition(() => {
      setQuery(value);
    });
  };

  return (
    <div className="max-w-5xl mx-auto px-4 py-8 md:py-12">
      {/* 页面标题 */}
      <header className="mb-10">
        <div className="flex items-center gap-3 mb-4">
          <Search className="w-8 h-8 text-primary" />
          <h1 className="text-3xl md:text-4xl font-bold">
            {t('search.title')}
          </h1>
        </div>
        <p className="text-lg text-muted-foreground">{t('search.subtitle')}</p>
      </header>

      {/* 搜索框 */}
      <div className="relative mb-10">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
        <input
          type="text"
          value={query}
          onChange={(e) => handleSearch(e.target.value)}
          placeholder={t('search.placeholder')}
          className="w-full pl-12 pr-12 py-4 rounded-xl border border-border bg-card text-foreground text-lg focus:outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/20 transition-all"
        />
        {query && (
          <button
            onClick={handleClear}
            className="absolute right-4 top-1/2 -translate-y-1/2 p-1 hover:text-primary transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        )}
      </div>

      {/* 搜索结果 */}
      {isPending || isLoading ? (
        <div className="flex flex-col items-center justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-primary mb-4" />
          <p className="text-slate-500">{t('common.loading')}</p>
        </div>
      ) : error ? (
        <div className="flex flex-col items-center justify-center py-16">
          <p className="text-red-500">{t('common.error')}</p>
        </div>
      ) : hasResults ? (
        <>
          {/* 统计信息 */}
          <div className="p-4 rounded-lg border border-border bg-muted/30 mb-6">
            <div className="flex items-center gap-3">
              <FileText className="w-5 h-5 text-muted-foreground" />
              <span className="text-muted-foreground">
                {t('search.result', { count: totalResults })}
              </span>
            </div>
          </div>

          {/* 结果列表 */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-16">
            {results.map((article) => (
              <ArticleCard key={article.id} article={article} />
            ))}
          </div>

          {/* 空结果 */}
          {results.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <Search className="w-16 h-16 text-muted-foreground/30 mb-4" />
              <h3 className="text-xl font-semibold text-muted-foreground mb-2">
                {t('search.noResults')}
              </h3>
              <p className="text-muted-foreground">
                {t('search.noResultsDescription')}
              </p>
            </div>
          )}
        </>
      ) : (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <Search className="w-16 h-16 text-muted-foreground/30 mb-4" />
          <h3 className="text-xl font-semibold text-muted-foreground mb-2">
            {t('search.emptyTitle')}
          </h3>
          <p className="text-muted-foreground">
            {t('search.emptyDescription')}
          </p>
        </div>
      )}
    </div>
  );
}
