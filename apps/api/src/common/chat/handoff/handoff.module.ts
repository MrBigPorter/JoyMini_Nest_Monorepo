import { Global, Module } from '@nestjs/common';
import { PrismaModule } from '@api/common/prisma/prisma.module';
import { HandoffLifecycleService } from './handoff-lifecycle.service';
import { HandoffPresenceService } from './handoff-presence.service';
import { HANDOFF_LIFECYCLE } from './handoff.tokens';

/**
 * 交接生命周期模块。
 *
 * @Global：EventsGateway / ChatService / 管理端都需要用到它。设为全局后
 * EventsGateway 可以注入 HANDOFF_LIFECYCLE 令牌，而不需要 EventsModule
 * 反向 import 本模块（避免 events ↔ handoff 的模块环）。
 *
 * EventsGateway 由全局 EventsModule 导出，ConfigService/EventEmitter2 也是全局，
 * 这里只需显式引入 PrismaModule。
 */
@Global()
@Module({
  imports: [PrismaModule],
  providers: [
    HandoffLifecycleService,
    HandoffPresenceService,
    // 窄接口令牌：给 EventsGateway 用，避免 events ↔ handoff 的文件级循环依赖。
    { provide: HANDOFF_LIFECYCLE, useExisting: HandoffLifecycleService },
  ],
  exports: [HandoffLifecycleService, HandoffPresenceService, HANDOFF_LIFECYCLE],
})
export class HandoffModule {}
