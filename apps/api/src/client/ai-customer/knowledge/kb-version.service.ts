import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@api/common/prisma/prisma.service';
import { MeilisearchService } from '@api/common/meilisearch/meilisearch.service';

/** 切换结果。switched=false 时旧版本继续对外服务。 */
export interface ActivateResult {
  switched: boolean;
  reason?: string;
}

/**
 * 知识库版本切换器
 *
 * ── 它管什么？ ──
 * 一篇文档的 chunk 会同时存在多个版本（旧版继续服务、新版暂存）。
 * 这个服务负责把「对外版本」从旧的切到新的，以及切回去（回滚）。
 *
 * ── 门（gate）──
 * 切换前必须满足：目标版本的每一条 chunk 都已经有向量。
 * 不满足就什么都不做——旧版本继续服务，用户完全无感。
 * 失败的更新等于没发生，这就是「无感」的准确含义。
 *
 * ── 为什么先翻 Meili 再写 PG？──
 * Meili 翻标记会失败（服务抖动/超时），PG 的 updateMany 不会。
 * 先做可能失败的一步：它失败了就整体放弃，什么都没改。
 * 反过来先写 PG，再翻 Meili 失败，就会变成「库说新版、搜索还是旧版」。
 */
@Injectable()
export class KbVersionService {
  private readonly logger = new Logger(KbVersionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly meilisearchService: MeilisearchService,
  ) {}

  /** 把对外版本切到 targetVersion（通常是刚完成向量化的最新版本） */
  async activate(
    documentId: string,
    targetVersion: number,
  ): Promise<ActivateResult> {
    return this.switchTo(documentId, targetVersion);
  }

  /** 回滚到历史版本。旧版本 chunk 在保留期内仍然存在，切换只是翻标记。 */
  async rollback(
    documentId: string,
    toVersion: number,
  ): Promise<ActivateResult> {
    return this.switchTo(documentId, toVersion);
  }

  /** 旧版本保留天数。保留期 = 回滚窗口，缩短它就等于缩短回滚能力。 */
  private static readonly RETENTION_DAYS = 7;

  /**
   * 清理切换后已稳定超过保留期的旧版本（PG 与 Meili 两侧一起清）。
   *
   * 只清一侧的后果：回滚后那一层是空的。所以两侧必须成对执行。
   * 单篇失败不中断整轮——清理是后台维护动作，不该把别的文档也拖住。
   */
  async purgeStaleVersions(
    now: Date = new Date(),
  ): Promise<{ documents: number; chunks: number }> {
    const cutoff = new Date(
      now.getTime() - KbVersionService.RETENTION_DAYS * 24 * 60 * 60 * 1000,
    );

    const docs = await this.prisma.knowledgeDocument.findMany({
      where: { activeVersionAt: { lt: cutoff } },
      select: { id: true, activeVersion: true },
    });

    let documents = 0;
    let chunks = 0;

    for (const doc of docs) {
      try {
        const { count } = await this.prisma.documentChunk.deleteMany({
          where: {
            documentId: doc.id,
            documentVersion: { lt: doc.activeVersion },
          },
        });

        await this.meilisearchService.deleteChunkVersionsBelow(
          doc.id,
          doc.activeVersion,
        );

        documents += 1;
        chunks += count ?? 0;
        this.logger.log(
          `[kb.version.purged] doc=${doc.id} active=${doc.activeVersion} chunks=${count}`,
        );
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Unknown error';
        this.logger.error(
          `[kb.version.purged] doc=${doc.id} failed: ${message}`,
        );
      }
    }

    return { documents, chunks };
  }

  private async switchTo(
    documentId: string,
    targetVersion: number,
  ): Promise<ActivateResult> {
    const doc = await this.prisma.knowledgeDocument.findUnique({
      where: { id: documentId },
      select: { id: true, activeVersion: true },
    });

    if (!doc) return { switched: false, reason: 'not-found' };
    if (doc.activeVersion === targetVersion) {
      // 幂等：重复触发（例如任务重试）不该再翻一次标记
      return { switched: true, reason: 'already-active' };
    }

    const total = await this.prisma.documentChunk.count({
      where: { documentId, documentVersion: targetVersion },
    });
    if (total === 0) return { switched: false, reason: 'no-chunks' };

    // embedding 是 Unsupported("vector(1024)") 类型，Prisma 不能在 where 里判空，
    // 只能用原生 SQL 数一遍。
    const rows = await this.prisma.$queryRawUnsafe<Array<{ count: number }>>(
      `SELECT COUNT(*)::int AS count
         FROM document_chunks
        WHERE document_id = $1
          AND document_version = $2
          AND embedding IS NOT NULL`,
      documentId,
      targetVersion,
    );
    const ready = Number(rows?.[0]?.count ?? 0);
    if (ready !== total) {
      this.logger.warn(
        `[kb.version.failed] doc=${documentId} v=${targetVersion} ` +
          `reason=chunks-not-ready (${ready}/${total})`,
      );
      return { switched: false, reason: 'chunks-not-ready' };
    }

    const chunks = await this.prisma.documentChunk.findMany({
      where: { documentId },
      select: { id: true, documentVersion: true },
    });

    /** 目标版本翻 true、其余版本翻 false */
    const flagsFor = (activeVersion: number) =>
      chunks.map((c) => ({
        chunkId: c.id,
        isActiveVersion: c.documentVersion === activeVersion,
      }));

    const previousVersion = doc.activeVersion;

    // 先做会失败的那一步：它抛了，PG 还没动，等于什么都没发生。
    await this.meilisearchService.setChunkActiveFlags(flagsFor(targetVersion));

    // CAS：以「当前 activeVersion」为条件，防止两个请求同时切换。
    const { count } = await this.prisma.knowledgeDocument.updateMany({
      where: { id: documentId, activeVersion: previousVersion },
      data: { activeVersion: targetVersion, activeVersionAt: new Date() },
    });

    if (count !== 1) {
      // 抢输了（别人先切了）：把 Meili 标记补偿回切换前的状态
      await this.meilisearchService.setChunkActiveFlags(
        flagsFor(previousVersion),
      );
      return { switched: false, reason: 'cas-failed' };
    }

    this.logger.log(
      `[kb.version.switched] doc=${documentId} ${previousVersion} -> ${targetVersion} ` +
        `chunks=${total}`,
    );

    return { switched: true };
  }
}
