'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useRequest } from 'ahooks';
import {
  MessageSquare,
  Send,
  X,
  RefreshCw,
  ChevronUp,
  Image as ImageIcon,
  Paperclip,
  Zap,
} from 'lucide-react';
import { chatApi } from '@/api';
import type { ChatConversation, ChatMessage } from '@/type/types';
import { ModalManager } from '@repo/ui';
import { MessageBubble, QuickRepliesPanel } from './index';

interface ChatWindowProps {
  conversation: ChatConversation;
  onMessageSent: () => void;
  registerOnNewMessage?: (fn: (msg: ChatMessage) => void) => void;
  registerOnRecalled?: (
    fn: (d: { conversationId: string; messageId: string }) => void,
  ) => void;
}

export function ChatWindow({
  conversation,
  onMessageSent,
  registerOnNewMessage,
  registerOnRecalled,
}: ChatWindowProps) {
  const [replyText, setReplyText] = useState('');
  const [sending, setSending] = useState(false);
  const [closing, setClosing] = useState(false);
  const [showQuickReplies, setShowQuickReplies] = useState(false);
  const [uploading, setUploading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const [cursor, setCursor] = useState<number | undefined>(undefined);
  const [allMessages, setAllMessages] = useState<ChatMessage[]>([]);
  const [hasMore, setHasMore] = useState(true);

  const user =
    conversation.members.find((m) => m.role !== 'OWNER') ??
    conversation.members[0];
  const displayName = user?.nickname ?? conversation.name ?? 'Unknown';

  // ── 实时消息回调注册 ──────────────────────────────────────────
  useEffect(() => {
    registerOnNewMessage?.((msg) => {
      setAllMessages((prev) => {
        if (prev.some((m) => m.id === msg.id)) return prev;
        return [...prev, msg];
      });
    });
    registerOnRecalled?.((data) => {
      if (data.conversationId !== conversation.id) return;
      setAllMessages((prev) =>
        prev.map((m) =>
          m.id === data.messageId
            ? { ...m, isRecalled: true, content: '[Message recalled]' }
            : m,
        ),
      );
    });
  }, [conversation.id, registerOnNewMessage, registerOnRecalled]);

  const { loading: loadingMsgs, run: fetchMessages } = useRequest(
    () =>
      chatApi.getMessages(conversation.id, { pageSize: 30 }, { trace: false }),
    {
      refreshDeps: [conversation.id],
      pollingInterval: 10000,
      onSuccess: (data) => {
        const sorted = [...data.list].reverse();
        setAllMessages(sorted);
        setCursor(data.nextCursor ?? undefined);
        setHasMore(data.nextCursor !== null);
      },
    },
  );

  const loadMore = useCallback(async () => {
    if (!hasMore || !cursor) return;
    const data = await chatApi.getMessages(conversation.id, {
      cursor,
      pageSize: 30,
    });
    const older = [...data.list].reverse();
    setAllMessages((prev) => [...older, ...prev]);
    setCursor(data.nextCursor ?? undefined);
    setHasMore(data.nextCursor !== null);
  }, [conversation.id, cursor, hasMore]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [allMessages]);

  const handleSend = async (text?: string) => {
    const content = (text ?? replyText).trim();
    if (!content || sending) return;
    setSending(true);
    try {
      await chatApi.reply(conversation.id, { content, type: 0 });
      if (!text) setReplyText('');
      fetchMessages();
      onMessageSent();
    } finally {
      setSending(false);
    }
  };

  const handleFileUpload = async (file: File, msgType: number) => {
    setUploading(true);
    try {
      const tokenResult = await chatApi.getUploadToken(file.name, file.type);
      await fetch(tokenResult.url, {
        method: 'PUT',
        headers: { 'Content-Type': file.type },
        body: file,
      });
      const cdnUrl = tokenResult.cdnUrl ?? tokenResult.key;
      const meta: Record<string, unknown> = { fileName: file.name };
      if (msgType === 5) meta.fileSize = file.size;
      if (msgType === 1 && file.type.startsWith('image/')) {
        await new Promise<void>((resolve) => {
          const img = new window.Image();
          img.onload = () => {
            meta.w = img.naturalWidth;
            meta.h = img.naturalHeight;
            resolve();
          };
          img.onerror = () => resolve();
          img.src = URL.createObjectURL(file);
        });
      }
      await chatApi.reply(conversation.id, {
        content: cdnUrl,
        type: msgType,
        meta,
      });
      fetchMessages();
      onMessageSent();
    } finally {
      setUploading(false);
    }
  };

  const handleRecall = (messageId: string) => {
    ModalManager.open({
      title: 'Force Recall Message',
      content: 'Force recall this message?',
      confirmText: 'Recall',
      onConfirm: async () => {
        try {
          await chatApi.forceRecall(messageId);
          fetchMessages();
        } catch {
          alert('Failed to recall message');
        }
      },
    });
  };

  const handleClose = async () => {
    if (closing) return;
    setClosing(true);
    try {
      await chatApi.closeConversation(conversation.id, {
        reason: 'Resolved by support agent',
      });
      onMessageSent();
      fetchMessages();
    } finally {
      setClosing(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  };

  const isClosed = conversation.status === 2;

  return (
    <div className="flex flex-col h-full">
      {/* 顶栏 */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100 dark:border-white/10 bg-white dark:bg-gray-900">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-teal-400 to-teal-600 flex items-center justify-center text-white text-sm font-semibold">
            {displayName.charAt(0).toUpperCase()}
          </div>
          <div>
            <p className="text-sm font-semibold text-gray-900 dark:text-white">
              {displayName}
            </p>
            <p className="text-xs text-gray-400">
              {conversation.id.slice(0, 12)}…
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {!isClosed && (
            <button
              onClick={() => void handleClose()}
              disabled={closing}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-orange-200 dark:border-orange-500/30 text-orange-600 dark:text-orange-400 hover:bg-orange-50 dark:hover:bg-orange-500/10 transition-colors disabled:opacity-50"
            >
              <X size={12} />
              {closing ? 'Closing…' : 'Close Ticket'}
            </button>
          )}
          <button
            onClick={fetchMessages}
            disabled={loadingMsgs}
            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-white/5 transition-colors"
          >
            <RefreshCw
              size={14}
              className={loadingMsgs ? 'animate-spin' : ''}
            />
          </button>
        </div>
      </div>

      {/* 消息区 */}
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3 bg-gray-50 dark:bg-gray-950">
        {hasMore && (
          <div className="flex justify-center">
            <button
              onClick={() => void loadMore()}
              className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-teal-500 transition-colors"
            >
              <ChevronUp size={14} />
              Load earlier messages
            </button>
          </div>
        )}

        {loadingMsgs && allMessages.length === 0 && (
          <div className="flex justify-center py-8 text-gray-400 text-sm">
            Loading messages…
          </div>
        )}

        {!loadingMsgs && allMessages.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 text-gray-400">
            <MessageSquare size={32} className="mb-2 opacity-40" />
            <p className="text-sm">No messages yet</p>
          </div>
        )}

        {allMessages.map((msg) => (
          <MessageBubble key={msg.id} msg={msg} onRecall={handleRecall} />
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* 回复栏 */}
      {isClosed ? (
        <div className="px-5 py-4 border-t border-gray-100 dark:border-white/10 bg-white dark:bg-gray-900 text-center text-sm text-gray-400">
          This conversation is closed.
        </div>
      ) : (
        <div className="px-5 py-3 border-t border-gray-100 dark:border-white/10 bg-white dark:bg-gray-900">
          <input
            ref={imageInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleFileUpload(file, 1);
              e.target.value = '';
            }}
          />
          <input
            ref={fileInputRef}
            type="file"
            accept="*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleFileUpload(file, 5);
              e.target.value = '';
            }}
          />

          <div className="relative">
            {showQuickReplies && (
              <QuickRepliesPanel
                onSelect={(text) => setReplyText(text)}
                onClose={() => setShowQuickReplies(false)}
              />
            )}

            <div className="flex items-end gap-2">
              <div className="flex items-center gap-1 mb-1">
                <button
                  onClick={() => setShowQuickReplies((v) => !v)}
                  title="Quick replies"
                  className={`p-1.5 rounded-lg transition-colors ${
                    showQuickReplies
                      ? 'text-yellow-500 bg-yellow-50 dark:bg-yellow-500/10'
                      : 'text-gray-400 hover:text-yellow-500 hover:bg-gray-100 dark:hover:bg-white/5'
                  }`}
                >
                  <Zap size={15} />
                </button>
                <button
                  onClick={() => imageInputRef.current?.click()}
                  disabled={uploading}
                  title="Send image"
                  className="p-1.5 rounded-lg text-gray-400 hover:text-teal-500 hover:bg-gray-100 dark:hover:bg-white/5 transition-colors disabled:opacity-40"
                >
                  <ImageIcon size={15} />
                </button>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                  title="Send file"
                  className="p-1.5 rounded-lg text-gray-400 hover:text-teal-500 hover:bg-gray-100 dark:hover:bg-white/5 transition-colors disabled:opacity-40"
                >
                  <Paperclip size={15} />
                </button>
              </div>

              <textarea
                rows={2}
                value={replyText}
                onChange={(e) => setReplyText(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={
                  uploading
                    ? 'Uploading…'
                    : 'Type a reply… (Enter to send, Shift+Enter for new line)'
                }
                disabled={uploading}
                className="flex-1 resize-none text-sm px-3 py-2 rounded-xl border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-white/5 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-teal-500/50 focus:border-teal-400 disabled:opacity-60"
              />
              <button
                onClick={() => void handleSend()}
                disabled={
                  (!replyText.trim() && !uploading) || sending || uploading
                }
                className="flex-shrink-0 flex items-center justify-center w-9 h-9 rounded-xl bg-teal-500 text-white hover:bg-teal-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {sending ? (
                  <RefreshCw size={14} className="animate-spin" />
                ) : (
                  <Send size={15} />
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
