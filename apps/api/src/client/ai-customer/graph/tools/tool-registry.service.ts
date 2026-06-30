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
  /** 所有已注册的工具（含标签） */
  private allTaggedTools: TaggedTool[] = [];

  /**
   * 验证各 agent tag 是否已注册工具。
   * 由 AiCustomerModule.onApplicationBootstrap() 在最后调用（此时所有 domain module 已注册完毕）。
   */

  validateRegistration(
    expectedTags: string[],
    logger: { error: (msg: string) => void; log: (msg: string) => void },
  ): void {
    const registeredTags = new Set(this.allTaggedTools.flatMap((t) => t.tags));
    for (const tag of expectedTags) {
      if (!registeredTags.has(tag)) {
        logger.error(
          `🚨 Tool registration MISSING for tag "${tag}"! ` +
            `Did you forget to add OnApplicationBootstrap + registerMany()` +
            ` in the corresponding Module?`,
        );
      } else {
        const count = this.allTaggedTools.filter((t) =>
          t.tags.includes(tag),
        ).length;
        logger.log(`✅ Tag "${tag}": ${count} tools registered`);
      }
    }
  }

  /**
   * 注册多个工具
   */
  registerMany(tools: TaggedTool[]): void {
    const existingNames = new Set(this.allTaggedTools.map((t) => t.tool.name));
    const newTools = tools.filter((t) => !existingNames.has(t.tool.name));
    this.allTaggedTools.push(...newTools);
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
