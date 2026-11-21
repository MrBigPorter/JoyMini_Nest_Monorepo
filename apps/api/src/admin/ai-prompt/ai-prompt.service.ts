import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { PrismaService } from '@api/common/prisma/prisma.service';
import { ConfigService } from '@nestjs/config';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { createLLM } from '@api/client/ai-customer/graph/llm-factory';
import { buildAgentPrompt } from '@api/client/ai-customer/graph/agents/prompt-builder';
import { AgentPromptConfig } from '@api/client/ai-customer/graph/agents/prompt-builder';
import { ToolRegistryService } from '@api/client/ai-customer/graph/tools/tool-registry.service';
import { couponPromptConfig } from '@api/client/ai-customer/graph/agents/prompts/coupon-prompt';
import { kycPromptConfig } from '@api/client/ai-customer/graph/agents/prompts/kyc-prompt';
import { luckyPromptConfig } from '@api/client/ai-customer/graph/agents/prompts/lucky-prompt';
import { orderPromptConfig } from '@api/client/ai-customer/graph/agents/prompts/order-prompt';
import { productPromptConfig } from '@api/client/ai-customer/graph/agents/prompts/product-prompt';
import { userPromptConfig } from '@api/client/ai-customer/graph/agents/prompts/user-prompt';
import { walletPromptConfig } from '@api/client/ai-customer/graph/agents/prompts/wallet-prompt';
import { CreatePromptDto } from './dto/create-prompt.dto';
import { UpdatePromptDto } from './dto/update-prompt.dto';
import { QueryPromptDto } from './dto/query-prompt.dto';
import { CreatePromptVersionDto } from './dto/create-prompt-version.dto';

/**
 * Template map — 所有 Agent prompt 配置常量。
 * 用于模板预填 API。
 */
const TEMPLATE_MAP: Record<string, Omit<AgentPromptConfig, 'userId'>> = {
  coupon: couponPromptConfig,
  order: orderPromptConfig,
  product: productPromptConfig,
  wallet: walletPromptConfig,
  user: userPromptConfig,
  kyc: kycPromptConfig,
  'lucky-draw': luckyPromptConfig,
};

/** 代码里维护的 Agent prompt；DB 只是它的缓存/可编辑副本。 */
const CODE_PROMPTS: Record<string, Record<string, unknown>> = {
  coupon: couponPromptConfig as any,
  kyc: kycPromptConfig as any,
  'lucky-draw': luckyPromptConfig as any,
  order: orderPromptConfig as any,
  product: productPromptConfig as any,
  user: userPromptConfig as any,
  wallet: walletPromptConfig as any,
};

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value as object)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${stableJson((value as Record<string, unknown>)[key])}`,
      )
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function withoutMeta(config: unknown): Record<string, unknown> {
  const copy = { ...(config as Record<string, unknown>) };
  delete copy._meta;
  return copy;
}

@Injectable()
export class AiPromptService implements OnApplicationBootstrap {
  private readonly logger = new Logger(AiPromptService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly toolRegistry: ToolRegistryService,
    private readonly configService: ConfigService,
  ) {}

  async create(dto: CreatePromptDto) {
    // Check uniqueness
    const existing = await this.prisma.knowledgePrompt.findUnique({
      where: { name: dto.name },
    });
    if (existing) {
      throw new BadRequestException(
        `Prompt with name "${dto.name}" already exists`,
      );
    }

    const prompt = await this.prisma.knowledgePrompt.create({
      data: {
        name: dto.name,
        displayName: dto.displayName,
        description: dto.description,
        category: dto.category,
        domain: dto.domain,
        activeVersion: 1,
      },
    });

    // Create initial version if config provided
    if (dto.config) {
      await this.prisma.knowledgePromptVersion.create({
        data: {
          promptId: prompt.id,
          version: 1,
          config: dto.config as any,
          changeLog: 'Initial version',
          isActive: true,
        },
      });
    }

    this.logger.log(`Created prompt: ${dto.name} (${prompt.id})`);
    return prompt;
  }

  async list(query: QueryPromptDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const where: any = {};

    if (query.category) where.category = query.category;
    if (query.domain) where.domain = query.domain;
    if (query.status) where.status = query.status;

    const [items, total] = await Promise.all([
      this.prisma.knowledgePrompt.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
        include: {
          versions: {
            where: { isActive: true },
            select: {
              version: true,
              config: true,
              metrics: true,
              isActive: true,
              createdAt: true,
            },
            take: 1,
          },
        },
      }),
      this.prisma.knowledgePrompt.count({ where }),
    ]);

    return { items, total, page, pageSize };
  }

  async getById(id: string) {
    const prompt = await this.prisma.knowledgePrompt.findUnique({
      where: { id },
      include: {
        versions: {
          orderBy: { version: 'desc' },
          take: 50,
        },
      },
    });

    if (!prompt) {
      throw new NotFoundException(`Prompt "${id}" not found`);
    }

    return prompt;
  }

  async update(id: string, dto: UpdatePromptDto) {
    const prompt = await this.prisma.knowledgePrompt.findUnique({
      where: { id },
    });
    if (!prompt) {
      throw new NotFoundException(`Prompt "${id}" not found`);
    }

    return this.prisma.knowledgePrompt.update({
      where: { id },
      data: {
        ...(dto.displayName !== undefined && { displayName: dto.displayName }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.status !== undefined && { status: dto.status }),
        ...(dto.tsFallback !== undefined && { tsFallback: dto.tsFallback }),
      },
    });
  }

  async delete(id: string) {
    const prompt = await this.prisma.knowledgePrompt.findUnique({
      where: { id },
    });
    if (!prompt) {
      throw new NotFoundException(`Prompt "${id}" not found`);
    }

    // Soft delete — set status to archived
    await this.prisma.knowledgePrompt.update({
      where: { id },
      data: { status: 'archived' },
    });

    this.logger.log(`Archived prompt: ${prompt.name} (${id})`);
  }

  // ---- Version Management ----

  async getVersions(promptId: string) {
    const prompt = await this.prisma.knowledgePrompt.findUnique({
      where: { id: promptId },
    });
    if (!prompt) {
      throw new NotFoundException(`Prompt "${promptId}" not found`);
    }

    return this.prisma.knowledgePromptVersion.findMany({
      where: { promptId },
      orderBy: { version: 'desc' },
      select: {
        id: true,
        version: true,
        changeLog: true,
        metrics: true,
        isActive: true,
        createdAt: true,
      },
    });
  }

  async createVersion(promptId: string, dto: CreatePromptVersionDto) {
    const prompt = await this.prisma.knowledgePrompt.findUnique({
      where: { id: promptId },
    });
    if (!prompt) {
      throw new NotFoundException(`Prompt "${promptId}" not found`);
    }

    // Determine next version number
    const latestVersion = await this.prisma.knowledgePromptVersion.findFirst({
      where: { promptId },
      orderBy: { version: 'desc' },
      select: { version: true },
    });

    const nextVersion = (latestVersion?.version ?? 0) + 1;

    // Create new version
    const version = await this.prisma.knowledgePromptVersion.create({
      data: {
        promptId,
        version: nextVersion,
        config: {
          ...(dto.config as any),
          _meta: { source: 'admin' },
        },
        changeLog: dto.changeLog ?? `Version ${nextVersion}`,
        isActive: false, // not active until explicitly activated
      },
    });

    this.logger.log(`Created version ${nextVersion} for prompt ${prompt.name}`);
    return version;
  }

  async activateVersion(promptId: string, version: number) {
    const prompt = await this.prisma.knowledgePrompt.findUnique({
      where: { id: promptId },
    });
    if (!prompt) {
      throw new NotFoundException(`Prompt "${promptId}" not found`);
    }

    const versionRecord = await this.prisma.knowledgePromptVersion.findFirst({
      where: { promptId, version },
    });
    if (!versionRecord) {
      throw new NotFoundException(
        `Version ${version} not found for prompt "${promptId}"`,
      );
    }

    // Deactivate all other versions, activate this one
    await this.prisma.$transaction([
      this.prisma.knowledgePromptVersion.updateMany({
        where: { promptId, isActive: true },
        data: { isActive: false },
      }),
      this.prisma.knowledgePromptVersion.update({
        where: { id: versionRecord.id },
        data: { isActive: true },
      }),
      this.prisma.knowledgePrompt.update({
        where: { id: promptId },
        data: { activeVersion: version },
      }),
    ]);

    // TODO: increment global configVersion for hot-reload (Phase 2c)

    this.logger.log(`Activated version ${version} for prompt ${prompt.name}`);
  }

  async diffVersions(promptId: string, v1: number, v2: number) {
    const [version1, version2] = await Promise.all([
      this.prisma.knowledgePromptVersion.findFirst({
        where: { promptId, version: v1 },
      }),
      this.prisma.knowledgePromptVersion.findFirst({
        where: { promptId, version: v2 },
      }),
    ]);

    if (!version1) throw new NotFoundException(`Version ${v1} not found`);
    if (!version2) throw new NotFoundException(`Version ${v2} not found`);

    // Compute field-level diff
    const config1 = version1.config as Record<string, unknown>;
    const config2 = version2.config as Record<string, unknown>;
    const allKeys = new Set([...Object.keys(config1), ...Object.keys(config2)]);

    const diff: Array<{
      field: string;
      type: 'added' | 'removed' | 'modified' | 'unchanged';
      oldValue?: unknown;
      newValue?: unknown;
    }> = [];

    for (const key of allKeys) {
      if (!(key in config1)) {
        diff.push({ field: key, type: 'added', newValue: config2[key] });
      } else if (!(key in config2)) {
        diff.push({ field: key, type: 'removed', oldValue: config1[key] });
      } else if (
        JSON.stringify(config1[key]) !== JSON.stringify(config2[key])
      ) {
        diff.push({
          field: key,
          type: 'modified',
          oldValue: config1[key],
          newValue: config2[key],
        });
      } else {
        diff.push({ field: key, type: 'unchanged' });
      }
    }

    return {
      v1: {
        version: v1,
        createdAt: version1.createdAt,
        changeLog: version1.changeLog,
      },
      v2: {
        version: v2,
        createdAt: version2.createdAt,
        changeLog: version2.changeLog,
      },
      diff,
    };
  }

  // ---- Test Run ----

  async runTest(promptId: string, testQuery: string) {
    const prompt = await this.prisma.knowledgePrompt.findUnique({
      where: { id: promptId },
    });
    if (!prompt) {
      throw new NotFoundException(`Prompt "${promptId}" not found`);
    }

    const version = await this.prisma.knowledgePromptVersion.findUnique({
      where: {
        promptId_version: { promptId, version: prompt.activeVersion },
      },
    });
    if (!version) {
      throw new NotFoundException(
        `Active version ${prompt.activeVersion} not found`,
      );
    }

    const startedAt = Date.now();
    let actualOutput: string | null = null;
    let latencyMs: number | null = null;
    try {
      const llmConfig = {
        type: this.configService.get<'online' | 'local'>(
          'AI_LLM_TYPE',
          'local',
        ),
        model: this.configService.get<string>('OLLAMA_MODEL', 'qwen3.5:0.8b'),
        baseURL: this.configService.get<string>(
          'AI_OLLAMA_BASE_URL',
          'http://localhost:11434',
        ),
        apiKey: this.configService.get<string>('DEEPSEEK_API_KEY'),
      };
      const systemPrompt = buildAgentPrompt({
        ...(version.config as unknown as AgentPromptConfig),
        userId: 'admin-prompt-test',
      });
      const model = createLLM(llmConfig as any, { temperature: 0 });
      const response = await model.invoke([
        new SystemMessage(systemPrompt),
        new HumanMessage(testQuery),
      ]);
      actualOutput =
        typeof response.content === 'string'
          ? response.content
          : JSON.stringify(response.content);
      latencyMs = Date.now() - startedAt;
    } catch (err: any) {
      this.logger.warn(`Prompt test LLM call failed: ${err?.message ?? err}`);
    }

    return this.prisma.knowledgePromptTestRun.create({
      data: {
        promptId,
        version: prompt.activeVersion,
        testQuery,
        actualOutput,
        latencyMs,
        passed: null,
      },
    });
  }

  // ---- Metrics ----

  async getMetrics(promptId: string) {
    const prompt = await this.prisma.knowledgePrompt.findUnique({
      where: { id: promptId },
    });
    if (!prompt) {
      throw new NotFoundException(`Prompt "${promptId}" not found`);
    }

    const versions = await this.prisma.knowledgePromptVersion.findMany({
      where: { promptId },
      orderBy: { version: 'desc' },
      select: {
        version: true,
        metrics: true,
        changeLog: true,
        isActive: true,
        createdAt: true,
      },
    });

    // Get eval log aggregation
    const evalStats = await this.prisma.knowledgePromptEvalLog.groupBy({
      by: ['version'],
      where: { promptName: prompt.name },
      _count: { id: true },
      _avg: { toolFailCount: true, latencyMs: true, totalTokens: true },
    });

    return { prompt, versions, evalStats };
  }

  // ---- Template & Tool APIs (for Admin UI) ----

  /**
   * Get all available template metadata (for domain dropdown enhancement).
   */
  async getTemplates() {
    const templates = Object.entries(TEMPLATE_MAP).map(([domain, config]) => ({
      domain,
      label: this.toLabel(domain),
      description: config.role ? config.role.slice(0, 80) + '...' : '',
    }));
    return { templates };
  }

  /**
   * Get the full AgentPromptConfig template for a domain.
   */
  async getTemplate(domain: string) {
    const config = TEMPLATE_MAP[domain];
    if (!config) {
      throw new NotFoundException(`Template not found for domain: "${domain}"`);
    }
    return { domain, config };
  }

  /**
   * 可选启动同步：PROMPT_SYNC_ON_START=true 时，等工具注册完成后再把
   * 代码 prompt 写入 DB。延迟 5 秒是为了避开各模块 onApplicationBootstrap
   * 注册工具的顺序。
   */
  onApplicationBootstrap() {
    if (process.env.PROMPT_SYNC_ON_START !== 'true') return;
    setTimeout(() => {
      this.syncFromCode().catch((err) =>
        this.logger.error(
          `[prompt-sync] startup sync failed: ${err?.message ?? err}`,
        ),
      );
    }, 5000);
  }

  /**
   * 把代码里的 Agent prompt 同步到 DB。
   *
   * 规则：
   *   - 代码是模板来源，工具列表由 ToolRegistry 当前注册的工具生成
   *   - 运营在后台手工编辑过的版本（_meta.source='admin'）不覆盖，只报告冲突
   *   - 内容一致时不做无意义的新版本
   *   - 同步后的版本标记 _meta.source='code'，供下次判断
   */
  async syncFromCode() {
    const results: Array<{
      domain: string;
      action: 'created' | 'updated' | 'unchanged' | 'skipped-admin';
      version?: number;
    }> = [];

    for (const [domain, codeConfig] of Object.entries(CODE_PROMPTS)) {
      const target = this.buildCodeConfig(domain, codeConfig);
      const prompt = await this.prisma.knowledgePrompt.findUnique({
        where: { name: domain },
        include: { versions: true },
      });

      if (!prompt) {
        const created = await this.prisma.knowledgePrompt.create({
          data: {
            name: domain,
            displayName: this.toLabel(domain),
            description: 'Synced from code',
            category: 'agent',
            domain,
            status: 'active',
            activeVersion: 1,
            tsFallback: true,
            versions: {
              create: {
                version: 1,
                config: target as any,
                changeLog: 'Synced from code',
                isActive: true,
              },
            },
          },
        });
        results.push({ domain, action: 'created', version: created.activeVersion });
        continue;
      }

      const active = prompt.versions.find((v) => v.isActive);
      const activeMeta = (active?.config as any)?._meta;
      if (activeMeta?.source === 'admin') {
        results.push({ domain, action: 'skipped-admin' });
        continue;
      }

      const same =
        active &&
        stableJson(withoutMeta(active.config)) === stableJson(withoutMeta(target));
      if (same) {
        if (prompt.status !== 'active') {
          await this.prisma.knowledgePrompt.update({
            where: { id: prompt.id },
            data: { status: 'active' },
          });
        }
        results.push({ domain, action: 'unchanged', version: prompt.activeVersion });
        continue;
      }

      const nextVersion =
        Math.max(0, ...prompt.versions.map((v) => v.version)) + 1;
      await this.prisma.$transaction([
        this.prisma.knowledgePromptVersion.updateMany({
          where: { promptId: prompt.id, isActive: true },
          data: { isActive: false },
        }),
        this.prisma.knowledgePromptVersion.create({
          data: {
            promptId: prompt.id,
            version: nextVersion,
            config: target as any,
            changeLog: 'Synced from code',
            isActive: true,
          },
        }),
        this.prisma.knowledgePrompt.update({
          where: { id: prompt.id },
          data: {
            activeVersion: nextVersion,
            status: 'active',
            tsFallback: true,
          },
        }),
      ]);
      results.push({ domain, action: 'updated', version: nextVersion });
    }

    this.logger.log(
      `Prompt sync: ${results
        .map((r) => `${r.domain}=${r.action}${r.version ? `@${r.version}` : ''}`)
        .join(', ')}`,
    );
    return { results };
  }

  private buildCodeConfig(
    domain: string,
    codeConfig: Record<string, unknown>,
  ): Record<string, unknown> {
    const tools = this.toolRegistry.getToolsByTag(domain).map((tool) => ({
      name: tool.name,
      description: tool.description ?? '',
    }));
    const availableTools = tools
      .map((tool, index) => `${index + 1}. **${tool.name}** - ${tool.description}`)
      .join('\n');
    return {
      ...codeConfig,
      availableTools,
      selectedTools: tools.map((tool) => tool.name),
      templateDomain: domain,
      _meta: { source: 'code' },
    };
  }

  /**
   * Get tools available for a domain from the ToolRegistry.
   * If no domain specified, returns all registered tools.
   */
  async getTools(domain?: string) {
    const tools = domain
      ? this.toolRegistry.getToolsByTag(domain)
      : this.toolRegistry.getAllTools();

    const toolList = tools.map((t) => ({
      name: t.name,
      description: t.description,
    }));

    return { domain: domain ?? 'all', tools: toolList };
  }

  /**
   * Convert domain key to a human-readable label.
   */
  private toLabel(domain: string): string {
    const labels: Record<string, string> = {
      coupon: 'Coupon Agent',
      order: 'Order Agent',
      product: 'Product Agent',
      wallet: 'Wallet Agent',
      user: 'User Agent',
      kyc: 'KYC Agent',
      'lucky-draw': 'Lucky Draw Agent',
    };
    return labels[domain] ?? domain;
  }
}
