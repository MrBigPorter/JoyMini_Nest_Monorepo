import { Global, Module } from '@nestjs/common';
import { AiTracesController } from './ai-traces.controller';
import { TraceService } from './ai-traces.service';

/**
 * 链路追踪模块。
 *
 * 这里用 @Global 是为了让客户端 AiCustomerService 能注入 TraceService 做埋点，
 * 而不必改动 AiCustomerModule 的 imports —— 权限边界仍由控制器上的 Guard 把关。
 * 在 AppModule 中注册一次即可（controller 也随模块一起挂载）。
 */
@Global()
@Module({
  controllers: [AiTracesController],
  providers: [TraceService],
  exports: [TraceService],
})
export class AiTracesModule {}
