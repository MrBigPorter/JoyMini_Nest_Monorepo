'use client';

import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  Plus,
  Eye,
  Edit,
  Trash2,
  Calendar,
  User,
  FileText,
  MessageSquare,
} from 'lucide-react';
import { useToastStore } from '@/store/useToastStore';
import { Card, Badge } from '@/components/UIComponents';
import { useMutation } from '@tanstack/react-query';

import { blogApi } from '@/api';
import { PageHeader } from '@/components/scaffold/PageHeader';
import { SmartTable } from '@/components/scaffold/SmartTable';
import { Button, ModalManager } from '@repo/ui';
import { BlogArticleModal } from '@/views/blog/BlogArticleModal';
import LocalizedText from '@/components/blog/LocalizedText';
import { renderLocalizedText } from '@/utils/localizedText';
import type { ArticleFormInputs } from '@/schema/blog';
import type {
  ProColumns,
  ActionType,
} from '@/components/scaffold/SmartTable/types';
import type { FormSchema } from '@/type/search';

type Article = Partial<ArticleFormInputs> & {
  id: string;
  slug: string;
  views?: number;
  comments?: number;
  publishedAt?: string;
  category?: { id: string; name: string };
  author?: { username?: string; realName?: string };
  tags?: string[];
  viewCount?: number;
  commentCount?: number;
  readTime?: string;
};

interface SearchParams {
  search?: string;
  status?: string;
  category?: string;
  current?: number;
  pageSize?: number;
}

export default function ArticlesPageV2() {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingArticle, setEditingArticle] = useState<Article | null>(null);
  const { addToast } = useToastStore();
  const router = useRouter();
  const actionRef = useRef<ActionType>(null);

  // 删除文章 mutation
  const deleteArticleMutation = useMutation({
    mutationFn: (id: string) => blogApi.deleteArticle(id),
    onSuccess: () => {
      addToast('success', 'Article deleted successfully');
      actionRef.current?.reload();
    },
    onError: (error: Error) => {
      console.error('Failed to delete article:', error);
      addToast('error', 'Failed to delete article');
    },
  });

  // 发布文章 mutation
  const publishArticleMutation = useMutation({
    mutationFn: (id: string) => blogApi.publishArticle(id),
    onSuccess: () => {
      addToast('success', 'Article published successfully');
      actionRef.current?.reload();
    },
    onError: (error: Error) => {
      console.error('Failed to publish article:', error);
      addToast('error', 'Failed to publish article');
    },
  });

  // 取消发布文章 mutation
  const unpublishArticleMutation = useMutation({
    mutationFn: (id: string) => blogApi.unpublishArticle(id),
    onSuccess: () => {
      addToast('success', 'Article unpublished successfully');
      actionRef.current?.reload();
    },
    onError: (error: Error) => {
      console.error('Failed to unpublish article:', error);
      addToast('error', 'Failed to unpublish article');
    },
  });

  // 分类状态
  const [categories, setCategories] = useState<{ id: string; name: string }[]>(
    [],
  );

  // 获取分类数据
  useEffect(() => {
    const fetchCategories = async () => {
      try {
        const res = await blogApi.getCategories();
        setCategories(res.list || []);
      } catch (error) {
        console.error('Failed to fetch categories:', error);
        // 可选：显示 toast 提示
      }
    };
    fetchCategories();
  }, []);

  // 状态徽章（后端返回大写，前端显示小写）
  const getStatusBadge = (status: string | undefined) => {
    // 后端返回大写状态，转换为小写显示
    const normalizedStatus = status?.toLowerCase() || '';
    switch (normalizedStatus) {
      case 'published':
        return <Badge color="green">Published</Badge>;
      case 'draft':
        return <Badge color="gray">Draft</Badge>;
      case 'archived':
        return <Badge color="blue">Archived</Badge>;
      default:
        return <Badge color="gray">{normalizedStatus}</Badge>;
    }
  };

  // 删除文章确认
  const handleDeleteArticle = async (article: Article) => {
    ModalManager.open({
      title: 'Delete Article?',
      confirmText: 'Delete',
      cancelText: 'Cancel',
      renderChildren: (
        <div className="space-y-3">
          <p>
            Are you sure you want to delete article{' '}
            <span className="font-bold text-primary-600">
              <LocalizedText value={article.title} />
            </span>
            ?
          </p>

          <div className="text-sm text-amber-600 bg-amber-50 p-3 rounded-lg border border-amber-200">
            <div className="font-semibold mb-1">
              ⚠️ This action cannot be undone.
            </div>
            <div className="mt-2">
              This article has{' '}
              <span className="font-bold">{article.views || 0}</span> views and{' '}
              <span className="font-bold">{article.comments || 0}</span>{' '}
              comments.
              <br />
              All associated data will be permanently deleted.
            </div>
          </div>

          <div className="text-xs text-gray-500 mt-2 bg-gray-50 p-2 rounded">
            <div className="font-medium">Article Details:</div>
            <div>
              Slug: <code>/{article.slug}</code>
            </div>
            <div>Status: {article.status}</div>
            <div>
              Category:{' '}
              {article.category?.name
                ? renderLocalizedText(
                    article.category.name,
                    'zh',
                    'Uncategorized',
                  )
                : 'Uncategorized'}
            </div>
            {article.author && (
              <div>
                Author:{' '}
                {article.author.username || article.author.realName || 'Admin'}
              </div>
            )}
          </div>
        </div>
      ),
      onConfirm: () => {
        deleteArticleMutation.mutate(article.id);
      },
    });
  };

  // 编辑文章
  const handleEditArticle = (article: Article) => {
    setEditingArticle(article);
    setIsModalOpen(true);
  };

  // 发布文章
  const handlePublishArticle = async (article: Article) => {
    ModalManager.open({
      title: 'Publish Article?',
      confirmText: 'Publish',
      cancelText: 'Cancel',
      renderChildren: (
        <div className="space-y-3">
          <p>
            Are you sure you want to publish{' '}
            <span className="font-bold text-primary-600">
              <LocalizedText value={article.title} />
            </span>
            ?
          </p>

          <div className="text-sm text-green-600 bg-green-50 p-3 rounded-lg border border-green-200">
            <div className="font-semibold mb-1">
              📢 Article will be publicly visible
            </div>
            <div className="mt-2">
              Once published, this article will be accessible to all users.
              <br />
              You can unpublish it later if needed.
            </div>
          </div>
        </div>
      ),
      onConfirm: () => {
        publishArticleMutation.mutate(article.id);
      },
    });
  };

  // 取消发布文章
  const handleUnpublishArticle = async (article: Article) => {
    ModalManager.open({
      title: 'Unpublish Article?',
      confirmText: 'Unpublish',
      cancelText: 'Cancel',
      renderChildren: (
        <div className="space-y-3">
          <p>
            Are you sure you want to unpublish{' '}
            <span className="font-bold text-primary-600">
              <LocalizedText value={article.title} />
            </span>
            ?
          </p>

          <div className="text-sm text-amber-600 bg-amber-50 p-3 rounded-lg border border-amber-200">
            <div className="font-semibold mb-1">
              ⚠️ Article will be hidden from public
            </div>
            <div className="mt-2">
              This article will no longer be visible to users.
              <br />
              Existing views and comments will be preserved.
            </div>
          </div>
        </div>
      ),
      onConfirm: () => {
        unpublishArticleMutation.mutate(article.id);
      },
    });
  };

  // SmartTable 列定义
  const articleColumns: ProColumns[] = [
    {
      dataIndex: 'title',
      title: 'Article',
      render: (dom, article: Article) => (
        <div>
          <div className="font-medium text-gray-900 dark:text-white">
            <LocalizedText value={article.title} />
          </div>
          <div className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            /{article.slug}
          </div>
          <div className="flex items-center gap-3 mt-2">
            <div className="flex items-center text-xs text-gray-500 dark:text-gray-400">
              <User className="h-3 w-3 mr-1" />
              {article.author?.username || article.author?.realName || 'Admin'}
            </div>
            <div className="flex items-center text-xs text-gray-500 dark:text-gray-400">
              <Calendar className="h-3 w-3 mr-1" />
              {article.readTime || '5 min'}
            </div>
          </div>
        </div>
      ),
    },
    {
      dataIndex: 'status',
      title: 'Status',
      render: (dom, article: Article) => getStatusBadge(article.status ?? ''),
    },
    {
      dataIndex: 'category',
      title: 'Category',
      render: (dom, article: Article) => (
        <span className="px-2.5 py-1 text-xs rounded-full bg-gray-100 dark:bg-white/5 text-gray-700 dark:text-gray-300">
          {article.category?.name
            ? renderLocalizedText(article.category.name, 'zh', 'Uncategorized')
            : 'Uncategorized'}
        </span>
      ),
    },
    {
      dataIndex: 'tags',
      title: 'Tags',
      render: (dom, article: Article) => (
        <div className="flex flex-wrap gap-1">
          {(article.tags || []).map((tag: string | undefined) => (
            <span
              key={tag ?? ''}
              className="px-2 py-1 text-xs rounded-md border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-black/20 text-gray-600 dark:text-gray-300"
            >
              {tag}
            </span>
          ))}
        </div>
      ),
    },
    {
      dataIndex: 'metrics',
      title: 'Metrics',
      render: (dom, article: Article) => (
        <div className="space-y-1">
          <div className="flex items-center text-sm">
            <Eye className="h-3 w-3 mr-1 text-gray-400" />
            <span className="text-gray-700 dark:text-gray-300">
              {(article.views || 0).toLocaleString()}
            </span>
            <span className="text-gray-500 dark:text-gray-400 ml-1">views</span>
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
      ),
    },
    {
      dataIndex: 'publishedAt',
      title: 'Published',
      render: (dom, article: Article) => (
        <div className="text-sm text-gray-700 dark:text-gray-300">
          {article.publishedAt || (
            <span className="text-gray-400 dark:text-gray-500">
              Not published
            </span>
          )}
        </div>
      ),
    },
    {
      dataIndex: 'actions',
      title: 'Actions',
      render: (dom, article: Article) => (
        <div className="flex justify-end gap-2">
          <Link
            href={`/blog/articles/${article.slug}`}
            className="inline-flex items-center px-3 py-1.5 text-sm rounded-lg border border-gray-200 dark:border-white/10 bg-white dark:bg-black/20 hover:bg-gray-50 dark:hover:bg-white/5 transition-colors text-gray-700 dark:text-gray-300"
          >
            <Eye className="h-4 w-4 mr-1" />
            Preview
          </Link>
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleEditArticle(article)}
          >
            <Edit className="h-4 w-4 mr-1" />
            Edit
          </Button>
          {article.status === 'PUBLISHED' ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleUnpublishArticle(article)}
              className="text-amber-600 hover:text-amber-700 border-amber-200 hover:border-amber-300"
            >
              Unpublish
            </Button>
          ) : (
            <Button
              variant="outline"
              size="sm"
              onClick={() => handlePublishArticle(article)}
              className="text-green-600 hover:text-green-700 border-green-200 hover:border-green-300"
            >
              Publish
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleDeleteArticle(article)}
            className="text-destructive hover:text-destructive"
          >
            <Trash2 className="h-4 w-4 mr-1" />
            Delete
          </Button>
        </div>
      ),
    },
  ];

  // 搜索表单配置
  const searchSchema = useMemo<FormSchema[]>(
    () => [
      {
        type: 'input',
        key: 'search',
        label: 'Search',
        placeholder: 'Search article titles or content...',
      },
      {
        type: 'select',
        key: 'status',
        label: 'Status',
        placeholder: 'All Status',
        options: [
          { label: 'All Status', value: '' },
          { label: 'Published', value: 'PUBLISHED' },
          { label: 'Draft', value: 'DRAFT' },
          { label: 'Archived', value: 'ARCHIVED' },
        ],
      },
      {
        type: 'select',
        key: 'category',
        label: 'Category',
        placeholder: 'All Categories',
        options: [
          { label: 'All Categories', value: '' },
          ...categories.map((cat) => ({
            label: renderLocalizedText(cat.name, 'zh', cat.id),
            value: cat.id,
          })),
        ],
      },
    ],
    [categories],
  );

  // 请求文章数据
  const requestArticles = useCallback(async (params: SearchParams) => {
    try {
      // 转换 status 值为大写（后端要求大写）
      const status = params.status ? params.status.toUpperCase() : undefined;

      const response = await blogApi.getArticles({
        search: params.search,
        status: status,
        categoryId: params.category || undefined,
        page: params.current,
        pageSize: params.pageSize,
      });

      // 转换API数据格式为前端期望的格式
      const transformedList = (response.list || []).map((article: Article) => ({
        ...article,
        // API返回 viewCount，前端期望 views
        views: article.viewCount || 0,
        // API返回 commentCount，前端期望 comments
        comments: article.commentCount || 0,
        // 确保readTime有默认值
        readTime: article.readTime || '5 min',
        // 转换tags格式：从标签对象数组转换为标签名称数组
        tags: (article.tags || [])
          .map((tag: string | { name?: any; id?: string }) =>
            typeof tag === 'string'
              ? tag
              : renderLocalizedText(tag.name, 'zh', tag.id || ''),
          )
          .filter(Boolean),
      }));

      return {
        data: transformedList,
        total: response.total || 0,
        success: true,
      };
    } catch (error) {
      console.error('Failed to fetch articles:', error);
      // 返回空数据而非错误，保持UI可用
      return { data: [], total: 0, success: false };
    }
  }, []);

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
          setEditingArticle(null);
          setIsModalOpen(true);
        }}
        buttonPrefixIcon={<Plus size={18} />}
      />

      <BlogArticleModal
        isOpen={isModalOpen}
        onCloseAction={() => setIsModalOpen(false)}
        editingArticle={editingArticle as any}
        onSuccessAction={() => {
          actionRef.current?.reload();
        }}
      />

      {/* Articles Table */}
      <Card title="Article List">
        <SmartTable
          ref={actionRef}
          rowKey="id"
          columns={articleColumns}
          request={requestArticles}
          searchSchema={searchSchema}
          headerTitle={
            <div className="flex items-center gap-2">
              <FileText className="text-primary-500" size={20} />
              <span className="font-semibold text-lg">Articles</span>
            </div>
          }
        />
      </Card>
    </div>
  );
}
