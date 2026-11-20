import { Module } from '@nestjs/common';
import { FlowVersioningController } from './flow-versioning.controller';

@Module({
  controllers: [FlowVersioningController],
})
export class FlowVersioningAdminModule {}
