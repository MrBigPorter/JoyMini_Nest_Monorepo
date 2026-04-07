'use client';

import { useTranslations } from 'next-intl';
import { FolderOpen, ArrowLeft } from 'lucide-react';
import { Link } from '@/navigation';
import { ArticleCard } from '@/components/blog/ArticleCard';

// Mock 分类数据 (与列表页保持一致)
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

// Mock 分类下文章数据
const mockCategoryArticles = [
  {
    id: 1,
    title: 'Lucky Nest 2.0 正式发布：全新界面与性能提升',
    slug: 'lucky-nest-2-0-release',
    excerpt: '我们很高兴宣布 Lucky Nest 2.0 正式发布，带来了全新的用户界面、大幅的性能提升以及众多新功能。',
    publishedAt: '2026-04-01',
    readTime: 5,
    coverImage: 'https://picsum.photos/seed/cat1/800/400',
  },
  {
    id: 2,
    title: '全新通知系统上线',
    slug: 'new-notification-system',
    excerpt: '实时推送、多渠道通知、自定义偏好设置，全新通知系统让你不会错过任何重要更新。',
    publishedAt: '2026-03-28',
    readTime: 3,
    coverImage: 'https://picsum.photos/seed/cat2/800/400',
  },
  {
    id: 3,
    title: '移动端 App 1.5 版本更新',
    slug: 'mobile-app-1-5-update',
    excerpt: 'iOS 和 Android 客户端迎来 1.5 版本更新，支持离线模式、深色模式优化以及性能改进。',
    publishedAt: '2026-03-20',
    readTime: 4,
    coverImage: 'https://picsum.photos/seed/cat3/800/400',
  },
];

interface CategoryPageProps {
  params: {
    slug: string;
  };
}

export default function CategoryPage({ params }: CategoryPageProps) {
  const t = useTranslations();
  const category = mockCategories.find(c => c.slug === params.slug);

  if (!category) {
    return (
      <div className="max-w-5xl mx-auto px-4 py-8 md:py-12">
        <div className="text-center py-20">
          <h1 className="text-2xl font-bold mb-4">{t('categories.notFound')}</h1>
          <Link href="/categories" className="text-primary hover:underline">
            {t('common.backToCategories')}
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-8 md:py-12">
      {/* 返回按钮 */}
      <div className="mb-6">
        <Link href="/categories" className="inline-flex items-center gap-2 text-muted-foreground hover:text-primary transition-colors">
          <ArrowLeft className="w-4 h-4" />
          {t('common.backToCategories')}
        </Link>
      </div>

      {/* 分类头部 */}
      <header className="mb-10">
        <div className="flex items-center gap-4 mb-4">
          <div className="text-5xl">{category.icon}</div>
          <div>
            <h1 className="text-3xl md:text-4xl font-bold">
              {category.name}
            </h1>
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
        {mockCategoryArticles.map((article) => (
          <ArticleCard key={article.id} article={article} />
        ))}
      </div>
    </div>
  );
}