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
const TTL_SEC = 60;

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
      TTL_SEC,
    );
    return { token, expiresAt: Date.now() + TTL_SEC * 1000 };
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
      TTL_SEC,
    );
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
