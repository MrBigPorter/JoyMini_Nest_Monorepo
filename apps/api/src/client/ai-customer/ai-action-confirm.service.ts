import { Injectable, Logger } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { RedisService } from '@api/common/redis/redis.service';

interface ConfirmPayload {
  action: string;
  params: Record<string, any>;
  summary: Record<string, any>;
  userId: string;
  /** 对应 ai_action_requests.id，用于回写确认/执行/失败终态。 */
  requestId?: string;
  /** 结果事件（AI_ACTION_RESULT）要回投到哪个会话。 */
  conversationId?: string;
}

import { CONFIRM_TOKEN_TTL_SEC } from './ai-action.constants';

const TOKEN_PREFIX = 'ai:confirm:';
/** 待执行任务有效期：用户要去看短信、输码，必须 ≥ OTP 有效期，多留 30s 缓冲 */
const PENDING_TTL_SEC = (Number(process.env.OTP_TTL_SECONDS) || 300) + 30;

/**
 * 原子「校验归属 + 删除」。
 *
 * 旧实现 getDel 先删再比较 userId：别人拿到/误传 token 可以先消费掉，
 * 导致真正的持有者拿到 null（DoS）。
 *
 * 这里把检查与删除放进同一个 Lua 脚本，Redis 单线程原子执行：
 *   - key 不存在 / 已过期        → 返回 nil（不删除任何东西）
 *   - JSON 中的 userId ≠ ARGV[1] → 返回 nil，**保留 key**（真主人仍可消费）
 *   - userId 匹配                → DEL 并返回原始 payload
 * 因此只有正确 owner 能消费，且只能消费一次。
 */
const CONSUME_IF_OWNER_LUA = `
local raw = redis.call('GET', KEYS[1])
if not raw then
  return nil
end
local ok, decoded = pcall(cjson.decode, raw)
if not ok or type(decoded) ~= 'table' then
  return nil
end
if decoded['userId'] ~= ARGV[1] then
  return nil
end
redis.call('DEL', KEYS[1])
return raw
`;

@Injectable()
export class AiActionConfirmService {
  private readonly logger = new Logger(AiActionConfirmService.name);
  /** 待执行暂存：OTP 双保险的中间状态（预约单已消费，参数暂存等验码） */
  private readonly PENDING_KEY = 'ai:confirm:pending:';

  constructor(private readonly redisService: RedisService) {}

  async generate(
    userId: string,
    action: string,
    params: Record<string, any>,
    summary: Record<string, any>,
    requestId?: string,
    conversationId?: string,
  ) {
    const token = uuidv4();
    const payload: ConfirmPayload = {
      action,
      params,
      summary,
      userId,
      ...(requestId ? { requestId } : {}),
      ...(conversationId ? { conversationId } : {}),
    };
    await this.redisService.set(
      `${TOKEN_PREFIX}${token}`,
      JSON.stringify(payload),
      CONFIRM_TOKEN_TTL_SEC,
    );
    return { token, expiresAt: Date.now() + CONFIRM_TOKEN_TTL_SEC * 1000 };
  }

  async consume(token: string, userId: string): Promise<ConfirmPayload | null> {
    const key = `${TOKEN_PREFIX}${token}`;
    // 原子：先校验 owner，匹配才删；错 owner 不删除、不返回 payload
    const raw = await this.redisService.eval(
      CONSUME_IF_OWNER_LUA,
      [key],
      [userId],
    );

    if (!raw) {
      // 不存在 / 已过期 / owner 不匹配，统一不区分以避免泄露 token 归属
      this.logger.warn(`Token ${token} not consumable (missing/expired/owner)`);
      return null;
    }
    return JSON.parse(raw as string);
  }

  async stagePendingExecution(
    userId: string,
    payload: ConfirmPayload,
  ): Promise<void> {
    await this.redisService.set(
      `${this.PENDING_KEY}${userId}`,
      JSON.stringify(payload),
      PENDING_TTL_SEC,
    );
  }

  /**
   * 只看不删：验码失败时任务还在，用户可以重新输码。
   * 真正的删除留给验码通过后的 popPendingExecution（getDel 保原子性）。
   */
  async peekPendingExecution(userId: string): Promise<ConfirmPayload | null> {
    const key = `${this.PENDING_KEY}${userId}`;
    const raw = await this.redisService.get(key);

    if (!raw) {
      return null;
    }
    return JSON.parse(raw);
  }

  async popPendingExecution(userId: string): Promise<ConfirmPayload | null> {
    const key = `${this.PENDING_KEY}${userId}`;
    const raw = await this.redisService.getDel(key); // 原子读+删，防重放

    if (!raw) {
      this.logger.warn(`No pending execution for user ${userId}`);
      return null;
    }
    const payload: ConfirmPayload = JSON.parse(raw);
    return payload;
  }
}
