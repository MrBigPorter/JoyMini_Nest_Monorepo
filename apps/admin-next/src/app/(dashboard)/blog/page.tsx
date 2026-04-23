'use client';

import { useState, useEffect } from 'react';

import {
  FileText,
  FolderTree,
  Tag,
  MessageSquare,
  TrendingUp,
  Users,
  Eye,
  Loader2,
} from 'lucide-react';
import Link from 'next/link';
import { PageHeader } from '@/components/scaffold/PageHeader';
import { Card, Badge } from '@/components/UIComponents';
import { blogApi } from '@/api';
import { BlogArticleModal } from '@/views/blog/BlogArticleModal';
import { useTranslation } from '@/hooks/useTranslation';
import { renderLocalizedText } from '@/utils/localizedText';
import LocalizedText from '@/components/blog/LocalizedText';
// removed legacy TRANSLATIONS import; use useTranslation() instead

export default function BlogDashboardPage() {
  const [stats, setStats] = useState({
    totalArticles: 0,
    totalCategories: 0,
    totalTags: 0,
    pendingComments: 0,
  });
  const { t: globalT, lang } = useTranslation();

  // local scoper for dashboard keys
  const t = (key: string, params?: Record<string, string | number>) =>
    globalT(`blog_dashboard_${key}`, params);
  const [recentArticles, setRecentArticles] = useState<
    Array<{
      id: string;
      title: string;
      status: string;
      views?: number;
      comments?: number;
      publishedAt?: string;
    }>
  >([]);
  const [topArticles, setTopArticles] = useState<
    Array<{
      title: string;
      views: number;
      growth: string;
    }>
  >([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isArticleModalOpen, setIsArticleModalOpen] = useState(false);

  const fetchDashboardData = async () => {
    setIsLoading(true);
    try {
      // Fetch all data in parallel
      const [articlesRes, categoriesRes, tagsRes, commentsRes] =
        await Promise.all([
          blogApi.getArticles({ page: 1, pageSize: 5 }),
          blogApi.getCategories(),
          blogApi.getTags(),
          blogApi.getComments({ status: 'PENDING' }),
        ]);

      setStats({
        totalArticles: articlesRes.total || 0,
        totalCategories: categoriesRes.list?.length || 0,
        totalTags: tagsRes.list?.length || 0,
        pendingComments: commentsRes.list?.length || 0,
      });

      // Set recent articles
      setRecentArticles(articlesRes.list?.slice(0, 3) || []);

      // Set top articles based on views
      const articlesWithViews =
        articlesRes.list?.map((article: any) => {
          // 将 Localized 格式的标题转换为字符串
          let titleStr = 'Untitled';
          if (article.title) {
            titleStr = renderLocalizedText(article.title, lang, 'Untitled');
          }
          return {
            title: titleStr,
            views: article.views || 0,
            growth: '+0%', // placeholder, can be calculated from historical data
          };
        }) || [];
      const sorted = articlesWithViews
        .sort((a, b) => b.views - a.views)
        .slice(0, 3);
      setTopArticles(sorted);
    } catch (error) {
      console.error('Failed to fetch dashboard data:', error);
      setStats({
        totalArticles: 0,
        totalCategories: 0,
        totalTags: 0,
        pendingComments: 0,
      });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchDashboardData();
  }, []);

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'published':
        return <Badge color="green">Published</Badge>;
      case 'draft':
        return <Badge color="gray">Draft</Badge>;
      case 'scheduled':
        return <Badge color="blue">Scheduled</Badge>;
      default:
        return <Badge color="gray">{status}</Badge>;
    }
  };

  const dashboardStats = [
    {
      title: t('totalArticles'),
      value: stats.totalArticles.toString(),
      description: t('numberOfPublishedArticles'),
      icon: FileText,
      color: 'blue',
      colorClasses: {
        bg: 'bg-blue-100 dark:bg-blue-500/10',
        text: 'text-blue-600 dark:text-blue-400',
      },
      href: '/blog/articles',
    },
    {
      title: t('categories'),
      value: stats.totalCategories.toString(),
      description: t('numberOfArticleCategories'),
      icon: FolderTree,
      color: 'green',
      colorClasses: {
        bg: 'bg-green-100 dark:bg-green-500/10',
        text: 'text-green-600 dark:text-green-400',
      },
      href: '/blog/categories',
    },
    {
      title: t('tags'),
      value: stats.totalTags.toString(),
      description: t('numberOfArticleTags'),
      icon: Tag,
      color: 'purple',
      colorClasses: {
        bg: 'bg-purple-100 dark:bg-purple-500/10',
        text: 'text-purple-600 dark:text-purple-400',
      },
      href: '/blog/tags',
    },
    {
      title: t('pendingComments'),
      value: stats.pendingComments.toString(),
      description: t('commentsAwaitingModeration'),
      icon: MessageSquare,
      color: 'amber',
      colorClasses: {
        bg: 'bg-amber-100 dark:bg-amber-500/10',
        text: 'text-amber-600 dark:text-amber-400',
      },
      href: '/blog/comments',
    },
  ];

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin mx-auto text-primary" />
          <p className="mt-4 text-sm text-muted-foreground">
            {t('loadingBlogDashboard')}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('pageTitle')}
        description={t('pageDescription')}
        buttonText={t('writeNewArticle')}
        buttonOnClick={() => {
          setIsArticleModalOpen(true);
        }}
        buttonPrefixIcon={<FileText size={18} />}
      />

      {/* Stats Overview */}
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
        {dashboardStats.map((stat) => {
          const Icon = stat.icon;
          return (
            <Link key={stat.title} href={stat.href}>
              <Card className="hover:shadow-lg transition-all duration-300 cursor-pointer border border-gray-100 dark:border-white/5">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-500 dark:text-gray-400">
                      {stat.title}
                    </p>
                    <p className="mt-2 text-3xl font-bold text-gray-900 dark:text-white">
                      {stat.value}
                    </p>
                    <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                      {stat.description}
                    </p>
                  </div>
                  <div className={`p-3 rounded-full ${stat.colorClasses.bg}`}>
                    <Icon className={`h-6 w-6 ${stat.colorClasses.text}`} />
                  </div>
                </div>
              </Card>
            </Link>
          );
        })}
      </div>

      {/* Recent Articles */}
      <Card
        title={t('recentArticles')}
        action={
          <Link
            href="/blog/articles"
            className="text-sm font-medium text-primary-600 dark:text-primary-400 hover:underline"
          >
            {t('viewAll')}
          </Link>
        }
      >
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-100 dark:border-white/5">
                <th className="text-left py-3 px-4 text-sm font-medium text-gray-500 dark:text-gray-400">
                  {t('article')}
                </th>
                <th className="text-left py-3 px-4 text-sm font-medium text-gray-500 dark:text-gray-400">
                  {t('status')}
                </th>
                <th className="text-left py-3 px-4 text-sm font-medium text-gray-500 dark:text-gray-400">
                  {t('views')}
                </th>
                <th className="text-left py-3 px-4 text-sm font-medium text-gray-500 dark:text-gray-400">
                  {t('comments')}
                </th>
                <th className="text-left py-3 px-4 text-sm font-medium text-gray-500 dark:text-gray-400">
                  {t('published')}
                </th>
              </tr>
            </thead>
            <tbody>
              {recentArticles.map((article) => (
                <tr
                  key={article.id}
                  className="border-b border-gray-50 dark:border-white/5 hover:bg-gray-50 dark:hover:bg-white/5"
                >
                  <td className="py-3 px-4">
                    <div className="font-medium text-gray-900 dark:text-white">
                      <LocalizedText value={article.title} />
                    </div>
                  </td>
                  <td className="py-3 px-4">
                    {getStatusBadge(article.status)}
                  </td>
                  <td className="py-3 px-4">
                    <div className="flex items-center text-gray-600 dark:text-gray-300">
                      <Eye className="h-4 w-4 mr-1" />
                      {(article.views || 0).toLocaleString()}
                    </div>
                  </td>
                  <td className="py-3 px-4">
                    <div className="flex items-center text-gray-600 dark:text-gray-300">
                      <MessageSquare className="h-4 w-4 mr-1" />
                      {article.comments || 0}
                    </div>
                  </td>
                  <td className="py-3 px-4 text-gray-600 dark:text-gray-300">
                    {article.publishedAt || t('notPublished')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Blog Performance */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title={t('topPerformingArticles')}>
          <div className="space-y-4">
            {topArticles.map((article, index) => (
              <div
                key={index}
                className="flex items-center justify-between p-3 rounded-lg bg-gray-50 dark:bg-white/5"
              >
                <div className="flex items-center space-x-3">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary-100 dark:bg-primary-500/10">
                    <span className="text-sm font-medium text-primary-600 dark:text-primary-400">
                      {index + 1}
                    </span>
                  </div>
                  <div>
                    <p className="font-medium text-gray-900 dark:text-white">
                      <LocalizedText value={article.title} />
                    </p>
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                      {article.views.toLocaleString()} views
                    </p>
                  </div>
                </div>
                <Badge color="green">{article.growth}</Badge>
              </div>
            ))}
          </div>
        </Card>

        <Card title={t('recentActivity')}>
          <div className="space-y-4">
            <div className="flex items-start space-x-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-100 dark:bg-blue-500/10">
                <FileText className="h-4 w-4 text-blue-600 dark:text-blue-400" />
              </div>
              <div className="flex-1">
                <p className="font-medium text-gray-900 dark:text-white">
                  {t('blogSystemReady')}
                </p>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  {t('backendApiReady')}
                </p>
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                  {t('justNow')}
                </p>
              </div>
            </div>
            <div className="flex items-start space-x-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-green-100 dark:bg-green-500/10">
                <Users className="h-4 w-4 text-green-600 dark:text-green-400" />
              </div>
              <div className="flex-1">
                <p className="font-medium text-gray-900 dark:text-white">
                  {t('welcomeToBlogSystem')}
                </p>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  {t('startCreatingFirstArticle')}
                </p>
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                  {t('justNow')}
                </p>
              </div>
            </div>
            <div className="flex items-start space-x-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-purple-100 dark:bg-purple-500/10">
                <TrendingUp className="h-4 w-4 text-purple-600 dark:text-purple-400" />
              </div>
              <div className="flex-1">
                <p className="font-medium text-gray-900 dark:text-white">
                  {t('analyticsDashboardAdded')}
                </p>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  {t('trackArticlePerformance')}
                </p>
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                  {t('hoursAgo')}
                </p>
              </div>
            </div>
          </div>
        </Card>
      </div>
      <BlogArticleModal
        isOpen={isArticleModalOpen}
        onCloseAction={() => setIsArticleModalOpen(false)}
        onSuccessAction={() => {
          fetchDashboardData();
          setIsArticleModalOpen(false);
        }}
      />
    </div>
  );
}
