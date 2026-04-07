'use client';

import { useTranslations } from 'next-intl';
import { Hash, ArrowLeft } from 'lucide-react';
import { Link } from '@/navigation';
import { ArticleCard } from '@/components/blog/ArticleCard';

// Mock 标签数据 (与列表页保持一致)
const mockTags = [
  { id: 1, name: 'Next.js', slug: 'nextjs', count: 15, color: '#000000' },
  { id: 2, name: 'React', slug: 'react', count: 21, color: '#61dafb' },
  {
    id: 3,
    name: 'TypeScript',
    slug: 'typescript',
    count: 18,
    color: '#3178c6',
  },
  { id: 4, name: 'Tailwind', slug: 'tailwind', count: 12, color: '#06b6d4' },
  { id: 5, name: 'NestJS', slug: 'nestjs', count: 9, color: '#e0234e' },
  { id: 6, name: 'Prisma', slug: 'prisma', count: 7, color: '#2d3748' },
  { id: 7, name: '性能优化', slug: 'performance', count: 6, color: '#10b981' },
  { id: 8, name: '用户体验', slug: 'ux', count: 8, color: '#8b5cf6' },
  { id: 9, name: 'DevOps', slug: 'devops', count: 5, color: '#f59e0b' },
  {
    id: 10,
    name: '架构设计',
    slug: 'architecture',
    count: 4,
    color: '#ef4444',
  },
  {
    id: 11,
    name: '最佳实践',
    slug: 'best-practices',
    count: 11,
    color: '#0ea5e9',
  },
  { id: 12, name: '安全', slug: 'security', count: 3, color: '#84cc16' },
  { id: 13, name: 'AI', slug: 'ai', count: 7, color: '#a855f7' },
  { id: 14, name: '测试', slug: 'testing', count: 5, color: '#ec4899' },
  { id: 15, name: 'CI/CD', slug: 'cicd', count: 4, color: '#14b8a6' },
];

// Mock 标签下文章数据
const mockTagArticles = [
  {
    id: 1,
    title: 'Next.js 15 新特性深度解析',
    slug: 'nextjs-15-deep-dive',
    excerpt: '全面解析 Next.js 15 带来的新特性、性能改进以及最佳实践建议。',
    publishedAt: '2026-04-05',
    readTime: 8,
    coverImage: 'https://picsum.photos/seed/tag1/800/400',
  },
  {
    id: 2,
    title: 'TypeScript 5.6 类型系统新功能',
    slug: 'typescript-5-6-features',
    excerpt: '探索 TypeScript 5.6 版本中引入的新类型系统特性和语法改进。',
    publishedAt: '2026-03-30',
    readTime: 6,
    coverImage: 'https://picsum.photos/seed/tag2/800/400',
  },
  {
    id: 3,
    title: 'React Server Components 实战指南',
    slug: 'react-server-components-guide',
    excerpt:
      '从实际项目出发，讲解 React Server Components 的正确使用方式和常见坑点。',
    publishedAt: '2026-03-25',
    readTime: 10,
    coverImage: 'https://picsum.photos/seed/tag3/800/400',
  },
];

interface TagPageProps {
  params: {
    slug: string;
  };
}

export default function TagPage({ params }: TagPageProps) {
  const t = useTranslations();
  const tag = mockTags.find((t) => t.slug === params.slug);

  if (!tag) {
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
            style={{ backgroundColor: `${tag.color}15` }}
          >
            <Hash className="w-8 h-8" style={{ color: tag.color }} />
          </div>
          <div>
            <h1 className="text-3xl md:text-4xl font-bold">{tag.name}</h1>
            <p className="text-sm text-muted-foreground mt-1">
              {t('common.articleCount', { count: tag.count })}
            </p>
          </div>
        </div>
      </header>

      {/* 文章列表 */}
      <div className="space-y-6">
        {mockTagArticles.map((article) => (
          <ArticleCard key={article.id} article={article} />
        ))}
      </div>
    </div>
  );
}
