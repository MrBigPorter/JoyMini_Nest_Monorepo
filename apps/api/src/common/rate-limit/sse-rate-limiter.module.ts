import { Module } from '@nestjs/common';
import { RedisModule } from '@api/common/redis/redis.module';
import { SseRateLimiterService } from './sse-rate-limiter.service';

/**
 * 入口限流共享模块。
 *
 * 为什么单独成模块（而不是把服务塞进 AiCustomerModule）：
 *   Socket 网关（EventsModule）和 HTTP SSE（AiCustomerModule）都要用同一个限流器。
 *   若 EventsModule 直接 import AiCustomerModule，会与 AiCustomerModule → EventsModule
 *   形成循环依赖。把限流器下沉到 common，两边各自 import 本模块即可，
 *   依赖图保持无环，且仍然只有一个 Redis 令牌桶实现（D5：不另写一套）。
 */
@Module({
  imports: [RedisModule],
  providers: [SseRateLimiterService],
  exports: [SseRateLimiterService],
})
export class SseRateLimiterModule {}
