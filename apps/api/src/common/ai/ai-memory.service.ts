// ============================================================
// 文件: apps/api/src/common/ai/ai-memory.service.ts
// 用途: 解析 AI 会话（创建/复用 Conversation + threadId）
//
// ── 记忆边界（2026-11-19 调整）──
// 跨轮对话状态由 LangGraph 的 Postgres checkpointer 持久化；
// IM 消息由 gateway / AiReplyPublisher 落 ChatMessage。
// 这里不再维护 ai:hot Redis 热缓存（只写不读，已删除），
// 避免出现「两套记忆源」互相打架。
// ============================================================

import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@api/common/prisma/prisma.service';
import { ConversationType } from '@prisma/client';
import { randomUUID } from 'node:crypto';

@Injectable()
export class AiMemoryService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 创建/获取 AI 会话。
   *
   * conversationId 参数:
   *   传 → 指定已有 SUPPORT 对话，AI 在该对话内处理（必须校验成员）
   *   不传 → 兼容旧逻辑：自动创建/复用 ai_chat:{userId} 对话
   */
  async createOrGetAiConversation(userId: string, conversationId?: string) {
    // ── 指定了 conversationId → 使用已有 SUPPORT 对话 ──
    if (conversationId) {
      const conv = await this.prisma.conversation.findFirst({
        where: {
          id: conversationId,
          type: ConversationType.SUPPORT, // 关键：会话的成员里必须有当前用户
          // 不是成员 → 查不到 → 和「会话不存在」走同一个出口
          members: { some: { userId } },
        },
        select: { id: true, threadId: true, type: true },
      });
      if (!conv || conv.type !== 'SUPPORT') {
        throw new NotFoundException(
          `Conversation ${conversationId} not found or not a support chat`,
        );
      }
      // 确保 threadId 存在（LangGraph 需要）
      if (!conv.threadId) {
        return this.prisma.conversation.update({
          where: { id: conversationId },
          data: { threadId: randomUUID() },
        });
      }
      return conv;
    }

    // ── 无 conversationId → 兼容旧逻辑 ──
    const businessId = `ai_chat:${userId}`;
    const existingConversation = await this.prisma.conversation.findUnique({
      where: { businessId },
    });
    if (existingConversation) {
      return existingConversation;
    }

    return this.prisma.conversation.create({
      data: {
        businessId,
        type: ConversationType.AI,
        name: 'AI Customer Service',
        threadId: randomUUID(),
      },
    });
  }
}
