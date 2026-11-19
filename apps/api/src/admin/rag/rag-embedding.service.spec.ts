// 依赖链会加载 meilisearch 与 p-limit（都是 ESM 包，jest 不转译 node_modules），
// 先占位替掉。p-limit 这里退化成「直接执行」，本用例只关心调用顺序。
jest.mock('meilisearch', () => ({ Meilisearch: class {} }));
jest.mock('p-limit', () => ({
  __esModule: true,
  default: (_n: number) => (fn: () => any) => fn(),
}));

import { RagEmbeddingService } from './rag-embedding.service';

/**
 * 缺陷 A 的第二半：重试补不上 Meili。
 *
 * embedDocument({ force: false }) 只处理 embedding IS NULL 的 chunk。
 * 如果先写向量、后写 Meili，一旦 Meili 失败，chunk 已经有向量了，
 * 下次重试它不再进入处理集 —— Meili 那条索引永久缺失。
 *
 * 所以顺序必须是：先 Meili，后向量。
 */
describe('RagEmbeddingService 索引顺序（缺陷 A）', () => {
  const build = () => {
    const calls: string[] = [];

    const prisma = {
      $queryRawUnsafe: jest
        .fn()
        .mockResolvedValue([
          { id: 'chunk_1', chunk_index: 0, content: '退款政策' },
        ]),
      $executeRawUnsafe: jest.fn().mockImplementation(async () => {
        calls.push('vector');
        return 1;
      }),
      knowledgeDocument: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'doc_1',
          title: '退款政策',
          domain: 'wallet',
          docId: 'refund-policy',
          keywords: ['refund'],
          priority: 'P0',
          contentType: 'policy',
          locale: 'zh',
          isActive: true,
        }),
      },
    };

    const aiService = {
      generateEmbedding: jest.fn().mockResolvedValue([0.1, 0.2, 0.3]),
    };

    const meilisearchService = {
      indexChunk: jest.fn().mockImplementation(async () => {
        calls.push('meili');
      }),
    };

    const service = new RagEmbeddingService(
      prisma as any,
      aiService as any,
      meilisearchService as any,
    );

    return { service, calls, prisma };
  };

  it('先写 Meili 再写向量，保证 Meili 失败时重试能补上', async () => {
    const { service, calls } = build();

    await service.embedDocument('doc_1');

    expect(calls).toEqual(['meili', 'vector']);
  });

  it('Meili 失败时不计成功，向量也不写（留给重试）', async () => {
    const { service, prisma } = build();
    const meili = (service as any).meilisearchService;
    meili.indexChunk = jest.fn().mockRejectedValue(new Error('meili down'));

    const result = await service.embedDocument('doc_1');

    expect(result.successCount).toBe(0);
    expect(result.failCount).toBe(1);
    // 关键：向量不能写下去。写了的话，下次重试 `embedding IS NULL` 就漏掉它，
    // Meili 那条索引永久缺失。
    expect(prisma.$executeRawUnsafe).not.toHaveBeenCalled();
  });
});
