'use client';

import { useTranslations } from 'next-intl';
import { FileText, FolderOpen } from 'lucide-react';
import { Link } from '@/navigation';

// Mock 分类数据
const mockCategories = [
  {
    id: 1,
    name: '产品更新',
    slug: 'product-updates',
    description: 'Lucky Nest 产品功能更新和发布日志',
    articleCount: 12,
    icon: '🚀',
  },
  {
    id: 2,
    name: '技术博客',
    slug: 'tech-blog',
    description: '我们的技术栈、架构设计和开发经验分享',
    articleCount: 23,
    icon: '💻',
  },
  {
    id: 3,
    name: '行业见解',
    slug: 'insights',
    description: '关于互联网、产品和用户体验的思考',
    articleCount: 8,
    icon: '💡',
  },
  {
    id: 4,
    name: '团队日常',
    slug: 'team',
    description: '团队背后的故事、工作方式和文化',
    articleCount: 5,
    icon: '👥',
  },
  {
    id: 5,
    name: '最佳实践',
    slug: 'best-practices',
    description: '我们总结的开发和产品设计最佳实践',
    articleCount: 15,
    icon: '✅',
  },
  {
    id: 6,
    name: '教程指南',
    slug: 'tutorials',
    description: '一步一步的使用教程和操作指南',
    articleCount: 19,
    icon: '📚',
  },
];

export default function CategoriesPage() {
  const t = useTranslations();

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
        {mockCategories.map((category) => (
          <Link
            key={category.id}
            href={`/categories/${category.slug}`}
            className="group block p-6 rounded-xl border border-border bg-card hover:border-primary/50 hover:bg-accent/50 transition-all duration-200"
          >
            <div className="flex items-start gap-4">
              <div className="text-3xl">{category.icon}</div>
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
    </div>
  );
}
