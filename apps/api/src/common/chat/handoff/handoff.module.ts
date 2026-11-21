import { Module } from '@nestjs/common';
import { PrismaModule } from '@api/common/prisma/prisma.module';
import { HandoffLifecycleService } from './handoff-lifecycle.service';

/**
 * 交接生命周期模块。
 *
 * EventsGateway 由全局 EventsModule 导出，ConfigService/EventEmitter2 也是全局，
 * 这里只需显式引入 PrismaModule。
 */
@Module({
  imports: [PrismaModule],
  providers: [HandoffLifecycleService],
  exports: [HandoffLifecycleService],
})
export class HandoffModule {}
