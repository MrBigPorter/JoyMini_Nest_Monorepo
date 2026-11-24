import { Injectable } from '@nestjs/common';
import { PrismaService } from '@api/common/prisma/prisma.service';
import {
  CorpusFingerprint,
  computeCorpusFingerprint,
} from './corpus-fingerprint';

/**
 * 语料指纹的只读视图。
 *
 * 每次实时计算，不落表：27 篇文档的成本可以忽略，物化只会引入第二个事实源。
 * 不查询 Meilisearch，避免索引最终一致造成指纹抖动。
 */
@Injectable()
export class CorpusFingerprintService {
  constructor(private readonly prisma: PrismaService) {}

  async getCurrent(generatedAt?: string): Promise<CorpusFingerprint> {
    const documents = await this.prisma.knowledgeDocument.findMany({
      where: { isActive: true, deletedAt: null },
      select: {
        id: true,
        docId: true,
        locale: true,
        title: true,
        version: true,
        activeVersion: true,
        processStatus: true,
        documentChunks: {
          select: {
            documentVersion: true,
            chunkIndex: true,
            content: true,
          },
        },
      },
    });

    return computeCorpusFingerprint(documents, generatedAt);
  }
}
