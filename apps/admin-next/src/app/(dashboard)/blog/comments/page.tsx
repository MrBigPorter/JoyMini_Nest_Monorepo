'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
  MessageSquare,
  Search,
  Check,
  X,
  Trash2,
  Edit,
  Eye,
  ChevronLeft,
  ChevronRight,
  User,
  Calendar,
  FileText,
  Loader2,
} from 'lucide-react';
import { useToastStore } from '@/store/useToastStore';
import { Card, Badge } from '@/components/UIComponents';
import { blogApi } from '@/api';
import { PageHeader } from '@/components/scaffold/PageHeader';
import { BlogCommentModal } from '@/views/blog/BlogCommentModal';
import { useTranslation } from '@/hooks/useTranslation';
import { renderLocalizedText } from '@/utils/localizedText';
import LocalizedText from '@/components/blog/LocalizedText';

export default function CommentsPage() {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [articleFilter, setArticleFilter] = useState('all');
  const [comments, setComments] = useState<any[]>([]);
  const [articles, setArticles] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingComment, setEditingComment] = useState<any>(null);
  const { addToast } = useToastStore();
  const router = useRouter();
  const { t: globalT, lang } = useTranslation();

  const t = (key: string, params?: Record<string, string | number>) =>
    globalT(`blog_comments_${key}`, params);

  const fetchComments = async () => {
    setIsLoading(true);
    try {
      const params: any = {};
      if (statusFilter !== 'all') {
        params.status = statusFilter;
      }
      if (articleFilter !== 'all') {
        params.articleId = articleFilter;
      }
      if (search) {
        params.search = search;
      }

      const response = await blogApi.getComments(params);
      setComments(response.list || []);
    } catch (error) {
      console.error('Failed to fetch comments:', error);
      addToast('error', t('loadFailed'));
    } finally {
      setIsLoading(false);
    }
  };

  const fetchArticles = async () => {
    try {
      const response = await blogApi.getArticles({ pageSize: 50 });
      const articleOptions =
        response.list?.map((article: any) => {
          // 将 Localized 格式的标题转换为字符串
          let titleStr = t('untitled');
            if (article.title) {
              titleStr = renderLocalizedText(article.title, lang, t('untitled'));
            }
          return {
            id: article.id,
            title: titleStr,
          };
        }) || [];
      setArticles([{ id: 'all', title: t('allArticles') }, ...articleOptions]);
    } catch (error) {
      console.error('Failed to fetch articles:', error);
      // Fallback to mock articles
    }
  };

  useEffect(() => {
    fetchComments();
    fetchArticles();
  }, []);

  useEffect(() => {
    // Debounce search
    const timer = setTimeout(() => {
      fetchComments();
    }, 500);

    return () => clearTimeout(timer);
  }, [search, statusFilter, articleFilter]);

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'APPROVED':
        return (
          <span className="px-2 py-1 text-xs rounded-full bg-green-100 text-green-800">
            {t('approved')}
          </span>
        );
      case 'PENDING':
        return (
          <span className="px-2 py-1 text-xs rounded-full bg-amber-100 text-amber-800">
            {t('pending')}
          </span>
        );
      case 'SPAM':
        return (
          <span className="px-2 py-1 text-xs rounded-full bg-red-100 text-red-800">
            {t('spam')}
          </span>
        );
      case 'REJECTED':
        return (
          <span className="px-2 py-1 text-xs rounded-full bg-gray-100 text-gray-800">
            Rejected
          </span>
        );
      default:
        return (
          <span className="px-2 py-1 text-xs rounded-full border">
            {status}
          </span>
        );
    }
  };

  const filteredComments = comments.filter((comment) => {
    if (
      search &&
      !comment.content.toLowerCase().includes(search.toLowerCase()) &&
      !comment.author.toLowerCase().includes(search.toLowerCase())
    ) {
      return false;
    }
    if (statusFilter !== 'all' && comment.status !== statusFilter) {
      return false;
    }
    return !(articleFilter !== 'all' && comment.article?.id !== articleFilter);
  });

  const handleApproveComment = async (commentId: string) => {
    try {
      await blogApi.approveComment(commentId);
      addToast('success', t('commentApproved'));
      fetchComments(); // Refresh the list
    } catch (error) {
      console.error('Failed to approve comment:', error);
      addToast('error', t('approveFailed'));
    }
  };

  const handleRejectComment = async (commentId: string) => {
    try {
      await blogApi.rejectComment(commentId);
      addToast('success', t('commentRejected'));
      fetchComments(); // Refresh the list
    } catch (error) {
      console.error('Failed to reject comment:', error);
      addToast('error', t('rejectFailed'));
    }
  };

  const handleDeleteComment = async (commentId: string) => {
    if (
      !window.confirm(t('deleteConfirm'))
    ) {
      return;
    }

    try {
      await blogApi.deleteComment(commentId);
      addToast('success', t('commentDeleted'));
      fetchComments(); // Refresh the list
    } catch (error) {
      console.error('Failed to delete comment:', error);
      addToast('error', t('deleteFailed'));
    }
  };

  const handleEditComment = (comment: any) => {
    setEditingComment(comment);
    setIsModalOpen(true);
  };

  const handleModalSuccess = () => {
    fetchComments();
  };

  const stats = {
    total: comments.length,
    approved: comments.filter((c) => c.status === 'APPROVED').length,
    pending: comments.filter((c) => c.status === 'PENDING').length,
    spam: comments.filter((c) => c.status === 'SPAM').length,
  };

  if (isLoading && comments.length === 0) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin mx-auto text-primary" />
          <p className="mt-4 text-sm text-muted-foreground">
            {t('loadingComments')}
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
        showBackButton={true}
        onBack={() => router.push('/blog')}
        breadcrumbs={['Blog', 'Comments']}
      />

      {/* Stats */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground">{t('totalComments')}</p>
              <p className="text-2xl font-bold">{stats.total}</p>
            </div>
            <MessageSquare className="h-8 w-8 text-primary/50" />
          </div>
        </Card>
        <Card>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground">{t('approved')}</p>
              <p className="text-2xl font-bold text-green-600">
                {stats.approved}
              </p>
            </div>
            <Check className="h-8 w-8 text-green-500/50" />
          </div>
        </Card>
        <Card>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground">{t('pending')}</p>
              <p className="text-2xl font-bold text-amber-600">
                {stats.pending}
              </p>
            </div>
            <MessageSquare className="h-8 w-8 text-amber-500/50" />
          </div>
        </Card>
        <Card>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground">{t('spam')}</p>
              <p className="text-2xl font-bold text-red-600">{stats.spam}</p>
            </div>
            <X className="h-8 w-8 text-red-500/50" />
          </div>
        </Card>

        <BlogCommentModal
          isOpen={isModalOpen}
          onCloseAction={() => setIsModalOpen(false)}
          editingComment={editingComment}
          onSuccessAction={handleModalSuccess}
        />
      </div>

      {/* Search and Filters */}
      <Card>
        <div className="flex flex-col md:flex-row gap-4">
          <div className="flex-1">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t('searchPlaceholder')}
                className="w-full pl-9 pr-3 py-2.5 border border-gray-200 dark:border-white/10 rounded-lg bg-gray-50 dark:bg-black/20 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/50 focus:border-primary-500 dark:text-white placeholder-gray-400 dark:placeholder-gray-600"
              />
            </div>
          </div>
          <div className="flex gap-2">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="w-[140px] px-3 py-2.5 border border-gray-200 dark:border-white/10 rounded-lg bg-gray-50 dark:bg-black/20 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/50 focus:border-primary-500 dark:text-white"
            >
              <option value="all">{t('allStatus')}</option>
              <option value="APPROVED">{t('approved')}</option>
              <option value="PENDING">{t('pending')}</option>
              <option value="SPAM">{t('spam')}</option>
              <option value="REJECTED">Rejected</option>
            </select>
            <select
              value={articleFilter}
              onChange={(e) => setArticleFilter(e.target.value)}
              className="w-[180px] px-3 py-2.5 border border-gray-200 dark:border-white/10 rounded-lg bg-gray-50 dark:bg-black/20 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/50 focus:border-primary-500 dark:text-white"
            >
              {articles.map((article) => (
                <option key={article.id} value={article.id}>
                  {article.title}
                </option>
              ))}
            </select>
          </div>
        </div>
      </Card>

      {/* Comments List */}
      <Card title={t('commentList')}>
        <div className="mb-4">
          <p className="text-sm text-muted-foreground">
            {t('totalCommentsCount', { count: filteredComments.length })}, {' '}
            {t('pendingModeration', { count: filteredComments.filter((c) => c.status === 'PENDING').length })}
          </p>
        </div>
        <div className="space-y-4">
          {filteredComments.map((comment) => (
            <div
              key={comment.id}
              className="rounded-xl border border-gray-100 dark:border-white/5 bg-white dark:bg-dark-800 p-6 hover:shadow-md transition-all duration-300 hover:border-gray-200 dark:hover:border-white/10"
            >
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-start space-x-3">
                  <div className="p-2 rounded-full bg-primary/10">
                    <User className="h-4 w-4 text-primary" />
                  </div>
                  <div>
                    <div className="flex items-center space-x-2">
                      <h3 className="font-semibold">{comment.author}</h3>
                      {comment.email && (
                        <span className="text-sm text-muted-foreground">
                          {comment.email}
                        </span>
                      )}
                      {getStatusBadge(comment.status)}
                    </div>
                    <div className="flex items-center space-x-4 mt-1 text-xs text-muted-foreground">
                      <div className="flex items-center">
                        <Calendar className="mr-1 h-3 w-3" />
                        {comment.createdAt}
                      </div>
                      <div>{comment.ipAddress}</div>
                    </div>
                  </div>
                </div>
                <div className="flex items-center space-x-1">
                  {comment.status === 'PENDING' && (
                    <>
                      <button
                        onClick={() => handleApproveComment(comment.id)}
                        className="p-1.5 rounded-lg border border-green-200 dark:border-green-800/30 bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 hover:bg-green-100 dark:hover:bg-green-900/30 transition-colors"
                        title={t('approve')}
                      >
                        <Check className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => handleRejectComment(comment.id)}
                        className="p-1.5 rounded-lg border border-red-200 dark:border-red-800/30 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/30 transition-colors"
                        title={t('reject')}
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </>
                  )}
                  <button
                    onClick={() => handleEditComment(comment)}
                    className="p-1.5 rounded-lg border border-gray-200 dark:border-white/10 bg-white dark:bg-black/20 hover:bg-gray-50 dark:hover:bg-white/5 text-gray-700 dark:text-gray-200 transition-colors"
                    title={t('edit')}
                  >
                    <Edit className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => handleDeleteComment(comment.id)}
                    className="p-1.5 rounded-lg border border-gray-200 dark:border-white/10 bg-white dark:bg-black/20 hover:bg-gray-50 dark:hover:bg-white/5 text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 transition-colors"
                    title={t('delete')}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>

              <div className="mb-3">
                <p className="text-sm">{comment.content}</p>
              </div>

              <div className="flex items-center justify-between border-t pt-3">
                <div className="flex items-center text-sm text-muted-foreground">
                  <FileText className="mr-2 h-4 w-4" />
                  <a
                    href={`/blog/articles/${comment.article?.slug}`}
                    className="text-primary hover:underline"
                  >
                    {comment.article?.title || t('unknownArticle')}
                  </a>
                </div>
                <div className="flex items-center space-x-2">
                  <button className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 dark:border-white/10 bg-white dark:bg-black/20 hover:bg-gray-50 dark:hover:bg-white/5 text-gray-700 dark:text-gray-200 transition-colors">
                    <Eye className="mr-1 h-3 w-3 inline" />
                    {t('viewArticle')}
                  </button>
                  <button className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 dark:border-white/10 bg-white dark:bg-black/20 hover:bg-gray-50 dark:hover:bg-white/5 text-gray-700 dark:text-gray-200 transition-colors">
                    {t('reply')}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </Card>

      {/* Pagination */}
      <div className="flex items-center justify-between">
        <div className="text-sm text-muted-foreground">
          {t('showingComments', { current: filteredComments.length, total: filteredComments.length })}
        </div>
        <div className="flex items-center space-x-2">
          <button
            className="px-3 py-1.5 text-sm rounded-lg border border-gray-200 dark:border-white/10 bg-white dark:bg-black/20 hover:bg-gray-50 dark:hover:bg-white/5 text-gray-700 dark:text-gray-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            disabled
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button className="px-3 py-1.5 text-sm rounded-lg border border-gray-200 dark:border-white/10 bg-white dark:bg-black/20 hover:bg-gray-50 dark:hover:bg-white/5 text-gray-700 dark:text-gray-200 transition-colors">
            1
          </button>
          <button className="px-3 py-1.5 text-sm rounded-lg border border-gray-200 dark:border-white/10 bg-white dark:bg-black/20 hover:bg-gray-50 dark:hover:bg-white/5 text-gray-700 dark:text-gray-200 transition-colors">
            2
          </button>
          <button className="px-3 py-1.5 text-sm rounded-lg border border-gray-200 dark:border-white/10 bg-white dark:bg-black/20 hover:bg-gray-50 dark:hover:bg-white/5 text-gray-700 dark:text-gray-200 transition-colors">
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Moderation Tips */}
      <Card title={t('moderationTips')}>
        <ul className="space-y-2 text-sm text-muted-foreground">
          <li className="flex items-start">
            <div className="mr-2 mt-0.5">•</div>
            <span>{t('tip1')}</span>
          </li>
          <li className="flex items-start">
            <div className="mr-2 mt-0.5">•</div>
            <span>{t('tip2')}</span>
          </li>
          <li className="flex items-start">
            <div className="mr-2 mt-0.5">•</div>
            <span>{t('tip3')}</span>
          </li>
          <li className="flex items-start">
            <div className="mr-2 mt-0.5">•</div>
            <span>{t('tip4')}</span>
          </li>
          <li className="flex items-start">
            <div className="mr-2 mt-0.5">•</div>
            <span>{t('tip5')}</span>
          </li>
        </ul>
      </Card>
    </div>
  );
}
