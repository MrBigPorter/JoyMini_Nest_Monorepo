/**
 * IntentDomainService — 意图域注册表的后台读写入口
 *
 * 运行时读取由 `intent-domain-registry.ts` 负责（分类器不走 DI）；
 * 这里给后台/审核链路用，保证「启用列表」「幂等种子」「缓存失效」
 * 只有一个实现。
 */
import {
  BadRequestException,
  Injectable,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaService } from '@api/common/prisma/prisma.service';
import {
  IntentDomainSnapshot,
  getIntentDomains,
  invalidateIntentDomainCache,
  seedIntentDomains,
} from '@api/client/ai-customer/graph/config/intent-domain-registry';

@Injectable()
export class IntentDomainService implements OnModuleInit {
  private readonly logger = new Logger(IntentDomainService.name);

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit(): Promise<void> {
    try {
      if (process.env.INTENT_DOMAIN_BOOTSTRAP_ON_EMPTY !== 'false') {
        await this.seedIfEmpty();
      }
    } catch (error) {
      // 表还没迁移时不让应用起不来；运行时会退化为 TS 种子。
      this.logger.warn(
        `Intent domain bootstrap skipped: ${(error as Error).message}`,
      );
    }
  }

  /** 空表才灌；已有记录说明 DB 已是事实来源，不能覆盖运营改过的描述。 */
  async seedIfEmpty(): Promise<number> {
    const count = await this.prisma.intentDomain.count();
    if (count > 0) return 0;

    const inserted = await seedIntentDomains(this.prisma);
    this.logger.log(`Seeded ${inserted} intent domains`);
    return inserted;
  }

  /** 启用的域（分类器允许列表） */
  async list(): Promise<IntentDomainSnapshot[]> {
    return getIntentDomains(this.prisma);
  }

  /** 后台列表需要看到停用的域 */
  async listAll(): Promise<IntentDomainSnapshot[]> {
    try {
      const rows = await this.prisma.intentDomain.findMany({
        orderBy: [{ sortOrder: 'asc' }, { label: 'asc' }],
      });
      return rows.map((row) => ({
        label: row.label,
        description: row.description,
        type:
          row.type === 'general' || row.type === 'transfer'
            ? row.type
            : 'business',
        agentTag: row.agentTag,
        catchAll: row.catchAll,
        enabled: row.enabled,
        keywords: row.keywords ?? [],
        sortOrder: row.sortOrder,
      }));
    } catch (error) {
      this.logger.warn(
        `Read intent_domains failed (${(error as Error).message}); using runtime snapshot`,
      );
      return this.list();
    }
  }

  /** 写示例/候选前校验目标域存在且启用 */
  async assertEnabled(label: string): Promise<IntentDomainSnapshot> {
    const domains = await this.list();
    const match = domains.find((domain) => domain.label === label);
    if (!match) {
      throw new BadRequestException(
        `Unknown or disabled intent domain "${label}". Enabled: ${domains
          .map((domain) => domain.label)
          .join(', ')}`,
      );
    }
    return match;
  }

  /** 域描述/关键词更新后调用 */
  invalidateCache(): void {
    invalidateIntentDomainCache();
  }
}
