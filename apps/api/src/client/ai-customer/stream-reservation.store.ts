import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '@api/common/redis/redis.service';
import * as crypto from 'crypto';

/**
 * Steam 预留存储
 *
 * 两阶段 SSE 协议阶段 1 (POST /chat) 到阶段 2 (GET /chat/stream/:id)
 * 之间的桥梁：当用户 POST /chat 注册消息后，我们把消息参数存到 Redis，
 * 等用户 GET 连上来时消耗（consume）这个预留记录，开始执行 LangGraph。
 *
 * 生命周期：
 *   POST /chat  → create() → Redis (TTL=120s)
 *   GET /stream → consume() → Redis 标记为 consumed
 *   120s 内没 GET → Redis TTL 自动过期
 */
export interface StreamReservation {
  streamId: string;
  userId: string;
  message: string;
  sessionId: string;
  conversationId?: string;
  entryPoint?: string;
  metadata?: Record<string, any>;
  ip?: string;
  device?: any;
  createdAt: number;
  status: 'pending' | 'consumed' | 'expired';
}

@Injectable()
export class StreamReservationStore {
  private readonly logger = new Logger(StreamReservationStore.name);
  private readonly PREFIX = 'sse:reservation:';
  private readonly TTL = 120; // 120 秒内必须连 GET，否则过期

  constructor(private readonly redis: RedisService) {}

  /**
   * 创建预留记录
   * @returns streamId（UUID v4）
   */
  async create(
    userId: string,
    message: string,
    sessionId: string,
    ip?: string,
    device?: any,
    conversationId?: string,
    entryPoint?: string,
    metadata?: Record<string, any>,
  ): Promise<string> {
    const streamId = crypto.randomUUID();
    const reservation: StreamReservation = {
      streamId,
      userId,
      message,
      sessionId,
      conversationId,
      entryPoint,
      metadata,
      ip,
      device,
      createdAt: Date.now(),
      status: 'pending',
    };

    const key = `${this.PREFIX}${streamId}`;
    await this.redis.withTimeout(
      this.redis.set(key, JSON.stringify(reservation), this.TTL),
    );

    return streamId;
  }

  /**
   * 原子消耗 — 只有 status === 'pending' 才消耗成功
   *
   * 用 Lua 脚本保证原子性：
   * 两个 GET 同时连同一个 streamId，只有一个能消耗成功，
   * 另一个拿到 null → 404。
   *
   * Lua 脚本流程：
   *   1. GET key → 没数据？返回 nil
   *   2. status 不是 pending？返回 nil（已被消耗或过期）
   *   3. 标记为 consumed，重置 TTL
   *   4. 返回原始数据
   */
  async consume(streamId: string): Promise<StreamReservation | null> {
    const key = `${this.PREFIX}${streamId}`;

    try {
      const result = await this.redis.eval(
        `local key = KEYS[1]
         local ttl = tonumber(ARGV[1])
         local data = redis.call('GET', key)
         if not data then return nil end
         local parsed = cjson.decode(data)
         if parsed.status ~= 'pending' then return nil end
         parsed.status = 'consumed'
         redis.call('SET', key, cjson.encode(parsed), 'EX', ttl)
         return data`,
        [key],
        [this.TTL.toString()],
      );

      if (!result) return null;
      return JSON.parse(result as string) as StreamReservation;
    } catch (err) {
      this.logger.error(`[consume] Redis eval failed: ${err}`);
      return null;
    }
  }

  /**
   * 只读查询（不消耗）
   */
  async get(streamId: string): Promise<StreamReservation | null> {
    const key = `${this.PREFIX}${streamId}`;
    try {
      const data = await this.redis.withTimeout(this.redis.get(key));
      if (!data) return null;
      return JSON.parse(data) as StreamReservation;
    } catch (err) {
      this.logger.error(`[get] failed: ${err}`);
      return null;
    }
  }

  /**
   * 手动删除（用于清理）
   */
  async delete(streamId: string): Promise<void> {
    const key = `${this.PREFIX}${streamId}`;
    try {
      await this.redis.withTimeout(this.redis.del(key));
    } catch (err) {
      this.logger.error(`[delete] failed: ${err}`);
    }
  }
}
