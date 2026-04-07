'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { Search, X, FileText } from 'lucide-react';
import { ArticleCard } from '@/components/blog/ArticleCard';

// Mock 搜索结果数据
const mockSearchResults = [
  {
    id: 1,
    title: 'Next.js 15 新特性全面解析',
    slug: 'nextjs-15-features',
    excerpt: '深入解析 Next.js 15 带来的所有新特性和改进',
    publishedAt: '2026-04-05',
    readingTime: '8 分钟',
    views: 1245,
    category: { id: 2, name: '技术博客' },
  },
  {
    id: 2,
    title: 'React 19 Server Components 最佳实践',
    slug: 'react-19-server-components',
    excerpt: '如何正确使用 React 19 的服务端组件',
    publishedAt: '2026-04-03',
    readingTime: '12 分钟',
    views: 892,
    category: { id: 2, name: '技术博客' },
  },
  {
    id: 3,
    title: 'Tailwind CSS v4 迁移指南',
    slug: 'tailwind-v4-migration',
    excerpt: '从 v3 迁移到 v4 的完整步骤和注意事项',
    publishedAt: '2026-04-01',
    readingTime: '6 分钟',
    views: 756,
    category: { id: 5, name: '最佳实践' },
  },
  {
    id: 4,
    title: 'Next.js 性能优化完整手册',
    slug: 'nextjs-performance-guide',
    excerpt: '全面优化 Next.js 应用性能的所有技巧',
    publishedAt: '2026-03-28',
    readingTime: '15 分钟',
    views: 2341,
    category: { id: 2, name: '技术博客' },
  },
];

export default function SearchPage() {
  const t = useTranslations();
  const [query, setQuery] = useState('');
  const [isPending, startTransition] = useTransition();

  const hasResults = query.length > 0;
  const results = hasResults ? mockSearchResults : [];

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
        <p className="text-lg text-muted-foreground">
          {t('search.subtitle')}
        </p>
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
      {isPending ? (
        <div className="flex items-center justify-center py-16">
          <div className="animate-spin w-8 h-8 border-2 border-border border-t-primary rounded-full" />
        </div>
      ) : hasResults ? (
        <>
          {/* 统计信息 */}
          <div className="p-4 rounded-lg border border-border bg-muted/30 mb-6">
            <div className="flex items-center gap-3">
              <FileText className="w-5 h-5 text-muted-foreground" />
          <span className="text-muted-foreground">
            {t('search.result', { count: results.length })}
          </span>
            </div>
          </div>

          {/* 结果列表 */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-16">
            {results.map((article) => (
              <ArticleCard key={article.id} article={article} />
            ))}
          </div>
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