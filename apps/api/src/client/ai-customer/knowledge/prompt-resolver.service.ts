/**
 * PromptResolverService — Runtime Prompt Override Engine
 *
 * ── 是什么？ ──
 * 运行时 Prompt 解析器。当管理员通过 Admin 面板创建/更新 KnowledgePrompt 记录后，
 * mergeConfig() 在运行时检查 DB 中是否有活跃的 prompt override，如果有则将 DB 配置
 * 合并到 TS 默认配置之上。没有 override 时，直接返回 TS 默认配置（零影响）。
 *
 * ── 为什么不是直接改 TS 文件？ ──
 * 管理员需要可视化编辑 Prompt、版本管理、回滚、对比 diff。
 * TS 文件改完要重启，DB 方案支持热更新。
 *
 * ── 数据流 ──
 *   orchestrator 流水线
 *     │
 *     ├── mergeConfig(domain, tsConfig)
 *     │     ├── DB 有活跃 override → 合并后返回
 *     │     └── DB 无 override → 返回 tsConfig 原样
 *     │
 *     └── recordEval(data)  ← 对话完成后 fire-and-forget
 *
 * ── 与 AiPromptService 的关系 ──
 * AiPromptService: Admin 端（CRUD + 版本管理）
 * PromptResolverService: 运行时端（merge + eval）
 * 两者独立，不互相依赖。
 */
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@api/common/prisma/prisma.service';
import { AgentPromptConfig } from '@api/client/ai-customer/graph/agents/prompt-builder';

// ============================================================
// Types
// ============================================================

export interface MergedPromptResult {
  /** 合并后的 prompt config（DB override 应用在 TS defaults 之上） */
  config: Omit<AgentPromptConfig, 'userId'>;
  /** DB 中活跃的 version 号，无 override 时为 null */
  version: number | null;
  /** KB prompt name（即 domain 名），无 override 时为 null */
  promptName: string | null;
}

export interface EvalLogData {
  /** Prompt name（domain），如 'order'、'wallet' */
  promptName: string;
  /** 使用的 version 号 */
  version: number;
  /** 会话 ID */
  sessionId: string;
  /** 工具调用次数 */
  toolCallCount?: number;
  /** 工具失败次数 */
  toolFailCount?: number;
  /** 总 token 消耗 */
  totalTokens?: number;
  /** 延迟（毫秒） */
  latencyMs?: number;
  /** 是否被标记为幻觉 */
  hallucinationFlagged?: boolean;
  /** LLM-as-Judge 评分（0-1） */
  judgeScore?: number;
  /** 评分理由 */
  judgeReason?: string;
}

// ============================================================
// Service
// ============================================================

@Injectable()
export class PromptResolverService {
  private readonly logger = new Logger(PromptResolverService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * mergeConfig — 合并 DB override 到 TS 默认配置
   *
   * @param domain - Agent 域名（对应 KnowledgePrompt.name），如 'order'、'wallet'
   * @param tsConfig - TS 文件中的默认 AgentPromptConfig
   * @returns MergedPromptResult — 合并后的配置 + 版本信息
   *
   * ── 合并规则 ──
   * 1. 检查 KnowledgePrompt 表，查找 name=domain 且 status='active' 的记录
   * 2. 如果找到且 activeVersion > 0，获取对应版本号的 config JSON
   * 3. DB config 中的字段覆盖 TS defaults 中同名字段
   * 4. scopeRestriction 做深度合并（只覆盖 DB 中提供的字段）
   * 5. 如果没有活跃 override，返回 tsConfig 原样
   *
   * ── 性能 ──
   * DB 查询是主键 + 索引查询（UK: name, Index: promptId），
   * 每次 merge 开销 < 5ms。后续可加缓存 + configVersion 热更新。
   */
  async mergeConfig(
    domain: string,
    tsConfig: Omit<AgentPromptConfig, 'userId'>,
  ): Promise<MergedPromptResult> {
    try {
      // 1. 查找活跃的 KnowledgePrompt
      const dbPrompt = await this.prisma.knowledgePrompt.findFirst({
        where: {
          name: domain,
          status: 'active',
        },
        include: {
          versions: {
            where: { isActive: true },
            take: 1,
            orderBy: { version: 'desc' },
          },
        },
      });

      // 2. 没有活跃 override → 返回 TS 默认
      if (!dbPrompt || dbPrompt.versions.length === 0) {
        return { config: tsConfig, version: null, promptName: null };
      }

      const activeVersion = dbPrompt.versions[0];
      const dbConfig = activeVersion.config as Record<string, any>;

      // 3. 合并：DB 配置覆盖 TS 默认
      const merged: Omit<AgentPromptConfig, 'userId'> = {
        ...tsConfig,
        ...dbConfig,
      };

      // 4. scopeRestriction 深度合并
      if (dbConfig.scopeRestriction && tsConfig.scopeRestriction) {
        merged.scopeRestriction = {
          ...tsConfig.scopeRestriction,
          ...dbConfig.scopeRestriction,
        };
      } else if (dbConfig.scopeRestriction) {
        merged.scopeRestriction = dbConfig.scopeRestriction;
      }

      this.logger.log(
        `[PromptResolver] mergeConfig(${domain}): active v${activeVersion.version} applied`,
      );

      return {
        config: merged,
        version: activeVersion.version,
        promptName: dbPrompt.name,
      };
    } catch (err) {
      // 异常安全：DB 查询失败不阻塞流水线，回退到 TS 默认
      this.logger.error(
        `[PromptResolver] mergeConfig(${domain}) failed: ${(err as Error).message}`,
      );
      return { config: tsConfig, version: null, promptName: null };
    }
  }

  /**
   * recordEval — Fire-and-forget 评估日志写入
   *
   * 在 orchestrator 合成最终回复后调用，非阻塞写入 KnowledgePromptEvalLog。
   * 异常被静默捕获，不会影响对话流程。
   *
   * @param data - 评估日志数据
   */
  async recordEval(data: EvalLogData): Promise<void> {
    try {
      await this.prisma.knowledgePromptEvalLog.create({
        data: {
          promptName: data.promptName,
          version: data.version,
          sessionId: data.sessionId,
          toolCallCount: data.toolCallCount ?? 0,
          toolFailCount: data.toolFailCount ?? 0,
          totalTokens: data.totalTokens ?? 0,
          latencyMs: data.latencyMs,
          hallucinationFlagged: data.hallucinationFlagged ?? false,
          judgeScore: data.judgeScore,
          judgeReason: data.judgeReason,
        },
      });
    } catch (err) {
      // Fire-and-forget: 静默记录错误，绝不阻塞对话
      this.logger.error(
        `[PromptResolver] recordEval failed: ${(err as Error).message}`,
      );
    }
  }
}
