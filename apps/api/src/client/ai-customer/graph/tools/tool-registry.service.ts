import { Injectable } from '@nestjs/common';
import { DynamicStructuredTool } from '@langchain/core/tools';

/**
 * TaggedTool — 带标签的工具
 *
 * ── 是什么？ ──
 * 把 LangChain 的 DynamicStructuredTool 和业务标签关联起来。
 * 一个工具可以有多个标签（如提现工具可以同时属于 'wallet' 和 'flow'）。
 * tags 就像超市商品的条形码——扫一下就知道属于哪个货架。
 */
export interface TaggedTool {
  tool: DynamicStructuredTool;
  tags: string[];
}

/**
 * ToolRegistryService — 工具注册服务
 *
 * ── 是什么？ ──
 * 全局单例（@Global + @Injectable），所有工具的"中央仓库"。
 *
 * ── 为什么需要 Registry Pattern（注册模式）？ ──
 * 如果不注册，每个 Agent 需要知道"哪些工具属于我"，就得硬编码一个列表。
 * 如果新增一个工具，就得改 Agent 代码。耦合度高。
 * 注册模式=每个模块（Wallet、Order 等）独立注册自己的工具，
 * Agent 按标签（tag）查询获取工具。新增工具只需在对应模块注册，不用改 Agent。
 *
 * ── 生活类比 ──
 * 这就像一个工具箱，每个部门把自己的工具放进去并贴上标签。
 * Wallet 部门放进去"查余额"、"提现"工具→贴标签"wallet"。
 * Order 部门放进去"查订单"工具→贴标签"order"。
 * Agent 来领任务时说"给我 wallet 标签的所有工具"→ToolRegistry 就给他。
 *
 * ── 怎么做？ ──
 * 模块实现 OnApplicationBootstrap：
 *   class WalletModule implements OnApplicationBootstrap {
 *     constructor(private toolRegistry: ToolRegistryService) {}
 *     onApplicationBootstrap() {
 *       this.toolRegistry.registerMany(createWalletTools(...));
 *     }
 *   }
 * Agent 获取工具：
 *   const tools = registry.getToolsByTag('wallet');
 */
@Injectable()
export class ToolRegistryService {
  /** 所有已注册的工具（含标签） */
  private allTaggedTools: TaggedTool[] = [];

  /**
   * 验证各 agent tag 是否已注册工具。
   * 由 AiCustomerModule.onApplicationBootstrap() 在最后调用（此时所有 domain module 已注册完毕）。
   *
   * ── 为什么需要验证？ ──
   * 如果某个模块忘记注册工具，Agent 运行时拿不到工具就会报错。
   * 验证在启动时立即发现，而不是在用户使用时才发现。
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
   *
   * ── 为什么要去重？ ──
   * NestJS 模块可能被多次加载（如果多个模块都 import 了同一个模块）。
   * registerMany 用 Set 去重，避免同一个工具被注册两次。
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
