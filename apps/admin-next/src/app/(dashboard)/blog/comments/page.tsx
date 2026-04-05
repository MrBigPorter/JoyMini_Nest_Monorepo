'use client';

import { useState, useEffect } from 'react';
import {
  MessageSquare,
  Search,
  Check,
  X,
  Trash2,
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

export default function CommentsPage() {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [articleFilter, setArticleFilter] = useState('all');
  const [comments, setComments] = useState<any[]>([]);
  const [articles, setArticles] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const { addToast } = useToastStore();

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
      addToast('error', 'Failed to load comments');
    } finally {
      setIsLoading(false);
    }
  };

  const fetchArticles = async () => {
    try {
      const response = await blogApi.getArticles({ pageSize: 50 });
      const articleOptions =
        response.list?.map((article: any) => ({
          id: article.id,
          title: article.title,
        })) || [];
      setArticles([{ id: 'all', title: 'All Articles' }, ...articleOptions]);
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
            Approved
          </span>
        );
      case 'PENDING':
        return (
          <span className="px-2 py-1 text-xs rounded-full bg-amber-100 text-amber-800">
            Pending
          </span>
        );
      case 'SPAM':
        return (
          <span className="px-2 py-1 text-xs rounded-full bg-red-100 text-red-800">
            Spam
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
      addToast('success', 'Comment approved successfully');
      fetchComments(); // Refresh the list
    } catch (error) {
      console.error('Failed to approve comment:', error);
      addToast('error', 'Failed to approve comment');
    }
  };

  const handleRejectComment = async (commentId: string) => {
    try {
      await blogApi.rejectComment(commentId);
      addToast('success', 'Comment rejected successfully');
      fetchComments(); // Refresh the list
    } catch (error) {
      console.error('Failed to reject comment:', error);
      addToast('error', 'Failed to reject comment');
    }
  };

  const handleDeleteComment = async (commentId: string) => {
    if (
      !window.confirm(
        'Are you sure you want to delete this comment? This action cannot be undone.',
      )
    ) {
      return;
    }

    try {
      await blogApi.deleteComment(commentId);
      addToast('success', 'Comment deleted successfully');
      fetchComments(); // Refresh the list
    } catch (error) {
      console.error('Failed to delete comment:', error);
      addToast('error', 'Failed to delete comment');
    }
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
            Loading comments...
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">
            Comment Management
          </h1>
          <p className="text-muted-foreground mt-2">
            Moderate and manage user comments on blog articles
          </p>
        </div>
      </div>

      {/* Stats */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-lg border bg-card p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground">Total Comments</p>
              <p className="text-2xl font-bold">{stats.total}</p>
            </div>
            <MessageSquare className="h-8 w-8 text-primary/50" />
          </div>
        </div>
        <div className="rounded-lg border bg-card p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground">Approved</p>
              <p className="text-2xl font-bold text-green-600">
                {stats.approved}
              </p>
            </div>
            <Check className="h-8 w-8 text-green-500/50" />
          </div>
        </div>
        <div className="rounded-lg border bg-card p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground">Pending</p>
              <p className="text-2xl font-bold text-amber-600">
                {stats.pending}
              </p>
            </div>
            <MessageSquare className="h-8 w-8 text-amber-500/50" />
          </div>
        </div>
        <div className="rounded-lg border bg-card p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground">Spam</p>
              <p className="text-2xl font-bold text-red-600">{stats.spam}</p>
            </div>
            <X className="h-8 w-8 text-red-500/50" />
          </div>
        </div>
      </div>

      {/* Search and Filters */}
      <div className="rounded-lg border bg-card p-6">
        <div className="flex flex-col md:flex-row gap-4">
          <div className="flex-1">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search comments by content or author..."
                className="w-full pl-9 pr-3 py-2 border border-input rounded-md bg-background text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              />
            </div>
          </div>
          <div className="flex gap-2">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="w-[140px] px-3 py-2 border border-input rounded-md bg-background text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              <option value="all">All Status</option>
              <option value="APPROVED">Approved</option>
              <option value="PENDING">Pending</option>
              <option value="SPAM">Spam</option>
              <option value="REJECTED">Rejected</option>
            </select>
            <select
              value={articleFilter}
              onChange={(e) => setArticleFilter(e.target.value)}
              className="w-[180px] px-3 py-2 border border-input rounded-md bg-background text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              {articles.map((article) => (
                <option key={article.id} value={article.id}>
                  {article.title}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Comments List */}
      <div className="rounded-lg border bg-card">
        <div className="p-6 border-b">
          <h2 className="text-lg font-semibold">Comment List</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Total {filteredComments.length} comments,{' '}
            {filteredComments.filter((c) => c.status === 'PENDING').length}{' '}
            pending moderation
          </p>
        </div>
        <div className="p-6">
          <div className="space-y-4">
            {filteredComments.map((comment) => (
              <div
                key={comment.id}
                className="rounded-lg border p-4 hover:shadow-sm transition-shadow"
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
                          className="p-1.5 rounded-md border border-green-200 bg-green-50 text-green-700 hover:bg-green-100"
                          title="Approve"
                        >
                          <Check className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => handleRejectComment(comment.id)}
                          className="p-1.5 rounded-md border border-red-200 bg-red-50 text-red-700 hover:bg-red-100"
                          title="Reject"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </>
                    )}
                    <button
                      onClick={() => handleDeleteComment(comment.id)}
                      className="p-1.5 rounded-md border border-input bg-background hover:bg-accent hover:text-accent-foreground text-destructive"
                      title="Delete"
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
                      target="_blank"
                      className="text-primary hover:underline"
                    >
                      {comment.article?.title || 'Unknown Article'}
                    </a>
                  </div>
                  <div className="flex items-center                    space-x-2">
                    <button className="text-xs text-muted-foreground hover:text-foreground">
                      <Eye className="mr-1 h-3 w-3 inline" />
                      View Article
                    </button>
                    <button className="text-xs text-muted-foreground hover:text-foreground">
                      Reply
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between">
        <div className="text-sm text-muted-foreground">
          Showing 1 to {filteredComments.length} of {filteredComments.length}{' '}
          comments
        </div>
        <div className="flex items-center space-x-2">
          <button
            className="px-3 py-1.5 text-sm rounded-md border border-input bg-background hover:bg-accent hover:text-accent-foreground disabled:opacity-50 disabled:cursor-not-allowed"
            disabled
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button className="px-3 py-1.5 text-sm rounded-md border border-input bg-background hover:bg-accent hover:text-accent-foreground">
            1
          </button>
          <button className="px-3 py-1.5 text-sm rounded-md border border-input bg-background hover:bg-accent hover:text-accent-foreground">
            2
          </button>
          <button className="px-3 py-1.5 text-sm rounded-md border border-input bg-background hover:bg-accent hover:text-accent-foreground">
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Moderation Tips */}
      <div className="rounded-lg border bg-card p-6">
        <h3 className="text-sm font-medium mb-3">Comment Moderation Tips</h3>
        <ul className="space-y-2 text-sm text-muted-foreground">
          <li className="flex items-start">
            <div className="mr-2 mt-0.5">•</div>
            <span>
              Review pending comments regularly to maintain engagement
            </span>
          </li>
          <li className="flex items-start">
            <div className="mr-2 mt-0.5">•</div>
            <span>
              Mark obvious spam comments to help improve automatic filtering
            </span>
          </li>
          <li className="flex items-start">
            <div className="mr-2 mt-0.5">•</div>
            <span>
              Consider replying to constructive comments to build community
            </span>
          </li>
          <li className="flex items-start">
            <div className="mr-2 mt-0.5">•</div>
            <span>
              Check IP addresses and user agents for suspicious patterns
            </span>
          </li>
          <li className="flex items-start">
            <div className="mr-2 mt-0.5">•</div>
            <span>
              Use the search feature to find comments by specific users
            </span>
          </li>
        </ul>
      </div>
    </div>
  );
}
