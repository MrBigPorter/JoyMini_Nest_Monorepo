import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { PrismaService } from '@api/common/prisma/prisma.service';
import { RedisService } from '@api/common/redis/redis.service';
import { ToolRegistryService } from '@api/client/ai-customer/graph/tools/tool-registry.service';
import {
  FLOW_TYPE_REGISTRY,
  FlowType,
  getTaskType,
} from '@api/client/ai-customer/graph/types/flow-types';

const DEFINITION_SCHEMA_VERSION = 1;
const PROMPT_VERSION = 'ts-default';
const CONFIRM_VERSION = 'tool-capability-v1';

type FlowTypeKey = Exclude<FlowType, ''>;

export interface FlowDefinitionPayload {
  schemaVersion: number;
  flowType: FlowTypeKey;
  label: string;
  taskType: 'form' | 'query';
  allowedStatuses: string[];
  /** 步骤图：当前流程没有显式 step graph，保留扩展位。 */
  stepGraph: Record<string, string[]>;
  confirmMappings: Record<string, string>;
  promptVersion: string;
  /** 写工具集合决定确认链路；工具增删必须产生新版本。 */
  writeTools: string[];
}

export interface SwitchFlowDefinitionInput {
  conversationId: string;
  flowType?: string;
  toVersionId: string;
  actorId?: string;
  reason?: string;
}

export interface SwitchFlowDefinitionResult {
  ok: boolean;
  reason?: string;
}

/**
 * 稳定序列化：对象 key 递归排序。
 * JSON.stringify 的 key 顺序取决于插入顺序，直接哈希会让内容相同的定义
 * 生成不同 hash，版本号也就失去意义。
 */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(',')}}`;
}

export function computeDefinitionHash(payload: unknown): string {
  return createHash('sha256').update(stableStringify(payload)).digest('hex');
}

/**
 * 流程定义版本与会话绑定。
 *
 * ── 为什么需要版本？ ──
 * 流程升级时，新会话用新定义，旧会话保持旧定义；出问题可以只切回绑定指针，
 * 不重跑写操作。这里不撤销已完成的业务副作用。
 */
@Injectable()
export class FlowStateVersioningService {
  private readonly logger = new Logger(FlowStateVersioningService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly toolRegistry: ToolRegistryService,
  ) {}

  /**
   * 把代码里当前生效的流程配置登记为不可变版本（幂等）。
   *
   * 不在 onModuleInit 调用：工具注册发生在 AiCustomerModule 的
   * onApplicationBootstrap，过早登记会把空 writeTools 写进定义哈希。
   * 由首次绑定时懒注册，或管理端显式调用。
   */
  async ensureRuntimeDefinitions(): Promise<void> {
    const writeTools = this.toolRegistry.getWriteToolNames().sort();
    for (const flowType of Object.keys(FLOW_TYPE_REGISTRY) as FlowTypeKey[]) {
      await this.registerDefinition({
        flowType,
        payload: this.buildRuntimePayload(flowType, writeTools),
        createdBy: 'system',
      });
    }
  }

  async registerDefinition(input: {
    flowType: string;
    payload: FlowDefinitionPayload | Record<string, any>;
    createdBy?: string;
  }) {
    this.assertKnownFlowType(input.flowType);
    const flowType = input.flowType as FlowTypeKey;
    const hash = computeDefinitionHash(input.payload);

    const existing = await this.prisma.flowDefinitionVersion.findUnique({
      where: {
        flowType_definitionHash: { flowType, definitionHash: hash },
      },
    });
    if (existing) return existing;

    try {
      const latest = await this.prisma.flowDefinitionVersion.aggregate({
        where: { flowType },
        _max: { version: true },
      });
      return await this.prisma.flowDefinitionVersion.create({
        data: {
          flowType,
          version: (latest._max.version ?? 0) + 1,
          definitionHash: hash,
          payload: input.payload as any,
          status: 'ACTIVE',
          createdBy: input.createdBy,
        },
      });
    } catch (err: any) {
      // 并发启动/并发登记：另一个实例已写入同 hash 版本，直接复用。
      if (err?.code === 'P2002') {
        const winner = await this.prisma.flowDefinitionVersion.findUnique({
          where: {
            flowType_definitionHash: { flowType, definitionHash: hash },
          },
        });
        if (winner) return winner;
      }
      throw err;
    }
  }

  async getLatestDefinition(flowType: string) {
    return this.prisma.flowDefinitionVersion.findFirst({
      where: { flowType, status: 'ACTIVE' },
      orderBy: { version: 'desc' },
    });
  }

  /**
   * 新会话绑定当前最新版本；已存在绑定时原样返回（旧会话不跟随升级）。
   */
  async bindLatest(input: {
    conversationId: string;
    flowType: string;
    threadId?: string;
    actorId?: string;
    flowStep?: string;
  }) {
    this.assertKnownFlowType(input.flowType);
    const flowType = input.flowType as FlowTypeKey;

    const existing = await this.prisma.conversationFlowBinding.findUnique({
      where: {
        conversationId_flowType: {
          conversationId: input.conversationId,
          flowType,
        },
      },
    });
    if (existing) return existing;

    let definition = await this.getLatestDefinition(flowType);
    if (!definition) {
      // 懒注册：升级后第一次遇到该 flowType 时补登记。
      const writeTools = this.toolRegistry.getWriteToolNames().sort();
      definition = await this.registerDefinition({
        flowType,
        payload: this.buildRuntimePayload(flowType, writeTools),
        createdBy: 'system',
      });
    }

    const conversation = await this.prisma.conversation.findUnique({
      where: { id: input.conversationId },
      select: { threadId: true },
    });
    const threadId = input.threadId ?? conversation?.threadId ?? null;

    const binding = await this.prisma.conversationFlowBinding.create({
      data: {
        conversationId: input.conversationId,
        flowType,
        definitionVersionId: definition.id,
        definitionHash: definition.definitionHash,
        status: 'ACTIVE',
        flowStep: input.flowStep ?? 'IDLE',
        threadId,
      },
    });
    await this.writeAudit({
      conversationId: input.conversationId,
      flowType,
      action: 'BIND',
      actorId: input.actorId,
      toVersionId: definition.id,
      threadId,
    });
    return binding;
  }

  /** 运行时兜底：失败只记日志，不能影响本轮回复。 */
  async ensureBindingQuietly(
    conversationId: string | undefined,
    flowType: string | undefined,
    flowStep?: string,
  ): Promise<void> {
    if (!conversationId || !flowType) return;
    try {
      const binding = await this.bindLatest({
        conversationId,
        flowType,
        flowStep,
      });
      // 已绑定的旧会话只更新“走到哪一步”，定义版本保持不变。
      if (flowStep && binding.flowStep !== flowStep) {
        await this.prisma.conversationFlowBinding.updateMany({
          where: { conversationId, flowType },
          data: { flowStep },
        });
      }
    } catch (err: unknown) {
      this.logger.warn(
        `[FlowVersioning] lazy bind failed: conv=${conversationId}, flow=${flowType}, reason=${this.errText(err)}`,
      );
    }
  }

  async listDefinitions(flowType?: string) {
    return this.prisma.flowDefinitionVersion.findMany({
      where: flowType ? { flowType } : undefined,
      orderBy: [{ flowType: 'asc' }, { version: 'desc' }],
      take: 200,
      select: {
        id: true,
        flowType: true,
        version: true,
        definitionHash: true,
        status: true,
        createdBy: true,
        createdAt: true,
      },
    });
  }

  async listBindings(conversationId: string) {
    return this.prisma.conversationFlowBinding.findMany({
      where: { conversationId },
      orderBy: { flowType: 'asc' },
      include: {
        definition: {
          select: { version: true, status: true, definitionHash: true },
        },
      },
    });
  }

  /** 安全切换：只切绑定指针，不动 checkpoint、不撤销业务副作用。 */
  async switchDefinition(
    input: SwitchFlowDefinitionInput,
    action: 'SWITCH' | 'ROLLBACK_DEFINITION' = 'SWITCH',
  ): Promise<SwitchFlowDefinitionResult> {
    const target = await this.prisma.flowDefinitionVersion.findUnique({
      where: { id: input.toVersionId },
    });
    if (!target) return { ok: false, reason: 'target_version_not_found' };

    const flowType = input.flowType ?? target.flowType;
    if (target.flowType !== flowType) {
      return { ok: false, reason: 'flow_type_mismatch' };
    }
    if (action === 'SWITCH' && target.status !== 'ACTIVE') {
      return { ok: false, reason: 'target_version_not_active' };
    }
    if (action === 'ROLLBACK_DEFINITION' && target.status === 'DRAFT') {
      return { ok: false, reason: 'target_version_draft' };
    }

    const binding = await this.prisma.conversationFlowBinding.findUnique({
      where: {
        conversationId_flowType: {
          conversationId: input.conversationId,
          flowType,
        },
      },
    });
    if (!binding) return { ok: false, reason: 'binding_not_found' };
    if (binding.definitionVersionId === target.id) {
      return { ok: false, reason: 'same_version' };
    }

    const guard = await this.checkSafePoint(input.conversationId, binding);
    if (!guard.ok) return guard;

    await this.prisma.$transaction(async (tx) => {
      await tx.conversationFlowBinding.update({
        where: { id: binding.id },
        data: {
          definitionVersionId: target.id,
          definitionHash: target.definitionHash,
          status: 'ACTIVE',
        },
      });
      await tx.flowBindingAuditLog.create({
        data: {
          conversationId: input.conversationId,
          flowType,
          action,
          actorId: input.actorId,
          reason: input.reason,
          fromVersionId: binding.definitionVersionId,
          toVersionId: target.id,
          threadId: binding.threadId,
          checkpointId: binding.checkpointId,
        },
      });
    });

    this.logger.log(
      `[FlowVersioning] ${action}: conv=${input.conversationId}, flow=${flowType}, ${binding.definitionVersionId} -> ${target.id}`,
    );
    return { ok: true };
  }

  /**
   * 状态回滚（恢复 checkpoint）需要清理 blobs/writes 并处理消息一致性，
   * 当前没有安全的 checkpoint 回滚工具，必须 fail-closed，不能假装成功。
   */
  async rollbackState(): Promise<SwitchFlowDefinitionResult> {
    return { ok: false, reason: 'state_rollback_not_supported' };
  }

  private async checkSafePoint(
    conversationId: string,
    binding: { threadId: string | null; flowStep: string },
  ): Promise<SwitchFlowDefinitionResult> {
    // 填表/确认/查询进行中时切定义，会让同一条流程前后两半使用不同规则。
    if (
      ['FILLING', 'CONFIRMING', 'QUERYING', 'RAG'].includes(binding.flowStep)
    ) {
      return { ok: false, reason: 'flow_in_progress' };
    }
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { handlerId: true, threadId: true },
    });
    if (!conversation) return { ok: false, reason: 'conversation_not_found' };
    if (conversation.handlerId != null) {
      return { ok: false, reason: 'human_handling' };
    }
    if (
      binding.threadId &&
      conversation.threadId &&
      binding.threadId !== conversation.threadId
    ) {
      return { ok: false, reason: 'thread_drift' };
    }

    const member = await this.prisma.chatMember.findFirst({
      where: { conversationId },
      select: { userId: true },
      orderBy: { joinedAt: 'asc' },
    });
    if (member) {
      let pending: string | null;
      try {
        pending = await this.redis.get(`ai:confirm:pending:${member.userId}`);
      } catch (err: unknown) {
        // 无法确认是否有待确认操作 → 不能切换。
        this.logger.warn(
          `[FlowVersioning] pending-confirm check unavailable: ${this.errText(err)}`,
        );
        return { ok: false, reason: 'pending_check_unavailable' };
      }
      if (pending) return { ok: false, reason: 'pending_confirmation' };
    }

    return { ok: true };
  }

  private async writeAudit(input: {
    conversationId: string;
    flowType: string;
    action: string;
    actorId?: string;
    reason?: string;
    fromVersionId?: string;
    toVersionId?: string;
    threadId?: string | null;
    checkpointId?: string | null;
  }): Promise<void> {
    await this.prisma.flowBindingAuditLog.create({
      data: {
        conversationId: input.conversationId,
        flowType: input.flowType,
        action: input.action,
        actorId: input.actorId,
        reason: input.reason,
        fromVersionId: input.fromVersionId,
        toVersionId: input.toVersionId,
        threadId: input.threadId ?? undefined,
        checkpointId: input.checkpointId ?? undefined,
      },
    });
  }

  private buildRuntimePayload(
    flowType: FlowTypeKey,
    writeTools: string[],
  ): FlowDefinitionPayload {
    const config = FLOW_TYPE_REGISTRY[flowType];
    return {
      schemaVersion: DEFINITION_SCHEMA_VERSION,
      flowType,
      label: config.label,
      taskType: getTaskType(flowType) ?? 'query',
      allowedStatuses: [...config.allowedStatuses],
      stepGraph: {},
      confirmMappings: {},
      promptVersion: PROMPT_VERSION,
      writeTools,
    };
  }

  private assertKnownFlowType(flowType: string): void {
    if (!Object.prototype.hasOwnProperty.call(FLOW_TYPE_REGISTRY, flowType)) {
      throw new BadRequestException(`Unknown flow type: ${flowType}`);
    }
  }

  private errText(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
  }
}
