import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, RedisClientType } from 'redis';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);

  private client!: RedisClientType;

  constructor(private readonly configService: ConfigService) {}

  async onModuleInit() {
    const redisUrl = this.configService.get<string>('REDIS_URL');
    if (!redisUrl) {
      throw new Error('REDIS_URL is not defined');
    }

    // 建立连接
    this.client = createClient({
      url: redisUrl,
      socket: {
        connectTimeout: 10000,
        reconnectStrategy: (retries) => {
          if (retries > 10) {
            this.logger.error('Redis max reconnection attempts reached, giving up');
            return new Error('Max reconnection attempts reached');
          }
          this.logger.warn(`Redis reconnecting, attempt ${retries}`);
          return Math.min(retries * 100, 3000);
        },
      },
    });

    this.client.on('error', (err) => {
      this.logger.error('Redis Client Error', err);
    });

    this.client.on('ready', () => {
      this.logger.log('✅ Redis General Client connected successfully');
    });

    await this.client.connect();
  }

  async onModuleDestroy() {
    if (this.client) {
      await this.client.quit();
      this.logger.log('Redis General Client disconnected');
    }
  }

  // ==========================================
  //  基础 Key-Value 操作
  // ==========================================

  async get(key: string): Promise<string | null> {
    return await this.client.get(key);
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    if (ttlSeconds) {
      await this.client.set(key, value, { EX: ttlSeconds });
    } else {
      await this.client.set(key, value);
    }
  }

  /**
   * 获取匹配模式的所有 Key
   * 注意：在生产环境 Key 数量极多时建议改用 scanIterator，
   * 但对于首页楼层这种 Key 数量有限的场景，KEYS 是最直接的。
   */
  async keys(pattern: string): Promise<string[]> {
    return await this.client.keys(pattern);
  }

  /**
   * 增强的删除方法：支持删除单个 Key 或 多个 Key
   */
  async del(...keys: string[]): Promise<number> {
    if (!keys || keys.length === 0) return 0;
    // Node-Redis v4 的 del 接收 string | string[]
    return await this.client.del(keys);
  }

  // ==========================================
  //  Set 集合操作 (黑名单用)
  // ==========================================

  async sismember(key: string, member: string): Promise<boolean> {
    return await this.client.sIsMember(key, member);
  }

  async sadd(key: string, member: string): Promise<number> {
    return await this.client.sAdd(key, member);
  }

  async srem(key: string, member: string): Promise<number> {
    return await this.client.sRem(key, member);
  }
}
