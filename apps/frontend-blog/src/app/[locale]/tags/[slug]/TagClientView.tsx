'use client';

import { useTranslations } from 'next-intl';
import { useParams } from 'next/navigation';
import { Hash, ArrowLeft, Loader2, Flame } from 'lucide-react';
import { Link } from '@/navigation';
import { ArticleCard } from '@/components/blog/ArticleCard';
import { EmptyContentState } from '@/components/blog/EmptyContentState';
import { useFrontendTagBySlug } from '@/lib/hooks/useFrontendArticles';
import type { FrontendTagWithArticles } from '@/lib/types/frontend-blog';

interface TagClientViewProps {
  initialData?: FrontendTagWithArticles | null;
}

export default function TagClientView({ initialData }: TagClientViewProps) {
  const t = useTranslations();
  const paramsFromHook = useParams();
  const slug = paramsFromHook.slug as string;
  const {
    data: tagData,
    isLoading,
    error,
  } = useFrontendTagBySlug(
    slug,
    {
      page: 1,
      pageSize: 10,
    },
    initialData,
  );

  // Zero flicker logic: only show skeleton when no initial data
  const hasInitialData = !!(initialData && slug);
  const hasCurrentData = !!(tagData && slug);

  if (isLoading && !hasInitialData && !hasCurrentData) {
    return (
      <div className="max-w-5xl mx-auto px-4 py-8 md:py-12">
        <div className="flex flex-col items-center justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="mt-4 text-slate-500">{t('common.loading')}</p>
        </div>
      </div>
    );
  }

  if (error || !tagData) {
    return (
      <div className="max-w-5xl mx-auto px-4 py-8 md:py-12">
        <div className="text-center py-20">
          <h1 className="text-2xl font-bold mb-4">{t('tags.notFound')}</h1>
          <Link href="/tags" className="text-primary hover:underline">
            {t('common.backToTags')}
          </Link>
        </div>
      </div>
    );
  }

  const tag = tagData;
  const articles = tagData.articles?.items || [];

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
      tagName
        .split('')
        .reduce((acc: number, char) => acc + char.charCodeAt(0), 0) %
      colors.length;
    return colors[index];
  };

  const color = getTagColor(tag.name);

  return (
    <div className="max-w-5xl mx-auto px-4 py-8 md:py-12">
      {/* 返回按钮 */}
      <div className="mb-6">
        <Link
          href="/tags"
          className="inline-flex items-center gap-2 text-muted-foreground hover:text-primary transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          {t('common.backToTags')}
        </Link>
      </div>

      {/* 标签头部 */}
      <header className="mb-10">
        <div className="flex items-center gap-4 mb-4">
          <div
            className="w-16 h-16 rounded-xl flex items-center justify-center"
            style={{ backgroundColor: `${color}15` }}
          >
            <Hash className="w-8 h-8" style={{ color }} />
          </div>
          <div>
            <h1 className="text-3xl md:text-4xl font-bold">{tag.name}</h1>
            <p className="text-sm text-muted-foreground mt-1">
              {t('common.articleCount', { count: tag.articleCount })}
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
          type="tag"
          title={t('tags.emptyArticles')}
          description={t('tags.emptyDescription')}
          actions={[
            {
              label: t('common.backToTags'),
              href: '/tags',
              variant: 'primary',
              icon: <ArrowLeft className="w-4 h-4" />,
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
