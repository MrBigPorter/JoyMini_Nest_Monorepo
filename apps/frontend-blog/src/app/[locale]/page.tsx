'use client';

import { useTranslations } from 'next-intl';
import { useFrontendArticles } from '@/lib/hooks/useFrontendArticles';
import { ArticleCard } from '@/components/blog/ArticleCard';
import { Loader2 } from 'lucide-react';

export default function HomePage() {
  const t = useTranslations();
  const { data, isLoading, error } = useFrontendArticles({
    page: 1,
    pageSize: 10,
  });

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
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

  const articles = data?.items || [];

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
        {articles.map((article) => (
          <ArticleCard key={article.id} article={article} />
        ))}
      </div>

      {articles.length === 0 && (
        <div className="text-center py-20">
          <p className="text-slate-500">{t('home.empty')}</p>
        </div>
      )}
    </div>
  );
}
