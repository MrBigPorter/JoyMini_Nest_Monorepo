/**
 * KnowledgeDomainService — 文档域注册表的读取/校验层
 *
 * 文档域回答的是「这篇文档属于哪个业务区」（用于后台组织、检索过滤），
 * 意图域回答的是「这条用户消息交给哪个 Agent」。两者语义不同，
 * 因此各有一张注册表，不互相别名。
 *
 * 本服务提供：
 *   - 启动时幂等灌种子（空表才灌，不覆盖运营改动）
 *   - 60s 进程内缓存，上传/改文档时不必每次查库
 *   - `resolve()` 统一 trim/lowercase/别名归一 + 合法性校验
 *   - 文档域 → 候选投放意图域的映射（默认 rag）
 */
import {
  BadRequestException,
  Injectable,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaService } from '@api/common/prisma/prisma.service';
import {
  KNOWLEDGE_DOMAIN_KEYS,
  normalizeKnowledgeDomain,
} from './domain-normalization';
import {
  KNOWLEDGE_DOMAIN_SEEDS,
  KnowledgeDomainSnapshot,
} from './knowledge-domain.seeds';

// 供现有调用方从服务模块继续导入，避免一次无谓的路径迁移。
export { KNOWLEDGE_DOMAIN_SEEDS };
export type {
  KnowledgeDomainSeed,
  KnowledgeDomainSnapshot,
} from './knowledge-domain.seeds';

@Injectable()
export class KnowledgeDomainService implements OnModuleInit {
  private readonly logger = new Logger(KnowledgeDomainService.name);
  private cache: {
    loadedAt: number;
    domains: KnowledgeDomainSnapshot[];
  } | null = null;

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit(): Promise<void> {
    // 启动失败不阻塞应用：表还没迁移时先退化为脚本/内存默认值。
    try {
      if (process.env.KNOWLEDGE_DOMAIN_BOOTSTRAP_ON_EMPTY !== 'false') {
        await this.seedIfEmpty();
      }
    } catch (error) {
      this.logger.warn(
        `Knowledge domain bootstrap skipped: ${(error as Error).message}`,
      );
    }
  }

  /** 测试/写操作后让缓存立即失效 */
  invalidate(): void {
    this.cache = null;
  }

  private ttlMs(): number {
    const raw = Number(process.env.KNOWLEDGE_DOMAIN_CACHE_TTL_MS);
    return Number.isFinite(raw) && raw >= 0 ? raw : 60_000;
  }

  /** 仅空表时灌种子；已有记录说明运营/迁移已接管，不覆盖。 */
  async seedIfEmpty(): Promise<number> {
    const count = await this.prisma.knowledgeDomain.count();
    if (count > 0) return 0;

    const result = await this.prisma.knowledgeDomain.createMany({
      data: KNOWLEDGE_DOMAIN_SEEDS,
      skipDuplicates: true,
    });
    this.invalidate();
    this.logger.log(`Seeded ${result.count} knowledge domains`);
    return result.count;
  }

  async getSnapshot(): Promise<KnowledgeDomainSnapshot[]> {
    if (this.cache && Date.now() - this.cache.loadedAt < this.ttlMs()) {
      return this.cache.domains;
    }

    let domains: KnowledgeDomainSnapshot[];
    try {
      const rows = await this.prisma.knowledgeDomain.findMany({
        where: { enabled: true },
        orderBy: [{ sortOrder: 'asc' }, { key: 'asc' }],
      });
      domains =
        rows.length > 0
          ? rows.map((row) => ({
              key: row.key,
              label: row.label,
              description: row.description,
              candidateTargetIntent: row.candidateTargetIntent,
              enabled: row.enabled,
              sortOrder: row.sortOrder,
            }))
          : KNOWLEDGE_DOMAIN_SEEDS.map((seed) => ({
              ...seed,
              enabled: true,
            }));
    } catch (error) {
      this.logger.warn(
        `Read knowledge_domains failed (${(error as Error).message}); using seeds`,
      );
      domains = KNOWLEDGE_DOMAIN_SEEDS.map((seed) => ({
        ...seed,
        enabled: true,
      }));
    }

    this.cache = { loadedAt: Date.now(), domains };
    return domains;
  }

  async list(includeDisabled = false): Promise<KnowledgeDomainSnapshot[]> {
    if (!includeDisabled) return this.getSnapshot();
    const rows = await this.prisma.knowledgeDomain.findMany({
      orderBy: [{ sortOrder: 'asc' }, { key: 'asc' }],
    });
    return rows.map((row) => ({
      key: row.key,
      label: row.label,
      description: row.description,
      candidateTargetIntent: row.candidateTargetIntent,
      enabled: row.enabled,
      sortOrder: row.sortOrder,
    }));
  }

  /**
   * 归一 + 校验。未知域直接 400，并给出合法集合，
   * 避免拼写错误静默变成一个新的「隐式域」。
   */
  async resolve(raw?: string | null): Promise<string> {
    const normalized = normalizeKnowledgeDomain(raw);
    const domains = await this.getSnapshot();
    const allowed = new Set(domains.map((domain) => domain.key));

    if (!allowed.has(normalized)) {
      throw new BadRequestException(
        `Unknown knowledge domain "${raw ?? ''}". Allowed: ${[...allowed].join(', ')}`,
      );
    }
    return normalized;
  }

  /** 用于列表筛选等「可空」场景：空值原样返回 undefined */
  async resolveOptional(raw?: string | null): Promise<string | undefined> {
    if (raw === undefined || raw === null || raw.trim() === '')
      return undefined;
    return this.resolve(raw);
  }

  /**
   * 文档域 → 候选默认投放意图域。
   * 解析顺序：文档级覆盖 > 注册表映射 > rag。
   */
  async getCandidateTargetIntent(
    documentDomain: string,
    documentOverride?: string | null,
  ): Promise<string> {
    const override = documentOverride?.trim();
    if (override) return override;

    const normalized = normalizeKnowledgeDomain(documentDomain);
    const domains = await this.getSnapshot();
    const match = domains.find((domain) => domain.key === normalized);
    return match?.candidateTargetIntent || 'rag';
  }

  /** 静态合法集合（不查库），供纯函数/测试使用 */
  static knownKeys(): string[] {
    return [...KNOWLEDGE_DOMAIN_KEYS];
  }
}
