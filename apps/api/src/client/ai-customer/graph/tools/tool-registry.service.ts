import { Inject, Injectable } from '@nestjs/common';
import { DynamicStructuredTool } from '@langchain/core/tools';

//注入 token，OrderModule,Product等 用这个标签往篮子里放东西：{ provide: 'AI_TOOLS', useFactory: ..., multi: true }
//multi: true 的作用是让多个模块往同一个篮子里放东西时不会覆盖，而是自动合并成一个数组。
export const AI_TOOLS = 'AI_TOOLS';

//给 ToolRegistryService 加一个 getToolsByTag() 方法，每个工具注册时带上标签
export interface TaggedTool {
  tool: DynamicStructuredTool;
  tags: string[]; // 例如 ['order'], ['wallet']
}

/**
 * 工具注册服务
 * 1. 注入所有带有 AI_TOOLS 标签的工具
 * 2. 提供 getAllTools() 方法获取所有工具
 * 3. 提供 getToolsByTag(tag) 方法获取指定标签的工具
 */
@Injectable()
export class ToolRegistryService {
  constructor(
    // 自动注入
    @Inject(AI_TOOLS) private readonly allTaggedTools: TaggedTool[],
  ) {}

  /**
   * 获取所有工具列表
   */
  getAllTools(): DynamicStructuredTool[] {
    return this.allTaggedTools.map((t) => t.tool);
  }

  /**
   * 根据标签获取工具列表
   * @param tag
   */
  getToolsByTag(tag: string): DynamicStructuredTool[] {
    return this.allTaggedTools
      .filter((t) => t.tags.includes(tag))
      .map((t) => t.tool);
  }
}
