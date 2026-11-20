import { Module } from '@nestjs/common';
import { AiMemoryAdminController } from './ai-memory-admin.controller';
import { AiMemoryAdminService } from './ai-memory-admin.service';
import { OperationLogModule } from '../operation-log/operation-log.module';

@Module({
  imports: [OperationLogModule],
  controllers: [AiMemoryAdminController],
  providers: [AiMemoryAdminService],
  exports: [AiMemoryAdminService],
})
export class AiMemoryAdminModule {}
