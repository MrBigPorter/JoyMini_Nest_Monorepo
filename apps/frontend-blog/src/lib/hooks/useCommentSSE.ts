'use client';

import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { Comment } from '@/lib/types/blog';

// ---------------------------------------------------------------------------
// Module-level SSE singleton registry
// 防止 Fast Refresh / HMR / React StrictMode 创建重复连接
// key = articleId (DB ID)，value = { es, refCount, cacheKey }
// ---------------------------------------------------------------------------
interface SSEEntry {
  es: EventSource;
  refCount: number;
  cacheKey: string;
  onMessageHandlers: Set<(data: CommentReplyEvent) => void>;
}
const sseRegistry = new Map<string, SSEEntry>();

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CommentReplyEvent {
  articleId: string;
  parentId: string;
  replyId: string;
  content: string;
  author: string;
  createdAt: string;
}

/** 无限查询缓存中单页的数据结构 */
interface InfiniteCommentPage {
  items: Comment[];
}

/** 无限查询缓存根级数据结构 */
interface InfiniteCommentCache {
  pages: InfiniteCommentPage[];
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * SSE 评论回复实时推送 Hook
 *
 * @param articleId      - 文章 DB ID，用于 SSE 端点 ?articleId= 过滤
 * @param cacheArticleId - 文章 slug，与 useCommentsInfiniteQuerySimple 的 queryKey 一致
 *                         若不传则降级使用 articleId
 */
export function useCommentSSE(
  articleId: string | undefined,
  cacheArticleId?: string,
) {
  if (typeof window !== 'undefined') {
    console.log(
      '[SSE-HOOK] useCommentSSE 被调用, articleId(DB ID):',
      articleId,
      '| cacheArticleId(slug):',
      cacheArticleId ?? '(未传，用articleId)',
    );
  }

  const queryClient = useQueryClient();
  // 用于标识本次挂载注册的 handler，cleanup 时仅移除自己
  const handlerRef = useRef<((data: CommentReplyEvent) => void) | null>(null);

  useEffect(() => {
    if (!articleId || typeof window === 'undefined') return;

    const cacheKey = cacheArticleId || articleId;

    // -----------------------------------------------------------------------
    // 创建本次挂载的消息处理器
    // -----------------------------------------------------------------------
    const handler = (data: CommentReplyEvent) => {
      console.log('[SSE] 解包后 payload:', data);

      // Step 1: 直接插入缓存（即时 UI 更新）
      // ⚠️ 不在这里调用 invalidateQueries：
      //    立即 refetch 会用 server 返回的平铺数据覆盖 setQueryData 插入的嵌套 reply
      //    导致页面不更新。改为延迟 5s 后静默刷新（确保最终一致性）。
      const inserted = insertReplyIntoCache(queryClient, cacheKey, data);

      if (inserted) {
        // 延迟刷新：给 React 足够时间渲染 setQueryData 的结果
        setTimeout(() => {
          queryClient.invalidateQueries({
            queryKey: ['comments', 'infinite', cacheKey],
            refetchType: 'active',
          });
        }, 5000);
      }
    };
    handlerRef.current = handler;

    // -----------------------------------------------------------------------
    // 单例：复用已有的 SSE 连接
    // -----------------------------------------------------------------------
    const existing = sseRegistry.get(articleId);
    if (existing) {
      existing.refCount++;
      existing.onMessageHandlers.add(handler);
      console.log(
        `[SSE] 复用已有连接 articleId=${articleId}, refCount=${existing.refCount}`,
      );
    } else {
      const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || '/api';
      const sseUrl = `${baseUrl.replace(/\/+$/, '')}/v1/frontend/blog/comments/stream?articleId=${articleId}`;
      console.log('[SSE] 新建连接:', sseUrl);

      const es = new EventSource(sseUrl);
      const handlers = new Set<(data: CommentReplyEvent) => void>();
      handlers.add(handler);

      const entry: SSEEntry = {
        es,
        refCount: 1,
        cacheKey,
        onMessageHandlers: handlers,
      };
      sseRegistry.set(articleId, entry);

      es.onopen = () => {
        console.log(
          '[SSE] ✅ 连接已建立, articleId:',
          articleId,
          '| readyState:',
          es.readyState,
        );
      };

      es.onmessage = (event: MessageEvent) => {
        console.log(
          '[SSE] 📨 收到原始消息, type:',
          event.type,
          '| data:',
          event.data,
        );
        try {
          const parsed = JSON.parse(event.data);
          const data: CommentReplyEvent =
            (parsed as { data?: CommentReplyEvent }).data ?? parsed;
          // 广播给所有注册的 handler
          const reg = sseRegistry.get(articleId);
          reg?.onMessageHandlers.forEach((h) => h(data));
        } catch (err) {
          console.error('[SSE] 解析事件数据失败:', err);
        }
      };

      es.onerror = (err) => {
        console.error('[SSE] ❌ 连接异常', err, '| readyState:', es.readyState);
      };
    }

    // -----------------------------------------------------------------------
    // 清理：引用计数减一；归零时关闭连接
    // -----------------------------------------------------------------------
    return () => {
      const reg = sseRegistry.get(articleId);
      if (!reg) return;

      if (handlerRef.current) {
        reg.onMessageHandlers.delete(handlerRef.current);
        handlerRef.current = null;
      }
      reg.refCount--;
      console.log(
        `[SSE] 清理 articleId=${articleId}, refCount=${reg.refCount}`,
      );

      if (reg.refCount <= 0) {
        reg.es.close();
        sseRegistry.delete(articleId);
        console.log('[SSE] 连接已关闭并移除 articleId:', articleId);
      }
    };
  }, [articleId, cacheArticleId, queryClient]);
}

// ---------------------------------------------------------------------------
// Cache helper
// ---------------------------------------------------------------------------

/**
 * 将新回复直接插入到 React Query 缓存中
 * 返回 true 表示成功插入，false 表示未找到父评论（跳过）
 */
function insertReplyIntoCache(
  queryClient: ReturnType<typeof useQueryClient>,
  articleId: string,
  data: CommentReplyEvent,
): boolean {
  const entries = queryClient.getQueriesData<InfiniteCommentCache>({
    queryKey: ['comments', 'infinite', articleId],
    exact: false,
  });

  console.log(
    `[SSE-CACHE] 查找缓存 articleId="${articleId}", 找到条目数: ${entries.length}`,
  );
  if (entries.length === 0) {
    const allCommentKeys = queryClient.getQueriesData({
      queryKey: ['comments'],
    });
    console.warn(
      '[SSE-CACHE] 未找到匹配缓存，现有 comments 缓存 keys:',
      allCommentKeys.map(([k]) => k),
    );
    return false;
  }

  const newReply: Comment = {
    id: data.replyId,
    articleId: data.articleId,
    parentId: data.parentId,
    author: data.author,
    email: null,
    website: null,
    content: data.content,
    approved: true,
    likes: 0,
    createdAt: data.createdAt,
    updatedAt: data.createdAt,
    children: [],
  };

  let anyInserted = false;

  entries.forEach(([queryKey]) => {
    queryClient.setQueryData(
      queryKey,
      (old: InfiniteCommentCache | undefined) => {
        if (!old?.pages) return old;

        let replyInserted = false;

        const updatedPages = old.pages.map((page) => {
          if (!page?.items) return page;

          const updatedItems = page.items.map((comment) => {
            // 直接父评论
            if (comment.id === data.parentId) {
              replyInserted = true;
              // 防止重复插入
              const alreadyExists = (comment.children || []).some(
                (c) => c.id === data.replyId,
              );
              if (alreadyExists) return comment;
              return {
                ...comment,
                children: [...(comment.children || []), newReply],
              };
            }

            // 嵌套：父评论是某顶级评论的子评论
            if (comment.children?.length) {
              const parentIdx = comment.children.findIndex(
                (child) => child.id === data.parentId,
              );
              if (parentIdx !== -1) {
                replyInserted = true;
                const alreadyExists = (
                  comment.children[parentIdx].children || []
                ).some((c) => c.id === data.replyId);
                if (alreadyExists) return comment;
                const updatedChildren = comment.children.map((child, idx) =>
                  idx === parentIdx
                    ? {
                        ...child,
                        children: [...(child.children || []), newReply],
                      }
                    : child,
                );
                return { ...comment, children: updatedChildren };
              }
            }

            return comment;
          });

          return { ...page, items: updatedItems };
        });

        if (!replyInserted) {
          console.warn(
            `[SSE-CACHE] 未找到父评论 parentId="${data.parentId}"（可能尚未加载到缓存中）`,
          );
          return old;
        }

        anyInserted = true;
        console.log(
          `[SSE-CACHE] ✅ 回复已插入缓存, parentId="${data.parentId}", replyId="${data.replyId}"`,
        );
        return { ...old, pages: updatedPages };
      },
    );
  });

  return anyInserted;
}
