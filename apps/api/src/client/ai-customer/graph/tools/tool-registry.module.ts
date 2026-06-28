import { Global, Module } from '@nestjs/common';
import { ToolRegistryService } from '@api/client/ai-customer/graph/tools/tool-registry.service';

/**
 * 工具注册共享模块
 *
 * 职责：
 * - 提供 ToolRegistryService 全局单例
 * - 各 domain module 通过 OnApplicationBootstrap 自行注册工具
 *
 * 使用方式：
 * 1. 在 ClientModule（或 AppModule）中导入此模块
 * 2. 任何模块通过构造函数注入 ToolRegistryService
 * 3. 在 OnApplicationBootstrap 钩子中调用 registerMany()
 *
 * @Global() 确保 ToolRegistryService 在所有模块中可见，
 * 无需每个模块显式导入 ToolRegistryModule。
 */
@Global()
@Module({
  providers: [ToolRegistryService],
  exports: [ToolRegistryService],
})
export class ToolRegistryModule {}
