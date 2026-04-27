'use client';

import { useTranslations } from 'next-intl';
import { useParams } from 'next/navigation';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { Link } from '@/navigation';
import { ArticleCard } from '@/components/blog/ArticleCard';
import { EmptyContentState } from '@/components/blog/EmptyContentState';
import { useFrontendCategoryBySlug } from '@/lib/hooks/useFrontendArticles';

export default function CategoryClientView() {
  const t = useTranslations();
  const paramsFromHook = useParams();
  const slug = paramsFromHook.slug as string;

  const {
    data: categoryData,
    isLoading,
    error,
  } = useFrontendCategoryBySlug(slug, {
    page: 1,
    pageSize: 10,
  });

  if (isLoading) {
    return (
      <div className="max-w-5xl mx-auto px-4 py-8 md:py-12">
        <div className="flex flex-col items-center justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="mt-4 text-slate-500">{t('common.loading')}</p>
        </div>
      </div>
    );
  }

  if (error || !categoryData) {
    return (
      <div className="max-w-5xl mx-auto px-4 py-8 md:py-12">
        <div className="text-center py-20">
          <h1 className="text-2xl font-bold mb-4">
            {t('categories.notFound')}
          </h1>
          <Link href="/categories" className="text-primary hover:underline">
            {t('common.backToCategories')}
          </Link>
        </div>
      </div>
    );
  }

  const category = categoryData;
  const articles = categoryData.articles?.items || [];

  return (
    <div className="max-w-5xl mx-auto px-4 py-8 md:py-12">
      {/* 返回按钮 */}
      <div className="mb-6">
        <Link
          href="/categories"
          className="inline-flex items-center gap-2 text-muted-foreground hover:text-primary transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          {t('common.backToCategories')}
        </Link>
      </div>

      {/* 分类头部 */}
      <header className="mb-10">
        <div className="flex items-center gap-4 mb-4">
          <div className="text-5xl">
            {/* 根据分类名称生成简单的图标 */}
            {category.name.includes('产品')
              ? '🚀'
              : category.name.includes('技术')
                ? '💻'
                : category.name.includes('行业')
                  ? '💡'
                  : category.name.includes('团队')
                    ? '👥'
                    : category.name.includes('最佳')
                      ? ''
                      : category.name.includes('教程')
                        ? '📚'
                        : '📂'}
          </div>
          <div>
            <h1 className="text-3xl md:text-4xl font-bold">{category.name}</h1>
            <p className="text-lg text-muted-foreground mt-2">
              {category.description}
            </p>
            <p className="text-sm text-muted-foreground mt-1">
              {t('common.articleCount', { count: category.articleCount })}
            </p>
          </div>
        </div>
      </header>

      {/* 文章列表 */}
      <div className="space-y-6">
        {articles.map((article) => (
          <ArticleCard key={article.id} article={article} />
        ))}
      </div>

      {articles.length === 0 && (
        <EmptyContentState
          type="category"
          title={t('categories.emptyArticles')}
          description={t('categories.emptyDescription')}
          actions={[
            {
              label: t('common.backToCategories'),
              href: '/categories',
              variant: 'primary',
              icon: <ArrowLeft className="w-4 h-4" />,
            },
            {
              label: t('common.backToHome'),
              href: '/',
              variant: 'outline',
            },
          ]}
        />
      )}
    </div>
  );
}
