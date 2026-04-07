'use client';

import { useTranslations } from 'next-intl';
import { Hash, FileText } from 'lucide-react';
import { Link } from '@/navigation';

// Mock 标签数据
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

export default function TagsPage() {
  const t = useTranslations();

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
        {mockTags.map((tag) => (
          <Link
            key={tag.id}
            href={`/tags/${tag.slug}`}
            className="group inline-flex items-center gap-2 px-4 py-2 rounded-full border border-border bg-card hover:border-primary/50 hover:bg-accent/50 transition-all duration-200"
          >
            <span
              className="w-3 h-3 rounded-full"
              style={{ backgroundColor: tag.color }}
            />
            <span className="font-medium">{tag.name}</span>
            <span className="text-sm text-muted-foreground">({tag.count})</span>
          </Link>
        ))}
      </div>

      {/* 统计信息 */}
      <div className="p-6 rounded-xl border border-border bg-muted/30">
        <div className="flex items-center gap-3">
          <FileText className="w-5 h-5 text-muted-foreground" />
          <span className="text-muted-foreground">
            {t('common.totalTags', {
              count: mockTags.length,
              total: mockTags.reduce((sum, tag) => sum + tag.count, 0),
            })}
          </span>
        </div>
      </div>
    </div>
  );
}
