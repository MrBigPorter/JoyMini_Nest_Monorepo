import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '@api/common/prisma/prisma.service';
import { AgentPromptConfig } from '@api/client/ai-customer/graph/agents/prompt-builder';
import { ToolRegistryService } from '@api/client/ai-customer/graph/tools/tool-registry.service';
import { orderPromptConfig } from '@api/client/ai-customer/graph/agents/prompts/order-prompt';
import { walletPromptConfig } from '@api/client/ai-customer/graph/agents/prompts/wallet-prompt';
import { couponPromptConfig } from '@api/client/ai-customer/graph/agents/prompts/coupon-prompt';
import { userPromptConfig } from '@api/client/ai-customer/graph/agents/prompts/user-prompt';
import { productPromptConfig } from '@api/client/ai-customer/graph/agents/prompts/product-prompt';
import { luckyPromptConfig } from '@api/client/ai-customer/graph/agents/prompts/lucky-prompt';
import { kycPromptConfig } from '@api/client/ai-customer/graph/agents/prompts/kyc-prompt';
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

@Injectable()
export class AiPromptService {
  private readonly logger = new Logger(AiPromptService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly toolRegistry: ToolRegistryService,
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
        config: dto.config as any,
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

    // Record test run (actual LLM call will be added in Phase 2)
    const testRun = await this.prisma.knowledgePromptTestRun.create({
      data: {
        promptId,
        version: prompt.activeVersion,
        testQuery,
        passed: null, // pending evaluation
      },
    });

    return testRun;
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
