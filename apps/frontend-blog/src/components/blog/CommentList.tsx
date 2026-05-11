'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import { useTranslations } from 'next-intl';
import {
  MessageSquare,
  Reply,
  MoreHorizontal,
  ChevronDown,
  ChevronUp,
  LogIn,
  Send,
  Loader2,
  CheckCircle,
  XCircle,
} from 'lucide-react';
import { useRouter } from '@/navigation';
import { usePostComment } from '@/lib/hooks/useComments';
import { useCommentsInfiniteQuerySimple } from '@/lib/hooks/useCommentsAdapter';
import { useAuth } from '@/lib/hooks/useAuth';
import { useCommentSSE } from '@/lib/hooks/useCommentSSE';
import { commentStatusManager, CommentStatus } from '@/lib/utils/commentStatus';
import type { Comment } from '@/lib/types/blog';
import { formatDistanceToNow } from 'date-fns';
import { getDateFnsLocale } from '@/lib/utils/date-locale';
import { useLocale } from 'next-intl';
import { InfiniteScrollLoader } from '@/components/shared/LoadingIndicator';
import { useInfiniteScrollDetectionSimple } from '@/lib/hooks/useInfiniteScrollDetection';

interface CommentListProps {
  /** 文章 slug，用于 REST API 调用（如获取评论列表） */
  articleId: string;
  /** 文章 DB ID，用于 SSE 端点过滤；若未提供则降级使用 articleId（slug） */
  articleDbId?: string;
}

interface CommentProps {
  comment: Comment;
  depth?: number;
  articleId: string;
}

function Comment({ comment, depth = 0, articleId }: CommentProps) {
  const t = useTranslations();
  const locale = useLocale();
  const { isAuthenticated } = useAuth();
  const router = useRouter();

  // 美观的回复展开策略：
  // - 顶级评论（depth=0）：直接回复超过1个就折叠
  // - 嵌套回复（depth>0）：回复超过2个就折叠
  const replyThreshold = depth === 0 ? 1 : 2;
  const [showReplies, setShowReplies] = useState(
    (comment?.children?.length || 0) <= replyThreshold,
  );
  const [showReplyInput, setShowReplyInput] = useState(false);
  const [replyContent, setReplyContent] = useState('');
  const { mutate: postComment, isPending: isPosting } =
    usePostComment(articleId);

  // 检查评论是否已加载完成（乐观更新的评论也算已加载）
  const isCommentLoaded =
    comment.id && (comment.approved || !comment.id.startsWith('temp-'));

  // 检查是否是乐观更新创建的临时评论
  const isOptimisticComment = comment.id && comment.id.startsWith('temp-');

  // 跟踪评论状态变化
  const [commentStatus, setCommentStatus] = useState<CommentStatus | null>(
    isOptimisticComment ? 'pending' : null,
  );
  const [isRemoved, setIsRemoved] = useState(false);
  const [isFadingOut, setIsFadingOut] = useState(false);

  // 订阅评论状态变化
  useEffect(() => {
    if (!isOptimisticComment) return;

    const unsubscribe = commentStatusManager.subscribe(comment.id, (status) => {
      setCommentStatus(status);

      // 如果评论被拒绝，开始淡出动画然后移除
      if (status === 'rejected') {
        setIsFadingOut(true);

        // 1秒后完全移除评论（淡出动画时间）
        setTimeout(() => {
          setIsRemoved(true);
        }, 1000);
      }
    });

    // 检查当前状态
    const currentStatus = commentStatusManager.getCommentStatus(comment.id);
    if (currentStatus) {
      setCommentStatus(currentStatus);
      if (currentStatus === 'rejected') {
        setIsRemoved(true);
      }
    }

    return () => {
      unsubscribe();
    };
  }, [comment.id, isOptimisticComment]);

  // 如果评论已被移除，不显示
  if (isRemoved) {
    return null;
  }

  const formatDate = (dateString: string) => {
    try {
      const date = new Date(dateString);
      return formatDistanceToNow(date, {
        addSuffix: true,
        locale: getDateFnsLocale(locale),
      });
    } catch {
      return dateString;
    }
  };

  const handleSubmitReply = () => {
    if (!replyContent.trim()) return;

    postComment(
      {
        content: replyContent,
        parentId: comment.id,
      },
      {
        onSuccess: () => {
          setReplyContent('');
          setShowReplyInput(false);
        },
      },
    );
  };

  // 如果评论已被移除，不渲染
  if (isRemoved) {
    return null;
  }

  return (
    <div
      className={`${depth > 0 ? 'ml-6' : ''} ${
        isFadingOut
          ? 'opacity-0 transition-opacity duration-1000 ease-out'
          : 'opacity-100 transition-opacity duration-300'
      }`}
    >
      <div className="flex gap-3 py-3">
        <div className="w-8 h-8 rounded-full flex-shrink-0 bg-primary/10 flex items-center justify-center">
          <span className="text-sm font-medium text-primary">
            {comment.author?.charAt(0)?.toUpperCase() || 'A'}
          </span>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div>
              <span className="font-medium text-foreground">
                {comment.author || 'Anonymous'}
              </span>
              <span className="text-xs text-muted-foreground ml-2">
                {formatDate(comment.createdAt)}
              </span>
            </div>
            <button className="text-muted-foreground hover:text-foreground opacity-60 hover:opacity-100 transition-opacity">
              <MoreHorizontal className="w-3.5 h-3.5" />
            </button>
          </div>

          <p className="mt-1.5 text-foreground leading-relaxed text-sm">
            {comment.content}
          </p>

          {/* 开发环境下显示评论状态提示（调试用） */}
          {process.env.NODE_ENV === 'development' &&
            isOptimisticComment &&
            commentStatus && (
              <div
                className={`mt-2 p-2 rounded text-xs ${
                  commentStatus === 'pending'
                    ? 'bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 text-yellow-800 dark:text-yellow-300'
                    : commentStatus === 'approved'
                      ? 'bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 text-green-800 dark:text-green-300'
                      : 'bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-800 dark:text-red-300'
                }`}
              >
                <div className="flex items-center gap-1.5">
                  {commentStatus === 'pending' && (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  )}
                  {commentStatus === 'approved' && (
                    <CheckCircle className="w-3 h-3" />
                  )}
                  {commentStatus === 'rejected' && (
                    <XCircle className="w-3 h-3" />
                  )}
                  <span>
                    {commentStatus === 'pending' && ''}
                    {commentStatus === 'approved' && ''}
                    {commentStatus === 'rejected' && ''}
                  </span>
                </div>
                <p className="mt-1 text-[11px] opacity-80">
                  {commentStatus === 'pending' && '审核通过后，评论将自动显示'}
                  {commentStatus === 'approved' && '您的评论已成功发布'}
                  {commentStatus === 'rejected' &&
                    '评论内容不符合社区规范，已自动移除'}
                </p>
              </div>
            )}

          <div className="flex items-center gap-3 mt-2">
            <button
              onClick={() => {
                if (!isAuthenticated) {
                  router.push('/login');
                  return;
                }
                setShowReplyInput(!showReplyInput);
              }}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-primary transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              disabled={!isCommentLoaded || isPosting}
              title={!isCommentLoaded ? t('comment.loadingComment') : ''}
            >
              <Reply className="w-3.5 h-3.5" />
              <span>{t('comment.reply')}</span>
              {!isCommentLoaded && (
                <Loader2 className="w-3 h-3 animate-spin ml-1" />
              )}
            </button>
          </div>

          {showReplyInput && isAuthenticated && (
            <div className="mt-3">
              <textarea
                placeholder={t('comment.writeReply')}
                className="w-full p-2.5 text-sm rounded-lg border border-border/50 bg-background resize-none focus:outline-none focus:ring-1 focus:ring-primary/30 focus:border-primary transition-all"
                rows={2}
                value={replyContent}
                onChange={(e) => setReplyContent(e.target.value)}
                disabled={isPosting}
              />
              <div className="flex justify-end gap-2 mt-2">
                <button
                  onClick={() => setShowReplyInput(false)}
                  className="px-3 py-1.5 rounded text-xs text-muted-foreground hover:bg-accent/50 transition-colors"
                  disabled={isPosting}
                >
                  {t('common.cancel')}
                </button>
                <button
                  onClick={handleSubmitReply}
                  className="px-3 py-1.5 rounded text-xs bg-primary text-primary-foreground hover:bg-primary/90 transition-colors flex items-center gap-1.5"
                  disabled={isPosting || !replyContent.trim()}
                >
                  {isPosting ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Send className="w-3.5 h-3.5" />
                  )}
                  {t('comment.submit')}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {comment.children && comment.children.length > 0 && (
        <div className="mt-2">
          <button
            onClick={() => setShowReplies(!showReplies)}
            className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-2"
          >
            {showReplies ? (
              <ChevronUp className="w-4 h-4" />
            ) : (
              <ChevronDown className="w-4 h-4" />
            )}
            <span>
              {t('comment.repliesCount', { count: comment.children.length })}
            </span>
          </button>

          {showReplies && (
            <div className="space-y-1">
              {comment.children.map((reply) => (
                <Comment
                  key={reply.id}
                  comment={reply}
                  depth={depth + 1}
                  articleId={articleId}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function CommentList({
  articleId,
  articleDbId,
}: CommentListProps) {
  const t = useTranslations();
  const router = useRouter();
  const [commentContent, setCommentContent] = useState('');

  // SSE 实时监听新回复
  // - articleDbId (DB ID) 用于 SSE URL 过滤（后端 event payload 用 DB ID）
  // - articleId (slug) 用于 React Query 缓存匹配（queryKey 用 slug）
  // 使用 useRef 锁定 articleDbId，避免异步加载导致 articleId 变化引发重复 SSE 连接
  const sseArticleIdRef = useRef(articleDbId || articleId);
  useCommentSSE(sseArticleIdRef.current, articleId);

  // 使用新的 React Query 无限滚动钩子
  const {
    items: serverComments,
    total,
    page,
    totalPages,
    isLoading,
    isLoadingMore,
    hasMore,
    error,
    loadMore,
  } = useCommentsInfiniteQuerySimple(articleId, {
    pageSize: 20,
    enabled: true,
  });

  const { mutate: postComment, isPending: isPosting } =
    usePostComment(articleId);
  const { isAuthenticated } = useAuth();

  const totalComments = total;
  // 直接使用服务端评论（已包含乐观更新），并添加数据去重保护
  const allComments = useMemo(() => {
    const seenIds = new Set();
    return serverComments.filter((comment) => {
      if (seenIds.has(comment.id)) return false;
      seenIds.add(comment.id);
      return true;
    });
  }, [serverComments]);

  // 使用无限滚动检测钩子
  const { sentinelRef } = useInfiniteScrollDetectionSimple(loadMore, {
    enabled: hasMore && !isLoadingMore,
    threshold: 300,
    hasMore,
    isLoadingMore,
  });

  const handleSubmitComment = () => {
    if (!commentContent.trim()) return;

    // 清空输入框
    setCommentContent('');

    // 提交到服务器 - usePostComment 会自动处理乐观更新
    postComment({
      content: commentContent,
    });
  };

  if (isLoading) {
    return (
      <section className="mt-16">
        <header className="flex items-center gap-3 mb-8">
          <MessageSquare className="w-6 h-6 text-primary" />
          <h2 className="text-2xl font-bold">{t('comment.title')}</h2>
          <span className="text-muted-foreground">(0)</span>
        </header>
        <div className="flex justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      </section>
    );
  }

  if (error) {
    return (
      <section className="mt-16">
        <header className="flex items-center gap-3 mb-8">
          <MessageSquare className="w-6 h-6 text-primary" />
          <h2 className="text-2xl font-bold">{t('comment.title')}</h2>
        </header>
        <div className="p-6 rounded-xl border border-border bg-muted/30 text-center">
          <p className="text-muted-foreground">{t('common.error')}</p>
        </div>
      </section>
    );
  }

  return (
    <section className="mt-16">
      <header className="flex items-center gap-3 mb-8">
        <MessageSquare className="w-6 h-6 text-primary" />
        <h2 className="text-2xl font-bold">{t('comment.title')}</h2>
        <span className="text-muted-foreground">({totalComments})</span>
      </header>

      {/* 评论输入框 */}
      <div className="mb-6">
        {!isAuthenticated ? (
          // 未登录状态：显示登录提示
          <div className="p-6 rounded-lg border border-border/50 bg-muted/20 text-center">
            <LogIn className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
            <p className="text-muted-foreground mb-3">
              {t('comment.loginRequired')}
            </p>
            <button
              onClick={() => router.push('/login')}
              className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm hover:bg-primary/90 transition-colors flex items-center gap-1.5 mx-auto"
            >
              <LogIn className="w-3.5 h-3.5" />
              {t('comment.loginToComment')}
            </button>
          </div>
        ) : (
          // 已登录状态：显示评论输入框
          <div className="p-4 rounded-lg border border-border/50 bg-background">
            <h3 className="font-medium mb-3 text-sm">
              {t('comment.writeComment')}
            </h3>

            <div className="space-y-3">
              <div>
                <textarea
                  value={commentContent}
                  onChange={(e) => setCommentContent(e.target.value)}
                  className="w-full p-2.5 text-sm rounded-lg border border-border/50 bg-background resize-none focus:outline-none focus:ring-1 focus:ring-primary/30 focus:border-primary transition-all"
                  rows={3}
                  placeholder={t('comment.contentPlaceholder')}
                  disabled={isPosting}
                />
              </div>

              <div className="flex justify-end">
                <button
                  onClick={handleSubmitComment}
                  className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm hover:bg-primary/90 transition-colors flex items-center gap-1.5"
                  disabled={isPosting || !commentContent.trim()}
                >
                  {isPosting ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Send className="w-3.5 h-3.5" />
                  )}
                  {t('comment.submit')}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* 评论列表 */}
      {allComments.length > 0 ? (
        <>
          <div className="space-y-1">
            {allComments.map((comment) => (
              <Comment
                key={comment.id}
                comment={comment}
                articleId={articleId}
              />
            ))}
          </div>

          {/* 无限滚动加载器（自动加载） */}
          <InfiniteScrollLoader
            isLoadingMore={isLoadingMore}
            hasMore={hasMore}
            error={error}
            onRetryAction={loadMore}
          />

          {/* 滚动检测哨兵元素 */}
          <div ref={sentinelRef} className="h-1" />

          {/* 分页信息（仅在开发环境显示） */}
          {process.env.NODE_ENV === 'development' && (
            <div className="mt-4 text-center">
              <p className="text-xs text-muted-foreground">
                {allComments.length} / {totalComments} •{' '}
                {t('comment.pageInfo', { page, totalPages })}
              </p>
            </div>
          )}
        </>
      ) : (
        <div className="p-6 rounded-lg border border-border/50 bg-muted/20 text-center">
          <MessageSquare className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
          <p className="text-muted-foreground">{t('comment.noComments')}</p>
          <p className="text-xs text-muted-foreground/80 mt-1">
            {t('comment.beFirst')}
          </p>
        </div>
      )}
    </section>
  );
}
