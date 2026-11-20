'use client';

import { useState } from 'react';
import { Headphones, User, Undo2, ThumbsUp, ThumbsDown } from 'lucide-react';
import { ModalManager } from '@repo/ui';
import { chatApi } from '@/api';
import { useToastStore } from '@/store/useToastStore';
import {
  ImageMessage,
  AudioMessage,
  VideoMessage,
  FileMessage,
  LocationMessage,
} from './messages';
import { formatMsgTime } from '@/lib/format-utils';
import { useTranslation } from '@/hooks/useTranslation';
import type { ChatMessage } from '@/type/types';

export function MessageBubble({
  msg,
  conversationId,
  onRecallAction,
}: {
  msg: ChatMessage;
  /** 反馈需要会话 ID；由 ChatWindow 传入 */
  conversationId?: string;
  onRecallAction?: (id: string) => void;
}) {
  const { t } = useTranslation();
  const addToast = useToastStore((state) => state.addToast);
  const [hovered, setHovered] = useState(false);
  const [feedbackSent, setFeedbackSent] = useState<
    'correct' | 'incorrect' | null
  >(null);
  const [feedbackLoading, setFeedbackLoading] = useState(false);
  const feedbackEnabled =
    process.env.NEXT_PUBLIC_AI_FEEDBACK_UI_ENABLED === 'true' &&
    msg.source === 'ai' &&
    Boolean(conversationId);

  const submitFeedback = async (
    verdict: 'correct' | 'incorrect',
    errorType?: string,
    note?: string,
  ) => {
    if (!conversationId) return;
    setFeedbackLoading(true);
    try {
      await chatApi.submitFeedback({
        conversationId,
        messageId: msg.id,
        verdict,
        errorType,
        note: note?.trim() || undefined,
      });
      setFeedbackSent(verdict);
      addToast('success', t('customerService.feedbackThanks'));
    } catch {
      addToast('error', t('customerService.feedbackFailed'));
    } finally {
      setFeedbackLoading(false);
    }
  };

  const openIncorrectFeedback = () => {
    ModalManager.open({
      title: t('customerService.feedbackTitle'),
      confirmText: t('customerService.feedbackSubmit'),
      cancelText: t('customerService.feedbackCancel'),
      onConfirm: async () => {
        const type = (
          document.getElementById('fb-error-type') as HTMLSelectElement
        )?.value;
        const note = (document.getElementById('fb-note') as HTMLTextAreaElement)
          ?.value;
        await submitFeedback('incorrect', type, note);
      },
      renderChildren: (
        <div className="space-y-3">
          <label className="block text-sm font-medium">
            {t('customerService.feedbackErrorType')}
            <select
              id="fb-error-type"
              defaultValue="irrelevant"
              className="mt-1 w-full border rounded-lg p-2 text-sm dark:bg-gray-800 dark:border-white/10"
            >
              <option value="irrelevant">
                {t('customerService.feedbackIrrelevant')}
              </option>
              <option value="outdated">
                {t('customerService.feedbackOutdated')}
              </option>
              <option value="overreach">
                {t('customerService.feedbackOverreach')}
              </option>
              <option value="format">
                {t('customerService.feedbackFormat')}
              </option>
            </select>
          </label>
          <label className="block text-sm font-medium">
            {t('customerService.feedbackNote')}
            <textarea
              id="fb-note"
              rows={3}
              maxLength={500}
              className="mt-1 w-full border rounded-lg p-2 text-sm dark:bg-gray-800 dark:border-white/10"
            />
          </label>
        </div>
      ),
    });
  };

  // type=99 系统通知（关闭会话等）
  if (msg.type === 99) {
    return (
      <div className="flex justify-center my-2">
        <span className="text-xs px-3 py-1 rounded-full bg-gray-100 dark:bg-white/10 text-gray-500 dark:text-gray-400">
          {msg.content ?? '只读账号不显示消息内容'}
        </span>
      </div>
    );
  }

  const isSupport = msg.isSystem; // senderId === null
  const senderName = isSupport
    ? ((msg.meta as Record<string, string> | null)?.agentName ??
      t('customerService.supportAgent'))
    : (msg.sender?.nickname ?? t('customerService.user'));

  const renderContent = () => {
    if (msg.isRecalled) {
      return (
        <span className="italic opacity-60 text-sm">
          {t('customerService.messageRecalled')}
        </span>
      );
    }
    // VIEWER 读接口返回 content=null；媒体类型不能拿 null 去拼 URL。
    if (msg.content == null) {
      return (
        <span className="italic opacity-60 text-sm">
          只读账号不显示消息内容
        </span>
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
          {/* AI 回答反馈（默认关闭，验证后开启） */}
          {feedbackEnabled && !feedbackSent && (
            <span className="flex items-center gap-1">
              <button
                disabled={feedbackLoading}
                onClick={() => void submitFeedback('correct')}
                title={t('customerService.feedbackCorrect')}
                className="text-gray-400 hover:text-teal-500 transition-colors disabled:opacity-40"
              >
                <ThumbsUp size={12} />
              </button>
              <button
                disabled={feedbackLoading}
                onClick={openIncorrectFeedback}
                title={t('customerService.feedbackWrong')}
                className="text-gray-400 hover:text-red-500 transition-colors disabled:opacity-40"
              >
                <ThumbsDown size={12} />
              </button>
            </span>
          )}
          {feedbackSent && (
            <span className="text-[10px] text-teal-500">
              {t('customerService.feedbackThanks')}
            </span>
          )}
          {/* 撤回按钮 — 仅对客服消息且非已撤回 */}
          {isSupport && !msg.isRecalled && onRecallAction && hovered && (
            <button
              onClick={() => onRecallAction(msg.id)}
              title="Force recall"
              className="text-xs text-gray-400 hover:text-red-500 transition-colors flex items-center gap-0.5"
            >
              <Undo2 size={11} />
              <span className="text-[10px]">{t('customerService.recall')}</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
