'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useRequest } from 'ahooks';
import { MessageSquare } from 'lucide-react';
import { PageHeader } from '@/components/scaffold/PageHeader';
import { chatApi } from '@/api';
import type {
  ChatConversation,
  ChatMessage,
  QueryConversationsParams,
} from '@/type/types';
import { useChatSocket } from '@/hooks/useChatSocket';
import { useTranslation } from '@/hooks/useTranslation';
import { SocketIndicator } from './index';
import { ChatWindow } from './ChatWindow';
import { ConversationList } from './ConversationList';

// ─── 主组件 ───────────────────────────────────────────────────────────────────

interface CustomerServiceDeskProps {
  /**
   * 深链会话 ID（?conversationId=xxx）。由 Server Component 从 URL 解析后传入，
   * 用于从转人工队列等入口直接打开某个会话。
   */
  initialConversationId?: string;
}

type DeepLinkState = 'idle' | 'searching' | 'missing';

export function CustomerServiceDesk({
  initialConversationId,
}: CustomerServiceDeskProps = {}) {
  const { t } = useTranslation();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [selectedConv, setSelectedConv] = useState<ChatConversation | null>(
    null,
  );
  const [deepLinkState, setDeepLinkState] = useState<DeepLinkState>('idle');
  // 同一个深链 ID 只做一次兜底查询，避免轮询/重渲染时重复请求
  const deepLinkAttemptRef = useRef<string | null>(null);
  const [keyword, setKeyword] = useState('');
  const [statusFilter, setStatusFilter] = useState<number | undefined>(
    undefined,
  );
  const [queueFilter, setQueueFilter] = useState<'awaiting' | 'callback' | undefined>(
    undefined,
  );
  const [page, setPage] = useState(1);
  const [lastSeenSeqId, setLastSeenSeqId] = useState<Record<string, number>>(
    {},
  );

  const queryParams: QueryConversationsParams = {
    page,
    pageSize: 30,
    type: 'SUPPORT',
    keyword: keyword || undefined,
    status: statusFilter,
    queue: queueFilter,
  };

  const {
    data,
    loading,
    run: refreshList,
  } = useRequest(
    () => chatApi.getConversations(queryParams, { trace: false }),
    {
      refreshDeps: [page, keyword, statusFilter, queueFilter],
      pollingInterval: 30000,
    },
  );

  const conversations = React.useMemo(() => data?.list ?? [], [data?.list]);
  const total = data?.total ?? 0;
  // 用布尔值作为 effect 依赖：列表每次轮询都会产生新数组，
  // 直接依赖数组会导致兜底请求被反复取消。
  const hasDeepLinkMatch = React.useMemo(
    () =>
      initialConversationId
        ? conversations.some((c) => c.id === initialConversationId)
        : false,
    [conversations, initialConversationId],
  );

  const { status: socketStatus } = useChatSocket({
    conversationId: selectedConv?.id ?? null,
    onMessage: useCallback(
      (msg: ChatMessage) => {
        onNewMessageRef.current?.(msg);
        refreshList();
      },
      [refreshList],
    ),
    onRecalled: useCallback((data) => {
      onRecalledRef.current?.(data);
    }, []),
    onConversationUpdated: useCallback(() => {
      refreshList();
    }, [refreshList]),
  });

  const onNewMessageRef = useRef<((msg: ChatMessage) => void) | null>(null);
  const onRecalledRef = useRef<
    ((d: { conversationId: string; messageId: string }) => void) | null
  >(null);

  const handleSelectConv = (conv: ChatConversation) => {
    setSelectedConv(conv);
    setLastSeenSeqId((prev) => ({ ...prev, [conv.id]: conv.lastMsgSeqId }));
  };

  const selectDeepLinkedConv = useCallback((conv: ChatConversation) => {
    setSelectedConv((prev) => (prev?.id === conv.id ? prev : conv));
    setLastSeenSeqId((prev) =>
      prev[conv.id] !== undefined
        ? prev
        : { ...prev, [conv.id]: conv.lastMsgSeqId },
    );
  }, []);

  // 深链 ID 变化时重置兜底查询状态
  useEffect(() => {
    deepLinkAttemptRef.current = null;
    setDeepLinkState('idle');
  }, [initialConversationId]);

  // 优先从已加载的会话列表里直接选中
  useEffect(() => {
    if (!initialConversationId) return;
    const match = conversations.find((c) => c.id === initialConversationId);
    if (match) {
      selectDeepLinkedConv(match);
      setDeepLinkState('idle');
    }
  }, [initialConversationId, conversations, selectDeepLinkedConv]);

  // 列表中没有时做一次兜底查询（不带关键词/状态过滤，保证深链可达）；
  // 仍找不到则给出明确提示，不能静默忽略。
  useEffect(() => {
    if (!initialConversationId) return;
    if (loading) return;
    if (hasDeepLinkMatch) return;
    if (deepLinkAttemptRef.current === initialConversationId) return;

    deepLinkAttemptRef.current = initialConversationId;
    let cancelled = false;
    setDeepLinkState('searching');

    void (async () => {
      try {
        const result = await chatApi.getConversations(
          { page: 1, pageSize: 100, type: 'SUPPORT' },
          { trace: false },
        );
        if (cancelled) return;
        const found = result?.list?.find(
          (c) => c.id === initialConversationId,
        );
        if (found) {
          selectDeepLinkedConv(found);
          setDeepLinkState('idle');
        } else {
          setDeepLinkState('missing');
        }
      } catch {
        if (!cancelled) setDeepLinkState('missing');
      }
    })();

    return () => {
      cancelled = true;
      // 依赖变化（例如轮询导致 loading 抖动）会取消本次请求；
      // 释放标记，让后续 render 能重新发起，避免永远停在 searching。
      if (deepLinkAttemptRef.current === initialConversationId) {
        deepLinkAttemptRef.current = null;
      }
    };
  }, [
    initialConversationId,
    hasDeepLinkMatch,
    loading,
    selectDeepLinkedConv,
  ]);

  const clearInvalidDeepLink = () => {
    setDeepLinkState('idle');
    deepLinkAttemptRef.current = null;
    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.delete('conversationId');
    const query = nextParams.toString();
    router.replace(query ? `${pathname}?${query}` : pathname);
  };

  useEffect(() => {
    if (selectedConv && conversations.length > 0) {
      const updated = conversations.find((c) => c.id === selectedConv.id);
      if (updated) {
        // Only update if data has actually changed to prevent unnecessary re-renders
        const hasChanged =
          updated.lastMsgSeqId !== selectedConv.lastMsgSeqId ||
          updated.status !== selectedConv.status ||
          updated.lastMsgContent !== selectedConv.lastMsgContent ||
          updated.lastMsgTime !== selectedConv.lastMsgTime;
        if (hasChanged) {
          setSelectedConv(updated);
        }
      }
    }
  }, [conversations, selectedConv]);

  return (
    <div className="flex flex-col h-full gap-0">
      <PageHeader
        title={t('customerService.deskTitle')}
        description={t('customerService.deskDescription')}
        action={<SocketIndicator status={socketStatus} />}
      />

      <div className="flex flex-1 min-h-0 gap-4 mt-4">
        {/* 左侧：会话列表 */}
        <ConversationList
          conversations={conversations}
          selectedConv={selectedConv}
          loading={loading}
          total={total}
          page={page}
          keyword={keyword}
          statusFilter={statusFilter}
          queueFilter={queueFilter}
          onQueueFilterChangeAction={(queue) => {
            setQueueFilter(queue);
            if (queue === 'awaiting') setStatusFilter(undefined);
            setPage(1);
          }}
          lastSeenSeqId={lastSeenSeqId}
          onKeywordChangeAction={setKeyword}
          onStatusFilterChangeAction={setStatusFilter}
          onPageChangeAction={setPage}
          onSelectConversationAction={handleSelectConv}
          onRefreshAction={refreshList}
        />

        {/* 右侧：聊天窗口 */}
        <div className="flex-1 min-w-0 flex flex-col rounded-2xl border border-gray-100 dark:border-white/10 overflow-hidden bg-white dark:bg-gray-900">
          {initialConversationId && deepLinkState === 'searching' ? (
            <div
              role="status"
              className="flex-shrink-0 border-b border-gray-100 bg-blue-50 px-4 py-2 text-xs text-blue-700 dark:border-white/10 dark:bg-blue-500/10 dark:text-blue-300"
            >
              正在查找会话 {initialConversationId}…
            </div>
          ) : null}
          {initialConversationId && deepLinkState === 'missing' ? (
            <div
              role="alert"
              className="flex flex-shrink-0 flex-wrap items-center justify-between gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300"
            >
              <span>
                会话 {initialConversationId} 不在当前列表，请刷新或检查 ID。
              </span>
              <button
                type="button"
                className="underline underline-offset-2"
                onClick={clearInvalidDeepLink}
              >
                清除
              </button>
            </div>
          ) : null}
          <div className="flex-1 min-h-0">
            {selectedConv ? (
              <ChatWindow
                key={selectedConv.id}
                conversation={selectedConv}
                onMessageSentAction={refreshList}
                registerOnNewMessageAction={(fn) => {
                  onNewMessageRef.current = fn;
                }}
                registerOnRecalledAction={(fn) => {
                  onRecalledRef.current = fn;
                }}
              />
            ) : (
              <div className="flex flex-col items-center justify-center h-full text-gray-400 select-none">
                <MessageSquare size={48} className="mb-4 opacity-20" />
                <p className="text-base font-medium">
                  {t('customerService.emptyTitle')}
                </p>
                <p className="text-sm mt-1 opacity-60">
                  {t('customerService.emptyDescription')}
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
