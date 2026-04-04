import { Module } from '@nestjs/common';
import { PrismaModule } from '@api/common/prisma/prisma.module';
import { NotificationModule as ClientNotificationModule } from '@api/client/notification/notification.module';
import { OperationLogModule } from '@api/admin/operation-log/operation-log.module';
import { AdminNotificationController } from './notification.controller';
import { AdminNotificationService } from './notification.service';

@Module({
  imports: [PrismaModule, ClientNotificationModule, OperationLogModule],
  controllers: [AdminNotificationController],
  providers: [AdminNotificationService],
  exports: [],
})
export class AdminNotificationModule {}
