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
    const raw = await this.redisService.get(key);
    if (!raw) {
      this.logger.warn(`Token ${token} not found or expired`);
      return null;
    }
    await this.redisService.del(key);
    const payload: ConfirmPayload = JSON.parse(raw);
    if (payload.userId !== userId) {
      this.logger.warn(`Token ${token} userId mismatch`);
      return null;
    }
    return payload;
  }
}
