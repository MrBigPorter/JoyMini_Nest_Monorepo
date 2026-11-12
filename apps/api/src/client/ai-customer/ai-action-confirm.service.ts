import { Injectable, Logger } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { RedisService } from '@api/common/redis/redis.service';

interface ConfirmPayload {
  action: string;
  params: Record<string, any>;
  summary: Record<string, any>;
  userId: string;
}

const TOKEN_PREFIX = 'ai:confirm:';
/** 卡片凭证有效期：用户点「确认」前的窗口，短一点更安全（不变） */
const TOKEN_TTL_SEC = 60;
/** 待执行任务有效期：用户要去看短信、输码，必须 ≥ OTP 有效期，多留 30s 缓冲 */
const PENDING_TTL_SEC = (Number(process.env.OTP_TTL_SECONDS) || 300) + 30;

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
  ) {
    const token = uuidv4();
    const payload: ConfirmPayload = { action, params, summary, userId };
    await this.redisService.set(
      `${TOKEN_PREFIX}${token}`,
      JSON.stringify(payload),
      TOKEN_TTL_SEC,
    );
    return { token, expiresAt: Date.now() + TOKEN_TTL_SEC * 1000 };
  }

  async consume(token: string, userId: string): Promise<ConfirmPayload | null> {
    const key = `${TOKEN_PREFIX}${token}`;
    const raw = await this.redisService.getDel(key); // 原子读+删，防重放

    if (!raw) {
      this.logger.warn(`Token ${token} not found or expired`);
      return null;
    }
    const payload: ConfirmPayload = JSON.parse(raw);
    if (payload.userId !== userId) {
      this.logger.warn(`Token ${token} userId mismatch`);
      return null;
    }
    return payload;
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
