'use client';

import { useTranslations } from 'next-intl';
import { Hash, FileText, Loader2, Home, Flame } from 'lucide-react';
import { Link } from '@/navigation';
import { EmptyContentState } from '@/components/blog/EmptyContentState';
import { useFrontendTags } from '@/lib/hooks/useFrontendArticles';

export default function TagsPage() {
  const t = useTranslations();
  const { data: tags, isLoading, error } = useFrontendTags();

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

  const tagList = tags || [];
  const totalArticles = tagList.reduce(
    (sum: number, tag) => sum + tag.articleCount,
    0,
  );

  // 生成标签颜色函数
  const getTagColor = (tagName: string) => {
    const colors = [
      '#000000',
      '#61dafb',
      '#3178c6',
      '#06b6d4',
      '#e0234e',
      '#2d3748',
      '#10b981',
      '#8b5cf6',
      '#f59e0b',
      '#ef4444',
      '#0ea5e9',
      '#84cc16',
      '#a855f7',
      '#ec4899',
      '#14b8a6',
    ];
    const index =
      tagName.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0) %
      colors.length;
    return colors[index];
  };

  return (
    <div className="max-w-5xl mx-auto px-4 py-8 md:py-12">
      {/* 页面标题 */}
      <header className="mb-10">
        <div className="flex items-center gap-3 mb-4">
          <Hash className="w-8 h-8 text-primary" />
          <h1 className="text-3xl md:text-4xl font-bold">{t('tags.title')}</h1>
        </div>
        <p className="text-lg text-muted-foreground">{t('tags.subtitle')}</p>
      </header>

      {/* 标签墙 */}
      <div className="flex flex-wrap gap-3 mb-16">
        {tagList.map((tag) => {
          const color = getTagColor(tag.name);
          return (
            <Link
              key={tag.id}
              href={`/tags/${tag.slug}`}
              className="group inline-flex items-center gap-2 px-4 py-2 rounded-full border border-border bg-card hover:border-primary/50 hover:bg-accent/50 transition-all duration-200"
            >
              <span
                className="w-3 h-3 rounded-full"
                style={{ backgroundColor: color }}
              />
              <span className="font-medium">{tag.name}</span>
              <span className="text-sm text-muted-foreground">
                ({tag.articleCount})
              </span>
            </Link>
          );
        })}
      </div>

      {/* 统计信息 */}
      <div className="p-6 rounded-xl border border-border bg-muted/30">
        <div className="flex items-center gap-3">
          <FileText className="w-5 h-5 text-muted-foreground" />
          <span className="text-muted-foreground">
            {t('common.totalTags', {
              count: tagList.length,
              total: totalArticles,
            })}
          </span>
        </div>
      </div>

      {tagList.length === 0 && (
        <EmptyContentState
          type="tag"
          title={t('tags.empty')}
          description="标签正在准备中，您可以先浏览热门文章"
          actions={[
            {
              label: t('common.backToHome'),
              href: '/',
              variant: 'primary',
              icon: <Home className="w-4 h-4" />,
            },
            {
              label: '浏览热门文章',
              href: '/',
              variant: 'outline',
              icon: <Flame className="w-4 h-4" />,
            },
          ]}
        />
      )}
    </div>
  );
}
