import { Module, Global } from '@nestjs/common';
import { EventsGateway } from './events.gateway';
import { AuthModule } from '@api/admin/auth/auth.module';
import { SseRateLimiterModule } from '@api/common/rate-limit/sse-rate-limiter.module';

@Global() //  关键：设为全局，这样 GroupModule 不用 import 也能注入 Gateway
@Module({
  // 限流器下沉到 common/rate-limit 后单独成模块：
  // EventsModule 与 AiCustomerModule 各自 import，避免二者互相 import 成环。
  imports: [AuthModule, SseRateLimiterModule],
  providers: [EventsGateway],
  exports: [EventsGateway], // 导出给别人用
})
export class EventsModule {}
