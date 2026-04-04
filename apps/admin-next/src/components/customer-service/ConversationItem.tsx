'use client';

import { StatusBadge } from './StatusBadge';
import { formatTime, getInitials } from '@/lib/format-utils';
import type { ChatConversation } from '@/type/types';

export function ConversationItem({
  conv,
  isActive,
  unreadCount = 0,
  onClick,
}: {
  conv: ChatConversation;
  isActive: boolean;
  unreadCount?: number;
  onClick: () => void;
}) {
  const user = conv.members.find((m) => m.role !== 'OWNER') ?? conv.members[0];
  const displayName = user?.nickname ?? conv.name ?? 'Unknown';

  return (
    <button
      onClick={onClick}
      className={`w-full text-left p-3 rounded-xl transition-all ${
        isActive
          ? 'bg-teal-50 dark:bg-teal-500/15 border border-teal-200 dark:border-teal-500/30'
          : 'hover:bg-gray-50 dark:hover:bg-white/5 border border-transparent'
      }`}
    >
      <div className="flex items-start gap-3">
        {/* 头像 + 未读角标 */}
        <div className="relative flex-shrink-0">
          <div className="w-9 h-9 rounded-full bg-gradient-to-br from-teal-400 to-teal-600 flex items-center justify-center text-white text-sm font-semibold">
            {user?.avatar ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={user.avatar}
                alt={displayName}
                className="w-full h-full rounded-full object-cover"
              />
            ) : (
              getInitials(displayName)
            )}
          </div>
          {unreadCount > 0 && (
            <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center leading-none">
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </div>
        {/* 内容 */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-1 mb-0.5">
            <span
              className={`text-sm font-medium truncate ${unreadCount > 0 ? 'text-gray-900 dark:text-white font-semibold' : 'text-gray-900 dark:text-white'}`}
            >
              {displayName}
            </span>
            <span className="text-xs text-gray-400 flex-shrink-0">
              {formatTime(conv.lastMsgTime)}
            </span>
          </div>
          <p
            className={`text-xs truncate ${unreadCount > 0 ? 'text-gray-700 dark:text-gray-200 font-medium' : 'text-gray-500 dark:text-gray-400'}`}
          >
            {conv.lastMsgContent ?? 'No messages yet'}
          </p>
          <div className="mt-1">
            <StatusBadge status={conv.status} />
          </div>
        </div>
      </div>
    </button>
  );
}
