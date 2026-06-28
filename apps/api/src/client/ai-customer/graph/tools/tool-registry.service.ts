import { Injectable } from '@nestjs/common';
import { DynamicStructuredTool } from '@langchain/core/tools';

export interface TaggedTool {
  tool: DynamicStructuredTool;
  tags: string[];
}

/**
 * 工具注册服务
 * 各 domain module 在 OnApplicationBootstrap 时通过 registerMany() 自行注册工具。
 * 使用方式：
 *   class SomeModule implements OnApplicationBootstrap {
 *     constructor(private toolRegistry: ToolRegistryService) {}
 *     onApplicationBootstrap() {
 *       this.toolRegistry.registerMany(createSomeTools(...));
 *     }
 *   }
 */
@Injectable()
export class ToolRegistryService {
  private allTaggedTools: TaggedTool[] = [];

  /**
   * 注册多个工具
   */
  registerMany(tools: TaggedTool[]): void {
    this.allTaggedTools.push(...tools);
  }

  /**
   * 获取所有工具列表
   */
  getAllTools(): DynamicStructuredTool[] {
    return this.allTaggedTools.map((t) => t.tool);
  }

  /**
   * 根据标签获取工具列表
   * @param tag 例如 'wallet', 'order'
   */
  getToolsByTag(tag: string): DynamicStructuredTool[] {
    return this.allTaggedTools
      .filter((t) => t.tags.includes(tag))
      .map((t) => t.tool);
  }
}
