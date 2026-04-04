import { Module } from '@nestjs/common';
import { PrismaModule } from '@api/common/prisma/prisma.module';
import { OperationLogController } from './operation-log.controller';
import { OperationLogService } from './operation-log.service';

@Module({
  imports: [PrismaModule],
  controllers: [OperationLogController],
  providers: [OperationLogService],
  exports: [OperationLogService],
})
export class OperationLogModule {}
