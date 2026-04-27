import { Logger } from '@nestjs/common';

export function DistributedLock(
  keyPattern: string,
  ttl: number = 10000,
  throwOnFail: boolean = true,
) {
  return function (
    target: any,
    propertyKey: string,
    descriptor: PropertyDescriptor,
  ) {
    const originalMethod = descriptor.value;
    const logger = new Logger('DistributedLock'); // 增加装饰器内部日志

    descriptor.value = async function (this: any, ...args: any[]) {
      // 1. 自动寻找锁服务 (兼容两种常用命名)
      const lockService = this.lockService || this.redisLockService;

      if (!lockService) {
        // 这里不要直接 throw Error，否则 Cron 报错你根本看不见
        logger.error(
          `[LockError] ${target.constructor.name || 'Service'} 缺少 'lockService' 属性，请确保在构造函数中 public readonly lockService: RedisLockService`,
        );
        return await originalMethod.apply(this, args); // 降级处理：找不到锁服务就直接执行
      }

      // 2. 解析 Key
      let finalKey = keyPattern;
      try {
        finalKey = keyPattern.replace(
          /{(\d+)(\.[\w.]+)?}/g,
          (match, indexStr, path) => {
            const index = parseInt(indexStr);
            const arg = args[index];
            if (arg === undefined || arg === null) return 'undefined';
            if (!path) return String(arg);
            // 增加路径解析的安全处理
            const pathParts = path.substring(1).split('.');
            let val = arg;
            for (const part of pathParts) {
              val = val?.[part];
            }
            return String(val ?? 'undefined');
          },
        );
      } catch (e) {
        logger.error(`[LockError] 解析 Key 失败: ${keyPattern}`, e);
      }

      // 3. 执行加锁逻辑
      try {
        return await lockService.runWithLock(
          finalKey,
          ttl,
          async () => {
            return await originalMethod.apply(this, args);
          },
          throwOnFail,
        );
      } catch (error) {
        // 如果 throwOnFail 为 false (Cron场景)，抢锁失败会走到这里或被 runWithLock 吸收
        if (throwOnFail) {
          throw error;
        }
        // Cron 场景下，抢锁失败通常不打印 Error 日志，避免刷屏
        return;
      }
    };

    return descriptor;
  };
}
