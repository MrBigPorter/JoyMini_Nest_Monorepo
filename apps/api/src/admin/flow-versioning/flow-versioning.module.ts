import { Module } from '@nestjs/common';
import { FlowVersioningController } from './flow-versioning.controller';
import { OperationLogModule } from '../operation-log/operation-log.module';

@Module({
  imports: [OperationLogModule],
  controllers: [FlowVersioningController],
})
export class FlowVersioningAdminModule {}
