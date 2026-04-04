import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import { createClient, RedisClientType } from 'redis';

const UNLOCK_SCRIPT = `
   if redis.call("get", KEYS[1]) == ARGV[1] then
       return redis.call("del", KEYS[1])
   else
       return 0
   end
`;

@Injectable()
export class RedisLockService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisLockService.name);
  private client: RedisClientType | undefined;

  constructor(private readonly configService: ConfigService) {}

  /**
   * 模块初始化时建立 Redis 连接
   */
  async onModuleInit() {
    const redisUrl = this.configService.get<string>('REDIS_URL');
    if (!redisUrl) {
      throw new Error('REDIS_URL is not defined in configuration');
    }

    this.client = createClient({
      url: redisUrl,
    });

    this.client.on('error', (err) => {
      this.logger.error('Redis Client Error', err);
    });

    await this.client.connect();
    this.logger.log('🔐 Redis Lock Client connected successfully (Dedicated)');
  }

  /**
   * 模块销毁时关闭 Redis 连接
   */
  async onModuleDestroy() {
    if (this.client) {
      await this.client.quit();
      this.logger.log('Redis Lock Client disconnected successfully.');
    }
  }

  /**
   * 使用 Redis 分布式锁执行回调函数
   * @param key 锁的 Key
   * @param ttl 锁的超时时间（毫秒）
   * @param callback 要执行的异步回调函数
   * @param throwOnFail 获取锁失败时是否抛出异常 (默认 true)。Cron 任务建议传 false。
   */
  async runWithLock<T>(
    key: string,
    ttl: number,
    callback: () => Promise<T>,
    throwOnFail = true,
  ): Promise<T | undefined> {
    // 🔍 调试日志 1: 检查客户端状态
    if (!this.client?.isOpen) {
      this.logger.error(`❌ [RedisLock] Client not connected. Key: ${key}`);
      throw new Error('Redis Lock Client is not connected');
    }

    const lockValue = crypto.randomUUID();

    this.logger.log(`🔒 [RedisLock] 尝试加锁: ${key} (TTL: ${ttl})`);

    // 1. 加锁
    const result = await this.client.set(key, lockValue, {
      NX: true,
      PX: ttl,
    });

    // 2. 抢锁失败的处理逻辑
    if (result !== 'OK') {
      this.logger.warn(`⚠️ [RedisLock] 加锁失败 (被占用): ${key}`);
      if (throwOnFail) {
        throw new Error(`Lock busy: ${key}`); // API 场景：报错
      } else {
        return undefined; // Cron 场景：静默跳过
      }
    }

    this.logger.log(`✅ [RedisLock] 加锁成功! 执行业务逻辑...`);

    try {
      // 3. 执行业务
      return await callback();
    } finally {
      // 4. 解锁（只执行一次）
      try {
        this.logger.log(`🔓 [RedisLock] 准备解锁: ${key}`);
        await this.client.eval(UNLOCK_SCRIPT, {
          keys: [key],
          arguments: [lockValue],
        });
        this.logger.log(`✅ [RedisLock] 解锁成功: ${key}`);
      } catch (e) {
        this.logger.error(`Failed to release lock for key ${key}: ${e}`);
        // 不抛出异常，避免影响正常业务流程
      }
    }
  }
}
