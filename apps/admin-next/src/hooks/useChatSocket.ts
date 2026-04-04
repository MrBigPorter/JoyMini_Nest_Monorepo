'use client';

/**
 * useChatSocket — Admin 客服端 Socket.IO 实时连接
 *
 * 功能:
 *  - 连接到 /events namespace（复用 nginx /socket.io/ 代理）
 *  - join_chat / leave_chat 随会话切换
 *  - 监听 dispatch 事件: chat_message / message_recalled / conversation_updated
 *  - 暴露连接状态供 UI 显示
 */

import { useEffect, useRef, useCallback, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import type { ChatMessage } from '@/type/types';

export type SocketStatus =
  | 'connecting'
  | 'connected'
  | 'disconnected'
  | 'error';

interface UseChatSocketOptions {
  /** 当前打开的会话 ID（null = 未选中） */
  conversationId: string | null;
  /** 收到新消息时回调 */
  onMessage: (msg: ChatMessage) => void;
  /** 消息被撤回时回调 */
  onRecalled: (data: {
    conversationId: string;
    messageId: string;
    seqId?: number;
  }) => void;
  /** 会话信息更新时回调（用于刷新会话列表） */
  onConversationUpdated?: (conversationId?: string) => void;
}

/** Raw payload shape from socket dispatch events (fields unverified at runtime) */
type RawSocketData = Record<string, unknown>;

/** 将 socket dispatch 推送的 raw data 映射为 ChatMessage */
function mapRawMessage(raw: RawSocketData): ChatMessage {
  return {
    id: (raw.id as string) ?? '',
    seqId: (raw.seqId as number) ?? 0,
    content: (raw.content as string) ?? '',
    type: (raw.type as number) ?? 0,
    isRecalled: (raw.isRecalled as boolean) ?? false,
    createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : Date.now(),
    meta: (raw.meta as ChatMessage['meta']) ?? null,
    senderId: (raw.senderId as string | null) ?? null,
    sender: (raw.sender as ChatMessage['sender']) ?? null,
    isSystem: (raw.isSystem as boolean) ?? raw.senderId === null,
  };
}

export function useChatSocket({
  conversationId,
  onMessage,
  onRecalled,
  onConversationUpdated,
}: UseChatSocketOptions) {
  const socketRef = useRef<Socket | null>(null);
  const currentRoomRef = useRef<string | null>(null);
  const [status, setStatus] = useState<SocketStatus>('disconnected');

  // ── stable callback refs so effect deps stay minimal ──
  const onMessageRef = useRef(onMessage);
  const onRecalledRef = useRef(onRecalled);
  const onConversationUpdatedRef = useRef(onConversationUpdated);
  useEffect(() => {
    onMessageRef.current = onMessage;
  }, [onMessage]);
  useEffect(() => {
    onRecalledRef.current = onRecalled;
  }, [onRecalled]);
  useEffect(() => {
    onConversationUpdatedRef.current = onConversationUpdated;
  }, [onConversationUpdated]);

  // ── 从 JWT token 中解析 userId ──
  const getUserIdFromToken = useCallback((token: string): string | null => {
    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      return payload.sub || null;
    } catch {
      return null;
    }
  }, []);

  // ── 建立 Socket 连接（只执行一次） ──
  useEffect(() => {
    const token =
      typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null;

    if (!token) return;

    const currentUserId = getUserIdFromToken(token);
    setStatus('connecting');

    /**
     * socket.io-client: io('/events') 使用当前浏览器 origin
     * nginx 代理: /socket.io/ → backend:3000
     * NestJS gateway namespace: /events
     */
    const socket = io('/events', {
      transports: ['websocket'],
      auth: { token },
      query: { token },
      reconnectionAttempts: 5,
      reconnectionDelay: 2000,
    });

    socketRef.current = socket;

    socket.on('connect', () => {
      setStatus('connected');

      // Admin 连接时自动加入自己的私有房间，用于接收新会话通知
      if (currentUserId) {
        const privateRoom = `user_${currentUserId}`;
        socket.emit('join_chat', { conversationId: privateRoom });
        currentRoomRef.current = privateRoom;
      }
    });

    socket.on('disconnect', () => {
      setStatus('disconnected');
    });

    socket.on('connect_error', () => {
      setStatus('error');
    });

    socket.on('reconnect', () => {
      setStatus('connected');
      // Re-join current room after reconnect
      if (currentRoomRef.current) {
        socket.emit('join_chat', { conversationId: currentRoomRef.current });
      }
    });

    // 统一分发事件监听
    socket.on('dispatch', (payload: { type: string; data: RawSocketData }) => {
      switch (payload.type) {
        case 'chat_message':
          onMessageRef.current(mapRawMessage(payload.data));
          onConversationUpdatedRef.current?.(
            payload.data.conversationId as string | undefined,
          );
          break;

        case 'message_recalled':
          onRecalledRef.current({
            conversationId: payload.data.conversationId as string,
            messageId: payload.data.messageId as string,
            seqId: payload.data.seqId as number | undefined,
          });
          break;

        case 'conversation_updated':
          onConversationUpdatedRef.current?.(
            payload.data.conversationId as string | undefined,
          );
          break;

        // Flutter 用户首次点击「联系客服」时，后端推送到 admin 私有房间
        // 触发 admin 侧会话列表刷新，无需等到用户发第一条消息
        case 'support_new_conversation':
          onConversationUpdatedRef.current?.(
            payload.data.conversationId as string | undefined,
          );
          break;
      }
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
      currentRoomRef.current = null;
      setStatus('disconnected');
    };
  }, [getUserIdFromToken]); // connect once on mount

  // ── 切换会话时 join/leave room ──
  useEffect(() => {
    const socket = socketRef.current;
    if (!socket || !socket.connected) return;

    // 离开旧房间
    if (currentRoomRef.current && currentRoomRef.current !== conversationId) {
      socket.emit('leave_chat', { conversationId: currentRoomRef.current });
    }

    // 进入新房间
    if (conversationId) {
      socket.emit('join_chat', { conversationId });
      currentRoomRef.current = conversationId;
    } else {
      currentRoomRef.current = null;
    }
  }, [conversationId]);

  /** 手动进入会话房间（例如 socket 重连后） */
  const joinRoom = useCallback((convId: string) => {
    socketRef.current?.emit('join_chat', { conversationId: convId });
  }, []);

  /** 发送消息 via Socket（带 ACK，10s 超时） */
  const sendViaSocket = useCallback(
    (
      convId: string,
      content: string,
      type = 0,
      tempId?: string,
    ): Promise<{ id: string; seqId: number }> => {
      return new Promise((resolve, reject) => {
        const socket = socketRef.current;
        if (!socket || !socket.connected) {
          reject(new Error('Socket not connected'));
          return;
        }
        const tid = tempId ?? `admin_${Date.now()}`;
        const timer = setTimeout(
          () => reject(new Error('Send timeout')),
          10_000,
        );
        socket.emit(
          'send_message',
          { conversationId: convId, content, type, tempId: tid },
          (ack: {
            status: string;
            data?: { id: string; seqId: number };
            message?: string;
          }) => {
            clearTimeout(timer);
            if (ack.status === 'ok' && ack.data) {
              resolve(ack.data);
            } else {
              reject(new Error(ack.message ?? 'Send failed'));
            }
          },
        );
      });
    },
    [],
  );

  return { status, joinRoom, sendViaSocket };
}
