'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
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
import { SocketIndicator } from './index';
import { ChatWindow } from './ChatWindow';
import { ConversationList } from './ConversationList';

// ─── 主组件 ───────────────────────────────────────────────────────────────────

export function CustomerServiceDesk() {
  const [selectedConv, setSelectedConv] = useState<ChatConversation | null>(
    null,
  );
  const [keyword, setKeyword] = useState('');
  const [statusFilter, setStatusFilter] = useState<number | undefined>(
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
  };

  const {
    data,
    loading,
    run: refreshList,
  } = useRequest(
    () => chatApi.getConversations(queryParams, { trace: false }),
    {
      refreshDeps: [page, keyword, statusFilter],
      pollingInterval: 30000,
    },
  );

  const conversations = React.useMemo(() => data?.list ?? [], [data?.list]);
  const total = data?.total ?? 0;

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
        title="Customer Service Desk"
        description="Handle support conversations from users"
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
          lastSeenSeqId={lastSeenSeqId}
          onKeywordChange={setKeyword}
          onStatusFilterChange={setStatusFilter}
          onPageChange={setPage}
          onSelectConversation={handleSelectConv}
          onRefresh={refreshList}
        />

        {/* 右侧：聊天窗口 */}
        <div className="flex-1 min-w-0 rounded-2xl border border-gray-100 dark:border-white/10 overflow-hidden bg-white dark:bg-gray-900">
          {selectedConv ? (
            <ChatWindow
              key={selectedConv.id}
              conversation={selectedConv}
              onMessageSent={refreshList}
              registerOnNewMessage={(fn) => {
                onNewMessageRef.current = fn;
              }}
              registerOnRecalled={(fn) => {
                onRecalledRef.current = fn;
              }}
            />
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-gray-400 select-none">
              <MessageSquare size={48} className="mb-4 opacity-20" />
              <p className="text-base font-medium">Select a conversation</p>
              <p className="text-sm mt-1 opacity-60">
                Choose a support ticket from the left to start responding
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
