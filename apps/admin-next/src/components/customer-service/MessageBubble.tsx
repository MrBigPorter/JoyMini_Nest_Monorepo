'use client';

import { useState } from 'react';
import { Headphones, User, Undo2 } from 'lucide-react';
import {
  ImageMessage,
  AudioMessage,
  VideoMessage,
  FileMessage,
  LocationMessage,
} from './messages';
import { formatMsgTime } from '@/lib/format-utils';
import type { ChatMessage } from '@/type/types';

export function MessageBubble({
  msg,
  onRecall,
}: {
  msg: ChatMessage;
  onRecall?: (id: string) => void;
}) {
  const [hovered, setHovered] = useState(false);

  // type=99 系统通知（关闭会话等）
  if (msg.type === 99) {
    return (
      <div className="flex justify-center my-2">
        <span className="text-xs px-3 py-1 rounded-full bg-gray-100 dark:bg-white/10 text-gray-500 dark:text-gray-400">
          {msg.content}
        </span>
      </div>
    );
  }

  const isSupport = msg.isSystem; // senderId === null
  const senderName = isSupport
    ? ((msg.meta as Record<string, string> | null)?.agentName ?? 'Support')
    : (msg.sender?.nickname ?? 'User');

  const renderContent = () => {
    if (msg.isRecalled) {
      return (
        <span className="italic opacity-60 text-sm">[Message recalled]</span>
      );
    }
    const meta = msg.meta as Record<string, unknown> | null;
    switch (msg.type) {
      case 1: // image
        return <ImageMessage content={msg.content} meta={meta} />;
      case 2: // audio
        return (
          <AudioMessage msgId={msg.id} content={msg.content} meta={meta} />
        );
      case 3: // video
        return <VideoMessage content={msg.content} meta={meta} />;
      case 5: // file
        return (
          <FileMessage
            content={msg.content}
            meta={meta}
            isSupport={isSupport}
          />
        );
      case 6: // location
        return <LocationMessage meta={meta} />;
      default: // text (0) + fallback
        return (
          <span className="text-sm leading-relaxed whitespace-pre-wrap break-words">
            {msg.content}
          </span>
        );
    }
  };

  // 媒体消息（图片/视频/文件/位置）不显示外层气泡背景
  const isMediaBubble = !msg.isRecalled && [1, 3, 5, 6].includes(msg.type);
  // 音频消息 type=2 使用彩色背景
  const isAudioBubble = !msg.isRecalled && msg.type === 2;

  return (
    <div
      className={`flex gap-2 ${isSupport ? 'flex-row-reverse' : 'flex-row'}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* 头像 */}
      <div
        className={`flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-semibold self-end ${
          isSupport
            ? 'bg-teal-500'
            : 'bg-gradient-to-br from-blue-400 to-blue-600'
        }`}
      >
        {isSupport ? <Headphones size={13} /> : <User size={13} />}
      </div>

      {/* 气泡区 */}
      <div
        className={`max-w-[70%] ${isSupport ? 'items-end' : 'items-start'} flex flex-col gap-0.5`}
      >
        <span className="text-xs text-gray-400 px-1">{senderName}</span>
        <div
          className={`rounded-2xl ${
            isMediaBubble
              ? '' // 无背景
              : isAudioBubble
                ? isSupport
                  ? 'bg-teal-500 text-white rounded-tr-sm'
                  : 'bg-blue-500 text-white rounded-tl-sm'
                : msg.isRecalled
                  ? 'bg-gray-100 dark:bg-white/5 text-gray-400 px-3 py-2'
                  : isSupport
                    ? 'bg-teal-500 text-white rounded-tr-sm px-3 py-2'
                    : 'bg-white dark:bg-white/10 text-gray-900 dark:text-white border border-gray-100 dark:border-white/10 rounded-tl-sm px-3 py-2'
          }`}
        >
          {renderContent()}
        </div>
        <div
          className={`flex items-center gap-1.5 px-1 ${isSupport ? 'flex-row-reverse' : ''}`}
        >
          <span className="text-xs text-gray-400">
            {formatMsgTime(msg.createdAt)}
          </span>
          {/* 撤回按钮 — 仅对客服消息且非已撤回 */}
          {isSupport && !msg.isRecalled && onRecall && hovered && (
            <button
              onClick={() => onRecall(msg.id)}
              title="Force recall"
              className="text-xs text-gray-400 hover:text-red-500 transition-colors flex items-center gap-0.5"
            >
              <Undo2 size={11} />
              <span className="text-[10px]">Recall</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
