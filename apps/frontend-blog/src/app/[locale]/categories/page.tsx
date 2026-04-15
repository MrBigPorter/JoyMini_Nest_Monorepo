'use client';

import { useTranslations } from 'next-intl';
import { FileText, FolderOpen, Loader2, Home } from 'lucide-react';
import { Link } from '@/navigation';
import { EmptyContentState } from '@/components/blog/EmptyContentState';
import { useFrontendCategories } from '@/lib/hooks/useFrontendArticles';

export default function CategoriesPage() {
  const t = useTranslations();
  const { data: categories, isLoading, error } = useFrontendCategories();

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

  if (error) {
    return (
      <div className="max-w-5xl mx-auto px-4 py-8 md:py-12">
        <div className="flex flex-col items-center justify-center py-20">
          <p className="text-red-500">{t('common.error')}</p>
        </div>
      </div>
    );
  }

  const categoryList = categories || [];

  return (
    <div className="max-w-5xl mx-auto px-4 py-8 md:py-12">
      {/* 页面标题 */}
      <header className="mb-10">
        <div className="flex items-center gap-3 mb-4">
          <FolderOpen className="w-8 h-8 text-primary" />
          <h1 className="text-3xl md:text-4xl font-bold">
            {t('categories.title')}
          </h1>
        </div>
        <p className="text-lg text-muted-foreground">
          {t('categories.subtitle')}
        </p>
      </header>

      {/* 分类网格 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-16">
        {categoryList.map((category) => (
          <Link
            key={category.id}
            href={`/categories/${category.slug}`}
            className="group block p-6 rounded-xl border border-border bg-card hover:border-primary/50 hover:bg-accent/50 transition-all duration-200"
          >
            <div className="flex items-start gap-4">
              <div className="text-3xl">
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
                          ? '✅'
                          : category.name.includes('教程')
                            ? '📚'
                            : '📂'}
              </div>
              <div className="flex-1 min-w-0">
                <h2 className="text-xl font-semibold mb-2 group-hover:text-primary transition-colors">
                  {category.name}
                </h2>
                <p className="text-muted-foreground mb-3 line-clamp-2">
                  {category.description}
                </p>
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <FileText className="w-4 h-4" />
                  <span>
                    {t('common.articleCount', { count: category.articleCount })}
                  </span>
                </div>
              </div>
            </div>
          </Link>
        ))}
      </div>

      {categoryList.length === 0 && (
        <EmptyContentState
          type="category"
          title={t('categories.empty')}
          description="分类正在准备中，您可以先浏览其他内容"
          actions={[
            {
              label: t('common.backToHome'),
              href: '/',
              variant: 'primary',
              icon: <Home className="w-4 h-4" />,
            },
            {
              label: '浏览文章',
              href: '/',
              variant: 'outline',
            },
          ]}
        />
      )}
    </div>
  );
}
