'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Plus,
  Search,
  Filter,
  Eye,
  Edit,
  Trash2,
  ChevronLeft,
  ChevronRight,
  Download,
  Calendar,
  User,
  FileText,
  MessageSquare,
  Loader2,
} from 'lucide-react';
import { PageHeader } from '@/components/scaffold/PageHeader';
import { Card, Badge } from '@/components/UIComponents';
import { useToastStore } from '@/store/useToastStore';
import { blogApi } from '@/api';
import type { Article } from '@/type/types';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

export default function ArticlesPage() {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [currentPage, setCurrentPage] = useState(1);
  const { addToast } = useToastStore();
  const router = useRouter();
  const queryClient = useQueryClient();

  const pageSize = 10;

  // 构建查询参数
  const queryParams = {
    page: currentPage,
    pageSize,
    status: statusFilter !== 'all' ? statusFilter : undefined,
    search: search || undefined,
  };

  // 查询文章列表
  const {
    data: articlesData,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ['blog', 'articles', queryParams],
    queryFn: async () => {
      const response = await blogApi.getArticles(queryParams);
      return response;
    },
  });

  // 从响应中提取数据
  const articles = articlesData?.list || [];
  const totalArticles = articlesData?.total || 0;
  const totalPages = articlesData?.totalPages || 1;

  // 错误处理
  useEffect(() => {
    if (error) {
      console.error('Failed to fetch articles:', error);
      addToast('error', 'Failed to load articles');
    }
  }, [error, addToast]);

  // 当搜索条件变化时，如果当前不是第一页，则跳转到第一页
  useEffect(() => {
    const timer = setTimeout(() => {
      if (currentPage !== 1) {
        setCurrentPage(1);
      } else {
        refetch();
      }
    }, 500);

    return () => clearTimeout(timer);
  }, [search, refetch, currentPage]);

  // 删除文章 mutation
  const deleteArticleMutation = useMutation({
    mutationFn: (id: string) => blogApi.deleteArticle(id),
    onSuccess: () => {
      addToast('success', 'Article deleted successfully');
      // 使文章列表查询失效，触发重新获取
      queryClient.invalidateQueries({ queryKey: ['blog', 'articles'] });
    },
    onError: (error: any) => {
      console.error('Failed to delete article:', error);
      addToast('error', 'Failed to delete article');
    },
  });

  // 发布文章 mutation
  const publishArticleMutation = useMutation({
    mutationFn: (id: string) => blogApi.publishArticle(id),
    onSuccess: () => {
      addToast('success', 'Article published successfully');
      queryClient.invalidateQueries({ queryKey: ['blog', 'articles'] });
    },
    onError: (error: any) => {
      console.error('Failed to publish article:', error);
      addToast('error', 'Failed to publish article');
    },
  });

  // 取消发布文章 mutation
  const unpublishArticleMutation = useMutation({
    mutationFn: (id: string) => blogApi.unpublishArticle(id),
    onSuccess: () => {
      addToast('success', 'Article unpublished successfully');
      queryClient.invalidateQueries({ queryKey: ['blog', 'articles'] });
    },
    onError: (error: any) => {
      console.error('Failed to unpublish article:', error);
      addToast('error', 'Failed to unpublish article');
    },
  });

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

  const handleDeleteArticle = async (id: string) => {
    if (!confirm('Are you sure you want to delete this article?')) {
      return;
    }
    deleteArticleMutation.mutate(id);
  };

  const handlePublishArticle = async (id: string) => {
    publishArticleMutation.mutate(id);
  };

  const handleUnpublishArticle = async (id: string) => {
    unpublishArticleMutation.mutate(id);
  };

  const filteredArticles = articles.filter((article) => {
    if (categoryFilter !== 'all' && article.category !== categoryFilter) {
      return false;
    }
    return true;
  });

  const categories = Array.from(new Set(articles.map((a) => a.category)));

  const publishedArticles = articles.filter((a) => a.status === 'published');
  const totalViews = articles.reduce((sum, a) => sum + (a.views || 0), 0);

  if (isLoading && articles.length === 0) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin mx-auto text-primary" />
          <p className="mt-4 text-sm text-muted-foreground">
            Loading articles...
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Article Management"
        description="Manage blog articles including creation, editing, publishing, and deletion"
        showBackButton={true}
        onBack={() => router.push('/blog')}
        breadcrumbs={['Blog', 'Articles']}
        buttonText="New Article"
        buttonOnClick={() => {
          router.push('/blog/articles/create');
        }}
        buttonPrefixIcon={<Plus size={18} />}
      />

      {/* Search and Filters */}
      <Card>
        <div className="flex flex-col md:flex-row gap-4">
          <div className="flex-1">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search article titles or content..."
                className="w-full pl-9 pr-3 py-2.5 border border-gray-200 dark:border-white/10 rounded-lg bg-gray-50 dark:bg-black/20 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/50 focus:border-primary-500 dark:text-white placeholder-gray-400 dark:placeholder-gray-600"
              />
            </div>
          </div>
          <div className="flex gap-2">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="px-3 py-2.5 border border-gray-200 dark:border-white/10 rounded-lg bg-gray-50 dark:bg-black/20 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/50 focus:border-primary-500 dark:text-white"
            >
              <option value="all">All Status</option>
              <option value="published">Published</option>
              <option value="draft">Draft</option>
              <option value="scheduled">Scheduled</option>
            </select>
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="px-3 py-2.5 border border-gray-200 dark:border-white/10 rounded-lg bg-gray-50 dark:bg-black/20 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/50 focus:border-primary-500 dark:text-white"
            >
              <option value="all">All Categories</option>
              {categories.map((category) => (
                <option key={category} value={category}>
                  {category}
                </option>
              ))}
            </select>
            <button className="px-4 py-2.5 text-sm font-medium rounded-lg border border-gray-200 dark:border-white/10 bg-white dark:bg-black/20 hover:bg-gray-50 dark:hover:bg-white/5 transition-colors flex items-center gap-2">
              <Filter className="h-4 w-4" />
              Filter
            </button>
            <button className="px-4 py-2.5 text-sm font-medium rounded-lg border border-gray-200 dark:border-white/10 bg-white dark:bg-black/20 hover:bg-gray-50 dark:hover:bg-white/5 transition-colors flex items-center gap-2">
              <Download className="h-4 w-4" />
              Export
            </button>
          </div>
        </div>
      </Card>

      {/* Articles Table */}
      <Card title={`Article List (${filteredArticles.length})`}>
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
                  Category
                </th>
                <th className="text-left py-3 px-4 text-sm font-medium text-gray-500 dark:text-gray-400">
                  Tags
                </th>
                <th className="text-left py-3 px-4 text-sm font-medium text-gray-500 dark:text-gray-400">
                  Metrics
                </th>
                <th className="text-left py-3 px-4 text-sm font-medium text-gray-500 dark:text-gray-400">
                  Published
                </th>
                <th className="text-right py-3 px-4 text-sm font-medium text-gray-500 dark:text-gray-400">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {filteredArticles.map((article) => (
                <tr
                  key={article.id}
                  className="border-b border-gray-50 dark:border-white/5 hover:bg-gray-50 dark:hover:bg-white/5 transition-colors"
                >
                  <td className="py-4 px-4">
                    <div>
                      <div className="font-medium text-gray-900 dark:text-white">
                        {article.title}
                      </div>
                      <div className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                        /{article.slug}
                      </div>
                      <div className="flex items-center gap-3 mt-2">
                        <div className="flex items-center text-xs text-gray-500 dark:text-gray-400">
                          <User className="h-3 w-3 mr-1" />
                          {article.author || 'Admin'}
                        </div>
                        <div className="flex items-center text-xs text-gray-500 dark:text-gray-400">
                          <Calendar className="h-3 w-3 mr-1" />
                          {article.readTime || '5 min'}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="py-4 px-4">
                    {getStatusBadge(article.status)}
                  </td>
                  <td className="py-4 px-4">
                    <span className="px-2.5 py-1 text-xs rounded-full bg-gray-100 dark:bg-white/5 text-gray-700 dark:text-gray-300">
                      {article.category || 'Uncategorized'}
                    </span>
                  </td>
                  <td className="py-4 px-4">
                    <div className="flex flex-wrap gap-1">
                      {(article.tags || []).map((tag: string) => (
                        <span
                          key={tag}
                          className="px-2 py-1 text-xs rounded-md border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-black/20 text-gray-600 dark:text-gray-300"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="py-4 px-4">
                    <div className="space-y-1">
                      <div className="flex items-center text-sm">
                        <Eye className="h-3 w-3 mr-1 text-gray-400" />
                        <span className="text-gray-700 dark:text-gray-300">
                          {(article.views || 0).toLocaleString()}
                        </span>
                        <span className="text-gray-500 dark:text-gray-400 ml-1">
                          views
                        </span>
                      </div>
                      <div className="flex items-center text-sm">
                        <MessageSquare className="h-3 w-3 mr-1 text-gray-400" />
                        <span className="text-gray-700 dark:text-gray-300">
                          {article.comments || 0}
                        </span>
                        <span className="text-gray-500 dark:text-gray-400 ml-1">
                          comments
                        </span>
                      </div>
                    </div>
                  </td>
                  <td className="py-4 px-4">
                    <div className="text-sm text-gray-700 dark:text-gray-300">
                      {article.publishedAt || (
                        <span className="text-gray-400 dark:text-gray-500">
                          Not published
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="py-4 px-4 text-right">
                    <div className="flex justify-end gap-2">
                      <Link
                        href={`/blog/articles/${article.slug}`}
                        target="_blank"
                        className="inline-flex items-center px-3 py-1.5 text-sm rounded-lg border border-gray-200 dark:border-white/10 bg-white dark:bg-black/20 hover:bg-gray-50 dark:hover:bg-white/5 transition-colors text-gray-700 dark:text-gray-300"
                      >
                        <Eye className="h-4 w-4 mr-1" />
                        Preview
                      </Link>
                      <Link
                        href={`/blog/articles/${article.id}/edit`}
                        className="inline-flex items-center px-3 py-1.5 text-sm rounded-lg border border-gray-200 dark:border-white/10 bg-white dark:bg-black/20 hover:bg-gray-50 dark:hover:bg-white/5 transition-colors text-gray-700 dark:text-gray-300"
                      >
                        <Edit className="h-4 w-4 mr-1" />
                        Edit
                      </Link>
                      {article.status === 'published' ? (
                        <button
                          onClick={() => handleUnpublishArticle(article.id)}
                          className="inline-flex items-center px-3 py-1.5 text-sm rounded-lg border border-amber-200 dark:border-amber-500/20 bg-amber-50 dark:bg-amber-500/10 hover:bg-amber-100 dark:hover:bg-amber-500/20 transition-colors text-amber-600 dark:text-amber-400"
                        >
                          Unpublish
                        </button>
                      ) : (
                        <button
                          onClick={() => handlePublishArticle(article.id)}
                          className="inline-flex items-center px-3 py-1.5 text-sm rounded-lg border border-green-200 dark:border-green-500/20 bg-green-50 dark:bg-green-500/10 hover:bg-green-100 dark:hover:bg-green-500/20 transition-colors text-green-600 dark:text-green-400"
                        >
                          Publish
                        </button>
                      )}
                      <button
                        onClick={() => handleDeleteArticle(article.id)}
                        className="inline-flex items-center px-3 py-1.5 text-sm rounded-lg border border-red-200 dark:border-red-500/20 bg-red-50 dark:bg-red-500/10 hover:bg-red-100 dark:hover:bg-red-500/20 transition-colors text-red-600 dark:text-red-400"
                      >
                        <Trash2 className="h-4 w-4 mr-1" />
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="flex items-center justify-between mt-6 pt-6 border-t border-gray-100 dark:border-white/5">
          <div className="text-sm text-gray-500 dark:text-gray-400">
            Showing {(currentPage - 1) * pageSize + 1} to{' '}
            {Math.min(currentPage * pageSize, totalArticles)} of {totalArticles}{' '}
            entries
          </div>
          <div className="flex items-center space-x-2">
            <button
              onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
              disabled={currentPage === 1}
              className="px-3 py-1.5 text-sm rounded-lg border border-gray-200 dark:border-white/10 bg-white dark:bg-black/20 hover:bg-gray-50 dark:hover:bg-white/5 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
              const pageNum = i + 1;
              return (
                <button
                  key={pageNum}
                  onClick={() => setCurrentPage(pageNum)}
                  className={`px-3 py-1.5 text-sm rounded-lg border ${
                    currentPage === pageNum
                      ? 'border-primary-500 bg-primary-50 dark:bg-primary-500/10 text-primary-600 dark:text-primary-400'
                      : 'border-gray-200 dark:border-white/10 bg-white dark:bg-black/20 hover:bg-gray-50 dark:hover:bg-white/5 transition-colors'
                  }`}
                >
                  {pageNum}
                </button>
              );
            })}
            <button
              onClick={() =>
                setCurrentPage((prev) => Math.min(totalPages, prev + 1))
              }
              disabled={currentPage === totalPages}
              className="px-3 py-1.5 text-sm rounded-lg border border-gray-200 dark:border-white/10 bg-white dark:bg-black/20 hover:bg-gray-50 dark:hover:bg-white/5 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      </Card>

      {/* Summary Stats */}
      <div className="grid gap-6 md:grid-cols-3">
        <Card>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-500 dark:text-gray-400">
                Total Articles
              </p>
              <p className="mt-2 text-3xl font-bold text-gray-900 dark:text-white">
                {totalArticles}
              </p>
            </div>
            <div className="p-3 rounded-full bg-blue-100 dark:bg-blue-500/10">
              <FileText className="h-6 w-6 text-blue-600 dark:text-blue-400" />
            </div>
          </div>
        </Card>
        <Card>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-500 dark:text-gray-400">
                Published Articles
              </p>
              <p className="mt-2 text-3xl font-bold text-gray-900 dark:text-white">
                {publishedArticles.length}
              </p>
            </div>
            <div className="p-3 rounded-full bg-green-100 dark:bg-green-500/10">
              <Eye className="h-6 w-6 text-green-600 dark:text-green-400" />
            </div>
          </div>
        </Card>
        <Card>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-500 dark:text-gray-400">
                Total Views
              </p>
              <p className="mt-2 text-3xl font-bold text-gray-900 dark:text-white">
                {totalViews.toLocaleString()}
              </p>
            </div>
            <div className="p-3 rounded-full bg-purple-100 dark:bg-purple-500/10">
              <Eye className="h-6 w-6 text-purple-600 dark:text-purple-400" />
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
