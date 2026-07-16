// ============================================================
// 文件: apps/api/src/common/ai/ai-memory.service.ts
// 用途: AI 长期记忆持久化 — 把 AI 对话写入 Conversation + ChatMessage 表
// 调用方: AiCustomerService（SSE done 事件后调用 saveContext）
// ============================================================
//
// 生活类比: 这个 Service = 超市收银台
//   createOrGetAiConversation = 办会员卡（有卡直接刷，没卡先开卡）
//   saveContext               = 打印购物小票（对话结束记到账上）
//   getNextSeqId              = 取号机（流水号不能重号）

import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@api/common/prisma/prisma.service';
import { RedisService } from '@api/common/redis/redis.service';
import { ConversationType, Prisma } from '@prisma/client';
import { BaseMessage } from '@langchain/core/messages';
import { randomUUID } from 'node:crypto';

@Injectable()
export class AiMemoryService {
  private readonly logger = new Logger(AiMemoryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
  ) {}

  // ================================================================
  //  getNextSeqId — 原子 seqId 发号器
  // ================================================================
  //
  // 生活类比: 银行取号机
  // 两个人同时按"取号"，机器吐出两个不同的号，不会重复
  //
  // 为什么用 Redis INCR 而不是数据库自增？
  //   现有 IM 的 seqId 是每次发一条消息时用 Prisma 的 increment: 1 拿号。
  //   但 AI 消息是批量写入（一次存多条），无法用 increment 逐条拿号。
  //   Redis INCR 是原子操作，批量调用 N 次得到 N 个连续不重复的号。
  //
  // 不这样会怎样: 两个 SSE 请求同时写入，seqId 相同 → 客户端拉历史时消息乱序
  private async getNextSeqId(conversationId: string): Promise<number> {
    const key = `ai:seq:${conversationId}`;
    const seqId = await this.redisService.incr(key);

    // 设置 7 天 TTL，避免 Redis 内存长期占用
    await this.redisService.expire(key, 60 * 60 * 24 * 7);

    return seqId;
  }

  // ================================================================
  //  createOrGetAiConversation — 创建/获取 AI 会话
  // ================================================================
  //
  // 生活类比: 理发店报手机号
  // 报号 → 查系统 → 有卡直接剪，没卡先开卡
  //
  // conversationId 参数:
  //   传 → 指定已有 SUPPORT 对话，AI 在该对话内处理
  //   不传 → 兼容旧逻辑：自动创建/复用 ai_chat:{userId} 对话
  //
  // 旧逻辑（无 conversationId）:
  //   businessId = "ai_chat:{userId}" 是 @unique 约束
  //     → 一个用户只有一条 AI 对话
  //     → 再次点击直接复用旧会话，历史记录不断
  //   type = ConversationType.AI
  //     → Flutter 端通过 conv.type 区分 AI / 普通对话
  async createOrGetAiConversation(
    userId: string,
    conversationId?: string,
  ) {
    // ── 指定了 conversationId → 使用已有 SUPPORT 对话 ──
    if (conversationId) {
      const conv = await this.prisma.conversation.findUnique({
        where: { id: conversationId },
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

  // ================================================================
  //  saveContext — SSE 流完成后保存本轮对话
  // ================================================================
  //
  // 生活类比: 打印购物小票
  // 结账时把本次买的每件商品逐条记到购物记录里，
  // 同时更新购物卡（对话快照）的最新信息。
  //
  // 参数:
  //   threadId — LangGraph threadId，用来定位 Conversation
  //   messages — 本轮新增的 BaseMessage[]
  //
  // 调用时机: SSE done 事件后，由 AiCustomerService 调用
  //   只传新消息，不传全量历史（避免重复写入）
  //
  // 核心流程:
  //   1. 查 Conversation（通过 threadId）
  //   2. 预分配 seqId（Redis INCR × N）
  //   3. 在一个事务里: 批量创建消息 + 更新对话快照
  //   4. Redis 热缓存

  async saveContext(
    threadId: string,
    messages: BaseMessage[],
  ): Promise<void> {
    // ===== 边界检查 =====
    if (!messages || messages.length === 0) {
      this.logger.warn(`saveContext: empty messages for threadId=${threadId}`);
      return;
    }

    // ===== 第 1 步：查 Conversation =====
    const conversation = await this.prisma.conversation.findUnique({
      where: { threadId },
    });
    if (!conversation) {
      throw new NotFoundException(
        `Conversation not found for threadId=${threadId}`,
      );
    }

    // ===== 第 2 步：预分配 seqId =====
    const seqIds: number[] = [];
    for (let i = 0; i < messages.length; i++) {
      seqIds.push(await this.getNextSeqId(conversation.id));
    }

    // ===== 第 3+4 步：事务内写入消息 + 更新快照 =====
    //
    // 为什么需要事务？createMany 和 UPDATE 是两个独立操作
    // 没有事务: 消息入库了但快照没更新 → 对话列表显示旧内容
    // 有了事务: 要么全部成功，要么全部回滚

    const messageData: Prisma.ChatMessageCreateManyInput[] = messages.map(
      (msg, i) => ({
        conversationId: conversation.id,
        senderId: null,
        type: this.mapRoleToChatType(msg._getType()),
        content: this.serializeContent(msg),
        role: msg.type,
        tokenCount: this.estimateTokenCount(msg),
        source: msg.type === 'human' ? 'user' : 'ai',
        seqId: seqIds[i],
        meta: msg.additional_kwargs as Prisma.InputJsonValue,
      }),
    );

    await this.prisma.$transaction(async (tx) => {
      // 第 3 步：批量写入消息
      await tx.chatMessage.createMany({ data: messageData });

      // 第 4 步：原子更新对话快照
      await tx.$executeRaw`
        UPDATE "Conversation"
        SET
          "lastMsgSeqId" = ${seqIds[seqIds.length - 1]},
          "lastMsgContent" = ${this.getLastMsgPreview(messages)},
          "lastMsgType" = 8,
          "lastMsgTime" = NOW()
        WHERE id = ${conversation.id}
      `;
    });

    // ===== 第 5 步：Redis 热缓存（fire-and-forget） =====
    await this.redisService.set(
      `ai:hot:${threadId}`,
      JSON.stringify(messageData.slice(-3)),
      3600,
    );

    this.logger.log(
      `saveContext: saved ${messages.length} msgs, lastSeqId=${seqIds[seqIds.length - 1]}`,
    );
  }

  // ================================================================
  //  辅助方法
  // ================================================================

  /** LangChain role → ChatMessage.type */
  private mapRoleToChatType(role: string): number {
    switch (role) {
      case 'ai':     return 8;   // AI 消息
      case 'system': return 99;  // 系统消息
      case 'human':
      case 'tool':
      default:       return 0;   // 文本
    }
  }

  /** BaseMessage.content → 字符串 */
  private serializeContent(msg: BaseMessage): string {
    if (typeof msg.content === 'string') return msg.content;
    return JSON.stringify(msg.content);
  }

  /** 粗略估算 token 数（1 token ≈ 4 字符） */
  private estimateTokenCount(msg: BaseMessage): number {
    return Math.ceil(this.serializeContent(msg).length / 4);
  }

  /** 从 messages 中提取对话列表预览文本 */
  private getLastMsgPreview(messages: BaseMessage[]): string {
    const lastAiMsg = [...messages]
      .reverse()
      .find((m) => m.type === 'ai');
    if (lastAiMsg) {
      return this.truncateContent(this.serializeContent(lastAiMsg), 100);
    }
    return this.truncateContent(
      this.serializeContent(messages[messages.length - 1]),
      100,
    );
  }

  private truncateContent(content: string, maxLen: number): string {
    if (content.length <= maxLen) return content;
    return content.slice(0, maxLen) + '...';
  }
}
