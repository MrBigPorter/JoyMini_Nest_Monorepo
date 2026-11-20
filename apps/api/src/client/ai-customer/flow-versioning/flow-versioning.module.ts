import { Global, Module } from '@nestjs/common';
import { FlowStateVersioningService } from './flow-state-versioning.service';

/**
 * 流程版本服务需要被 AiCustomerService（运行时懒绑定）和管理端
 * （定义/绑定/回滚）同时使用，做成全局模块避免循环 import。
 */
@Global()
@Module({
  providers: [FlowStateVersioningService],
  exports: [FlowStateVersioningService],
})
export class FlowVersioningModule {}
