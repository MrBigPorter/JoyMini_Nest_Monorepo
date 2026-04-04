'use client';

import React from 'react';
import { MessageSquare, Search, RefreshCw } from 'lucide-react';
import type { ChatConversation } from '@/type/types';
import { ConversationItem } from './index';

interface ConversationListProps {
  conversations: ChatConversation[];
  selectedConv: ChatConversation | null;
  loading: boolean;
  total: number;
  page: number;
  keyword: string;
  statusFilter: number | undefined;
  lastSeenSeqId: Record<string, number>;
  onKeywordChange: (keyword: string) => void;
  onStatusFilterChange: (status: number | undefined) => void;
  onPageChange: (page: number) => void;
  onSelectConversation: (conv: ChatConversation) => void;
  onRefresh: () => void;
}

export function ConversationList({
  conversations,
  selectedConv,
  loading,
  total,
  page,
  keyword,
  statusFilter,
  lastSeenSeqId,
  onKeywordChange,
  onStatusFilterChange,
  onPageChange,
  onSelectConversation,
  onRefresh,
}: ConversationListProps) {
  return (
    <div className="w-80 flex-shrink-0 flex flex-col rounded-2xl border border-gray-100 dark:border-white/10 bg-white dark:bg-gray-900 overflow-hidden">
      {/* 搜索 + 过滤 */}
      <div className="p-3 border-b border-gray-100 dark:border-white/10 space-y-2">
        <div className="relative">
          <Search
            size={14}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
          />
          <input
            type="text"
            placeholder="Search user or keyword…"
            value={keyword}
            onChange={(e) => {
              onKeywordChange(e.target.value);
              onPageChange(1);
            }}
            className="w-full pl-8 pr-3 py-2 text-sm rounded-xl bg-gray-50 dark:bg-white/5 border border-gray-100 dark:border-white/10 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-teal-500/50"
          />
        </div>
        {/* 状态标签 */}
        <div className="flex gap-1.5">
          {[
            { label: 'All', value: undefined },
            { label: 'Active', value: 1 },
            { label: 'Closed', value: 2 },
          ].map((opt) => (
            <button
              key={String(opt.value)}
              onClick={() => {
                onStatusFilterChange(opt.value);
                onPageChange(1);
              }}
              className={`flex-1 text-xs py-1.5 rounded-lg transition-colors ${
                statusFilter === opt.value
                  ? 'bg-teal-500 text-white'
                  : 'bg-gray-100 dark:bg-white/5 text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-white/10'
              }`}
            >
              {opt.label}
            </button>
          ))}
          <button
            onClick={onRefresh}
            disabled={loading}
            className="p-1.5 rounded-lg bg-gray-100 dark:bg-white/5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors"
          >
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* 列表 */}
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {loading && conversations.length === 0 && (
          <div className="flex justify-center py-8 text-gray-400 text-sm">
            Loading…
          </div>
        )}
        {!loading && conversations.length === 0 && (
          <div className="flex flex-col items-center py-12 text-gray-400">
            <MessageSquare size={28} className="mb-2 opacity-40" />
            <p className="text-sm">No conversations</p>
          </div>
        )}
        {conversations.map((conv) => {
          const unread = Math.max(
            0,
            conv.lastMsgSeqId - (lastSeenSeqId[conv.id] ?? conv.lastMsgSeqId),
          );
          return (
            <ConversationItem
              key={conv.id}
              conv={conv}
              isActive={selectedConv?.id === conv.id}
              unreadCount={unread}
              onClick={() => onSelectConversation(conv)}
            />
          );
        })}
      </div>

      {/* 分页 */}
      {total > 30 && (
        <div className="flex items-center justify-between px-3 py-2 border-t border-gray-100 dark:border-white/10">
          <button
            disabled={page <= 1}
            onClick={() => onPageChange(page - 1)}
            className="text-xs px-2 py-1 rounded-lg bg-gray-100 dark:bg-white/5 disabled:opacity-40 hover:bg-gray-200 dark:hover:bg-white/10 transition-colors"
          >
            Prev
          </button>
          <span className="text-xs text-gray-400">
            {(page - 1) * 30 + 1}–{Math.min(page * 30, total)} / {total}
          </span>
          <button
            disabled={page * 30 >= total}
            onClick={() => onPageChange(page + 1)}
            className="text-xs px-2 py-1 rounded-lg bg-gray-100 dark:bg-white/5 disabled:opacity-40 hover:bg-gray-200 dark:hover:bg-white/10 transition-colors"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
