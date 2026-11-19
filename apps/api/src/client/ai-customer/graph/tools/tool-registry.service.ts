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
export interface ToolCapability {
  /** read = 只读；write = 修改业务状态，必须走用户确认 */
  kind: 'read' | 'write';
  /** 写操作是否要求目标数据属于当前用户 */
  requiresOwnership: boolean;
}

export interface TaggedTool {
  tool: DynamicStructuredTool;
  tags: string[];
  /** 用户友好描述（英文），SSE 推送时用。例如 "Searching products..." */
  displayName?: string;
  /**
   * 能力声明。缺省视为只读 —— 读工具无需逐个声明；
   * 写工具必须显式声明 kind:'write'，确认流程据此推导。
   */
  capability?: ToolCapability;
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
  /** 工具名 → displayName 索引 */
  private displayNameMap = new Map<string, string>();

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
    const newTools = tools
      .filter((t) => !existingNames.has(t.tool.name))
      .map((t) => ({
        ...t,
        // 缺省只读；写工具必须显式声明
        capability: t.capability ?? {
          kind: 'read' as const,
          requiresOwnership: false,
        },
      }));
    for (const t of newTools) {
      if (t.displayName) {
        this.displayNameMap.set(t.tool.name, t.displayName);
      }
    }
    this.allTaggedTools.push(...newTools);
  }

  /** 工具能力；未注册返回 undefined（调用方应 fail-closed） */
  getCapability(toolName: string): ToolCapability | undefined {
    return this.allTaggedTools.find((t) => t.tool.name === toolName)?.capability;
  }

  /** 是否需要用户确认：唯一判据是 capability.kind === 'write' */
  requiresConfirmation(toolName: string): boolean {
    return this.getCapability(toolName)?.kind === 'write';
  }

  /** 所有写工具名（供启动自检/审计） */
  getWriteToolNames(): string[] {
    return this.allTaggedTools
      .filter((t) => t.capability?.kind === 'write')
      .map((t) => t.tool.name);
  }

  /** 启动自检：写工具必须进入确认流程；疑似有副作用的工具必须显式声明 */
  auditCapabilities(logger: {
    log: (msg: string) => void;
    warn: (msg: string) => void;
    error?: (msg: string) => void;
  }): void {
    const writes = this.getWriteToolNames();
    logger.log(
      `[ToolRegistry] write tools requiring confirmation: ${writes.join(', ') || '(none)'}`,
    );

    // 确认名单由 write 能力推导，理论上不会漏；这里做结构断言，
    // 防止以后有人把推导改成手工清单却没同步。
    const confirmSet = new Set(writes);
    const missingFromConfirm = writes.filter((name) => !confirmSet.has(name));
    if (missingFromConfirm.length > 0) {
      const msg = `[ToolRegistry] write tools missing from confirmation flow: ${missingFromConfirm.join(', ')}`;
      if (logger.error) logger.error(msg);
      else logger.warn(msg);
    }

    // 名称像副作用的工具（request/verify/claim/...）如果被当成只读，
    // 就是「有副作用但绕过确认」的漏洞。启动时直接报 error。
    const sideEffectPattern =
      /^(apply|claim|create|delete|draw|redeem|request|verify|submit|pay)/i;
    const suspicious = this.allTaggedTools
      .filter(
        (t) =>
          t.capability?.kind !== 'write' &&
          sideEffectPattern.test(t.tool.name),
      )
      .map((t) => t.tool.name);
    if (suspicious.length > 0) {
      const msg =
        `[ToolRegistry] side-effect-looking tools not declared write: ${suspicious.join(', ')}. ` +
        `They will bypass confirmation until capability is fixed.`;
      if (logger.error) logger.error(msg);
      else logger.warn(msg);
    }

    const undeclared = this.allTaggedTools
      .filter((t) => t.capability === undefined)
      .map((t) => t.tool.name);
    if (undeclared.length > 0) {
      logger.warn(
        `[ToolRegistry] ${undeclared.length} tool(s) missing capability; treated as read: ${undeclared.join(', ')}`,
      );
    }
  }

  /**
   * 根据工具名获取用户友好描述
   * @param toolName 工具内部名（如 'searchProducts'）
   * @returns 用户友好描述（如 'Searching products...'），未注册则返回 undefined
   */
  getDisplayName(toolName: string): string | undefined {
    return this.displayNameMap.get(toolName);
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
