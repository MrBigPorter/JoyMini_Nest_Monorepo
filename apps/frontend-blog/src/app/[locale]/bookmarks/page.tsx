'use client';

import { useTranslations } from 'next-intl';
import { Bookmark, FileText } from 'lucide-react';
import { ArticleCard } from '@/components/blog/ArticleCard';

// Mock 收藏文章数据
const mockBookmarkedArticles = [
  {
    id: 1,
    title: 'Next.js 15 新特性全面解析',
    slug: 'nextjs-15-features',
    excerpt: '深入解析 Next.js 15 带来的所有新特性和改进',
    publishedAt: '2026-04-05',
    readingTime: '8 分钟',
    coverImage: 'https://picsum.photos/id/1/600/400',
  },
  {
    id: 2,
    title: 'React 19 Server Components 最佳实践',
    slug: 'react-19-server-components',
    excerpt: '如何正确使用 React 19 的服务端组件',
    publishedAt: '2026-04-03',
    readingTime: '12 分钟',
    coverImage: 'https://picsum.photos/id/2/600/400',
  },
  {
    id: 3,
    title: 'Tailwind CSS v4 迁移指南',
    slug: 'tailwind-v4-migration',
    excerpt: '从 v3 迁移到 v4 的完整步骤和注意事项',
    publishedAt: '2026-04-01',
    readingTime: '6 分钟',
    coverImage: 'https://picsum.photos/id/3/600/400',
  },
];

export default function BookmarksPage() {
  const t = useTranslations();

  return (
    <div className="max-w-5xl mx-auto px-4 py-8 md:py-12">
      {/* 页面标题 */}
      <header className="mb-10">
        <div className="flex items-center gap-3 mb-4">
          <Bookmark className="w-8 h-8 text-primary" />
          <h1 className="text-3xl md:text-4xl font-bold">
            {t('bookmarks.title')}
          </h1>
        </div>
        <p className="text-lg text-muted-foreground">
          {t('bookmarks.subtitle')}
        </p>
      </header>

      {/* 收藏文章列表 */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-16">
        {mockBookmarkedArticles.map((article) => (
          <ArticleCard key={article.id} article={article} />
        ))}
      </div>

      {/* 统计信息 */}
      <div className="p-6 rounded-xl border border-border bg-muted/30">
        <div className="flex items-center gap-3">
          <FileText className="w-5 h-5 text-muted-foreground" />
          <span className="text-muted-foreground">
            {t('bookmarks.totalCount', {
              count: mockBookmarkedArticles.length,
            })}
          </span>
        </div>
      </div>
    </div>
  );
}
