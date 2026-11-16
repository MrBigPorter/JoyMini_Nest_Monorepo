// 依赖链会加载 meilisearch（ESM 包），先占位替掉。
jest.mock('meilisearch', () => ({ Meilisearch: class {} }));

import { RagRetrievalService } from './rag-retrieval.service';

/**
 * Task 5：检索必须只看「当前对外版本」。
 *
 * 更新文档后新旧版本 chunk 并存（Task 4），如果检索不加版本过滤，
 * 用户会同时命中新旧两份内容——这正是"更新期间用户看到旧规则"的根因。
 */
describe('RagRetrievalService 版本过滤（Task 5）', () => {
  const build = () => {
    const prisma = {
      $queryRawUnsafe: jest.fn().mockResolvedValue([]),
      knowledgeDocument: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const aiService = {
      generateEmbedding: jest.fn().mockResolvedValue([0.1, 0.2]),
    };
    const meilisearchService = {
      searchChunks: jest.fn().mockResolvedValue([]),
      isAvailable: true,
    };
    const configService = { get: jest.fn().mockReturnValue(undefined) };

    const service = new RagRetrievalService(
      prisma as any,
      aiService as any,
      meilisearchService as any,
      configService as any,
    );

    return { service, prisma };
  };

  it('向量层只查 activeVersion 那一版（同文档新旧并存时不会命中旧版）', async () => {
    const { service, prisma } = build();

    await (service as any).vectorSearch('退款多久到账', undefined, 5);

    const [sql] = prisma.$queryRawUnsafe.mock.calls[0];
    expect(sql).toContain('dc.document_version = kd.active_version');
  });

  it('chunk 关键字层同样按 activeVersion 过滤', async () => {
    const { service, prisma } = build();

    await (service as any).keywordSearchChunks(['退款'], undefined, 5);

    const [sql] = prisma.$queryRawUnsafe.mock.calls[0];
    expect(sql).toContain('dc.document_version = kd.active_version');
  });

  it('整文档兜底层跳过「正在暂存新版本」的文档', async () => {
    const { service, prisma } = build();
    prisma.knowledgeDocument.findMany.mockResolvedValue([
      // 已切换：activeVersion === version → 可参与
      {
        id: 'd1',
        version: 3,
        activeVersion: 3,
        title: '退款政策',
        content: '退款 5 个工作日到账',
        keywords: ['退款'],
        priority: 'P0',
        domain: 'wallet',
        docId: 'refund',
        language: 'zh',
      },
      // 暂存中：新版本还没过门 → 不能返回（否则提前泄漏新版内容）
      // 内容同样命中「退款」，唯一的区分点是 activeVersion !== version
      {
        id: 'd2',
        version: 4,
        activeVersion: 3,
        title: '退款政策（新版，尚未上线）',
        content: '退款 3 个工作日到账',
        keywords: ['退款'],
        priority: 'P0',
        domain: 'wallet',
        docId: 'refund',
        language: 'zh',
      },
    ]);

    const results = await (service as any).keywordSearchDocs(
      '退款',
      ['退款'],
      undefined,
      5,
    );

    const ids = results.map((r: any) => r.documentId);
    expect(ids).toContain('d1');
    expect(ids).not.toContain('d2');
  });
});
