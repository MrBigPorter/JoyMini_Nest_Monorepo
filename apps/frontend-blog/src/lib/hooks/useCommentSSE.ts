'use client';

import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { Comment } from '@/lib/types/blog';

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
 * @param articleId   - 文章 DB ID，用于 SSE 端点 ?articleId= 过滤；后端 event payload 中的 articleId 是此值
 * @param cacheArticleId - 文章 slug，与 useCommentsInfiniteQuerySimple 的 queryKey 一致，用于 React Query 缓存匹配
 *                        若不传则降级使用 articleId（两者相同时可不传）
 */
export function useCommentSSE(
  articleId: string | undefined,
  cacheArticleId?: string,
) {
  // 同步日志 — 确认 hook 被调用（不依赖 useEffect）
  if (typeof window !== 'undefined') {
    console.log(
      '[SSE-HOOK] useCommentSSE 被调用, articleId(DB ID):',
      articleId,
      '| cacheArticleId(slug):',
      cacheArticleId ?? '(未传，用articleId)',
    );
  }

  const queryClient = useQueryClient();
  const eventSourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!articleId) {
      console.warn('[SSE] articleId 为空，跳过连接');
      return;
    }

    // cacheKey 用于 React Query 缓存匹配（slug），articleId 用于 SSE URL 过滤（DB ID）
    const cacheKey = cacheArticleId || articleId;

    // 构建 SSE 连接 URL
    const baseUrl =
      typeof window !== 'undefined'
        ? process.env.NEXT_PUBLIC_API_BASE_URL || '/api'
        : '/api';
    const sseUrl = `${baseUrl.replace(/\/+$/, '')}/v1/frontend/blog/comments/stream?articleId=${articleId}`;

    console.log(
      '[SSE] 准备连接:',
      sseUrl,
      '| articleId:',
      articleId,
      '| 类型:',
      typeof articleId,
    );

    // 创建 EventSource 连接
    const es = new EventSource(sseUrl);
    eventSourceRef.current = es;

    console.log(
      '[SSE] EventSource 已创建, readyState:',
      es.readyState,
      '(0=CONNECTING,1=OPEN,2=CLOSED)',
    );

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
        // NestJS @Sse() 会双重包裹数据: { data: { articleId: '...' } }
        // 需要解包获取实际 payload，与 admin blog useSSE 一致
        const parsed = JSON.parse(event.data);
        console.log('[SSE] parsed:', parsed);
        const data: CommentReplyEvent =
          (parsed as { data?: CommentReplyEvent }).data ?? parsed;
        console.log('[SSE] 解包后 payload:', data);

        // Step 1: 将新回复直接插入缓存（即时 UI 更新）
        // 注意：用 cacheKey(slug) 查缓存，而非 articleId(DB ID)
        insertReplyIntoCache(queryClient, cacheKey, data);

        // Step 2: 异步使缓存失效，确保最终一致性
        queryClient.invalidateQueries({
          queryKey: ['comments', 'infinite', cacheKey],
          refetchType: 'active',
        });
      } catch (err) {
        console.error(
          '[SSE] 解析事件数据失败:',
          err,
          '| 原始 data:',
          event.data,
        );
      }
    };

    es.onerror = (err) => {
      console.error(
        '[SSE] ❌ 连接异常',
        err,
        '| readyState:',
        es.readyState,
        '(0=CONNECTING,1=OPEN,2=CLOSED)',
      );
    };

    // 清理：断开 SSE 连接
    return () => {
      console.log(
        '[SSE] 清理，关闭连接, articleId:',
        articleId,
        '| cacheKey:',
        cacheKey,
      );
      es.close();
      eventSourceRef.current = null;
    };
  }, [articleId, cacheArticleId, queryClient]);
}

// ---------------------------------------------------------------------------
// Cache helper
// ---------------------------------------------------------------------------

/**
 * 将新回复直接插入到 React Query 缓存中
 *
 * 遍历所有匹配的缓存条目（不同 locale / pageSize 的变体），
 * 找到 parentId 对应的父评论，将新回复追加到其 children 数组中。
 * 如果父评论尚未加载到缓存中，则静默跳过（等用户滚动到该页时会自然刷新）。
 */
function insertReplyIntoCache(
  queryClient: ReturnType<typeof useQueryClient>,
  articleId: string,
  data: CommentReplyEvent,
) {
  // 获取所有匹配的缓存条目
  const entries = queryClient.getQueriesData({
    queryKey: ['comments', 'infinite', articleId],
    exact: false,
  });

  console.log(
    `[SSE-CACHE] 查找缓存 articleId="${articleId}", 找到条目数: ${entries.length}`,
  );
  if (entries.length === 0) {
    // 列出所有现有的 comments 缓存 key 供对比
    const allCommentKeys = queryClient.getQueriesData({
      queryKey: ['comments'],
    });
    console.warn(
      '[SSE-CACHE] 未找到匹配缓存，现有 comments 缓存 keys:',
      allCommentKeys.map(([k]) => k),
    );
    return;
  }

  // 构建要插入的回复对象
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

  entries.forEach(([queryKey]) => {
    queryClient.setQueryData(
      queryKey,
      (old: InfiniteCommentCache | undefined) => {
        if (!old?.pages) return old;

        let replyInserted = false;

        const updatedPages = old.pages.map((page) => {
          if (!page?.items) return page;

          const updatedItems = page.items.map((comment) => {
            // 检查当前评论是否为目标父评论
            if (comment.id === data.parentId) {
              replyInserted = true;
              return {
                ...comment,
                children: [...(comment.children || []), newReply],
              };
            }

            // 如果当前评论已有 children，也检查 children 中是否嵌套了目标父评论
            if (comment.children?.length) {
              const hasParentInChildren = comment.children.some(
                (child) => child.id === data.parentId,
              );
              if (hasParentInChildren) {
                replyInserted = true;
                return {
                  ...comment,
                  children: [...comment.children, newReply],
                };
              }
            }

            return comment;
          });

          return {
            ...page,
            items: updatedItems,
          };
        });

        if (!replyInserted) {
          console.warn(
            `[SSE-CACHE] 未找到父评论 parentId="${data.parentId}"（可能尚未加载到缓存中）`,
          );
          return old;
        }

        console.log(
          `[SSE-CACHE] ✅ 回复已插入缓存, parentId="${data.parentId}", replyId="${data.replyId}"`,
        );
        return {
          ...old,
          pages: updatedPages,
        };
      },
    );
  });
}
