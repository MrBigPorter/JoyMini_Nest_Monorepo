'use client';

import { useState, useEffect } from 'react';
import {
  ArrowRight,
  FileText,
  FolderTree,
  Tag,
  MessageSquare,
  TrendingUp,
  Users,
  Eye,
  Clock,
  Loader2,
} from 'lucide-react';
import Link from 'next/link';
import { PageHeader } from '@/components/scaffold/PageHeader';
import { Card, Badge } from '@/components/UIComponents';
import { blogApi } from '@/api';

export default function BlogDashboardPage() {
  const [stats, setStats] = useState({
    totalArticles: 0,
    totalCategories: 0,
    totalTags: 0,
    pendingComments: 0,
  });
  const [recentArticles, setRecentArticles] = useState<any[]>([]);
  const [topArticles, setTopArticles] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);

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

      // Set top articles (mock for now)
      setTopArticles([
        {
          title: 'Next.js 15 New Features Explained',
          views: 1250,
          growth: '+12%',
        },
        {
          title: 'TypeScript Advanced Type Techniques',
          views: 890,
          growth: '+8%',
        },
        {
          title: 'Database Optimization Practices',
          views: 560,
          growth: '+5%',
        },
      ]);
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
      case 'PUBLISHED':
        return <Badge color="green">Published</Badge>;
      case 'DRAFT':
        return <Badge color="gray">Draft</Badge>;
      case 'SCHEDULED':
        return <Badge color="blue">Scheduled</Badge>;
      default:
        return <Badge color="gray">{status}</Badge>;
    }
  };

  const dashboardStats = [
    {
      title: 'Total Articles',
      value: stats.totalArticles.toString(),
      description: 'Number of published articles',
      icon: FileText,
      color: 'blue',
      colorClasses: {
        bg: 'bg-blue-100 dark:bg-blue-500/10',
        text: 'text-blue-600 dark:text-blue-400',
      },
      href: '/blog/articles',
    },
    {
      title: 'Categories',
      value: stats.totalCategories.toString(),
      description: 'Number of article categories',
      icon: FolderTree,
      color: 'green',
      colorClasses: {
        bg: 'bg-green-100 dark:bg-green-500/10',
        text: 'text-green-600 dark:text-green-400',
      },
      href: '/blog/categories',
    },
    {
      title: 'Tags',
      value: stats.totalTags.toString(),
      description: 'Number of article tags',
      icon: Tag,
      color: 'purple',
      colorClasses: {
        bg: 'bg-purple-100 dark:bg-purple-500/10',
        text: 'text-purple-600 dark:text-purple-400',
      },
      href: '/blog/tags',
    },
    {
      title: 'Pending Comments',
      value: stats.pendingComments.toString(),
      description: 'Comments awaiting moderation',
      icon: MessageSquare,
      color: 'amber',
      colorClasses: {
        bg: 'bg-amber-100 dark:bg-amber-500/10',
        text: 'text-amber-600 dark:text-amber-400',
      },
      href: '/blog/comments',
    },
  ];

  const quickActions = [
    {
      title: 'Write New Article',
      description: 'Create a new blog article',
      href: '/blog/articles/create',
      icon: FileText,
      color: 'bg-blue-500',
    },
    {
      title: 'Manage Categories',
      description: 'Add or edit article categories',
      href: '/blog/categories',
      icon: FolderTree,
      color: 'bg-green-500',
    },
    {
      title: 'Manage Tags',
      description: 'Add or edit article tags',
      href: '/blog/tags',
      icon: Tag,
      color: 'bg-purple-500',
    },
    {
      title: 'Moderate Comments',
      description: 'Review user-submitted comments',
      href: '/blog/comments',
      icon: MessageSquare,
      color: 'bg-amber-500',
    },
  ];

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin mx-auto text-primary" />
          <p className="mt-4 text-sm text-muted-foreground">
            Loading blog dashboard...
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Blog Management"
        description="Manage blog articles, categories, tags, and comments"
        buttonText="Write New Article"
        buttonOnClick={() => {
          window.location.href = '/blog/articles/create';
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

      {/* Quick Actions */}
      <Card title="Quick Actions">
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {quickActions.map((action) => {
            const Icon = action.icon;
            return (
              <Link key={action.title} href={action.href}>
                <div className="group p-4 rounded-lg border border-gray-100 dark:border-white/5 hover:border-primary-500 dark:hover:border-primary-500 hover:shadow-md transition-all duration-300 cursor-pointer">
                  <div className="flex items-center space-x-3">
                    <div
                      className={`p-2 rounded-lg ${action.color} text-white`}
                    >
                      <Icon className="h-5 w-5" />
                    </div>
                    <div className="flex-1">
                      <h4 className="font-medium text-gray-900 dark:text-white group-hover:text-primary-600 dark:group-hover:text-primary-400">
                        {action.title}
                      </h4>
                      <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                        {action.description}
                      </p>
                    </div>
                    <ArrowRight className="h-4 w-4 text-gray-400 dark:text-gray-500 group-hover:text-primary-500 transition-colors" />
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      </Card>

      {/* Recent Articles */}
      <Card
        title="Recent Articles"
        action={
          <Link
            href="/blog/articles"
            className="text-sm font-medium text-primary-600 dark:text-primary-400 hover:underline"
          >
            View All
          </Link>
        }
      >
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-100 dark:border-white/5">
                <th className="text-left py-3 px-4 text-sm font-medium text-gray-500 dark:text-gray-400">
                  Article
                </th>
                <th className="text-left py-3 px-4 text-sm font-medium text-gray-500 dark:text-gray-400">
                  Status
                </th>
                <th className="text-left py-3 px-4 text-sm font-medium text-gray-500 dark:text-gray-400">
                  Views
                </th>
                <th className="text-left py-3 px-4 text-sm font-medium text-gray-500 dark:text-gray-400">
                  Comments
                </th>
                <th className="text-left py-3 px-4 text-sm font-medium text-gray-500 dark:text-gray-400">
                  Published
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
                      {article.title}
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
                    {article.publishedAt || 'Not published'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Blog Performance */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Top Performing Articles">
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
                      {article.title}
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

        <Card title="Recent Activity">
          <div className="space-y-4">
            <div className="flex items-start space-x-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-100 dark:bg-blue-500/10">
                <FileText className="h-4 w-4 text-blue-600 dark:text-blue-400" />
              </div>
              <div className="flex-1">
                <p className="font-medium text-gray-900 dark:text-white">
                  Blog system is ready
                </p>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  Backend API fully implemented, ready to create content
                </p>
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                  Just now
                </p>
              </div>
            </div>
            <div className="flex items-start space-x-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-green-100 dark:bg-green-500/10">
                <Users className="h-4 w-4 text-green-600 dark:text-green-400" />
              </div>
              <div className="flex-1">
                <p className="font-medium text-gray-900 dark:text-white">
                  Welcome to the blog system
                </p>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  Start creating your first blog article
                </p>
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                  Just now
                </p>
              </div>
            </div>
            <div className="flex items-start space-x-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-purple-100 dark:bg-purple-500/10">
                <TrendingUp className="h-4 w-4 text-purple-600 dark:text-purple-400" />
              </div>
              <div className="flex-1">
                <p className="font-medium text-gray-900 dark:text-white">
                  Analytics dashboard added
                </p>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  Track article performance and user engagement
                </p>
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                  2 hours ago
                </p>
              </div>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
