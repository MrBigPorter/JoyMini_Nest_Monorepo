// 依赖链会加载 meilisearch、p-limit、uuid 等 ESM 包（jest 不转译 node_modules）。
// 本用例只测 uploadFile 的写入路径，不走向量化 / 上传 / AI，
// 所以把这些协作者整条 mock 掉，只保留被测服务本身。
jest.mock('meilisearch', () => ({ Meilisearch: class {} }));
jest.mock('p-limit', () => ({
  __esModule: true,
  default: (_n: number) => (fn: () => any) => fn(),
}));
jest.mock('./rag-embedding.service', () => ({ RagEmbeddingService: class {} }));
jest.mock('./rag-quality.service', () => ({ RagQualityService: class {} }));
jest.mock('@api/common/upload/upload.service', () => ({
  UploadService: class {},
}));
jest.mock('@api/common/ai/ai.service', () => ({ AiService: class {} }));
jest.mock('@api/common/prisma/prisma.service', () => ({
  PrismaService: class {},
}));

import { RagSyncService } from './rag-sync.service';

/**
 * Task 4：更新文档时不再删旧 chunk，改为「追加新版本」。
 *
 * 旧 chunk 一旦被删，检索在这个窗口里就查不到任何东西（用户得到"没有相关政策"）。
 * 保留旧版本 + 新版本并存，由 activeVersion 决定读哪一份。
 */
describe('RagSyncService 更新路径改为追加（Task 4）', () => {
  const build = () => {
    const prisma = {
      knowledgeDocument: {
        findUnique: jest.fn().mockResolvedValue({ id: 'doc_1', version: 2 }),
        update: jest.fn().mockImplementation(async ({ data }: any) => ({
          id: 'doc_1',
          version: data?.version ?? 2,
          domain: 'wallet',
        })),
        create: jest.fn(),
      },
      documentChunk: {
        deleteMany: jest.fn().mockResolvedValue({ count: 3 }),
        createMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };

    const ragChunkService = {
      chunkText: jest
        .fn()
        .mockResolvedValue([
          { index: 0, content: '退款 5 个工作日', tokenCount: 10 },
        ]),
    };
    const ragQualityService = {
      check: jest
        .fn()
        .mockReturnValue({ passed: true, overallScore: 90, flags: [] }),
    };
    const meilisearchService = {
      deleteChunksByDocument: jest.fn().mockResolvedValue(undefined),
    };
    const queue = { add: jest.fn().mockResolvedValue({ id: 'job-1' }) };

    const service = new RagSyncService(
      prisma as any,
      ragChunkService as any,
      {} as any, // ragEmbeddingService
      ragQualityService as any,
      {} as any, // uploadService
      meilisearchService as any,
      queue as any,
    );

    return { service, prisma, queue, meilisearchService };
  };

  const file = {
    originalname: 'refund.md',
    buffer: Buffer.from(
      '---\ntitle: 退款政策\ndomain: wallet\ndocId: refund-policy\n---\n\n退款 5 个工作日到账\n',
      'utf-8',
    ),
  } as any;

  it('不删除旧版本 chunk（旧版本要留给回滚和读请求）', async () => {
    const { service, prisma } = build();

    await service.uploadFile(file);

    expect(prisma.documentChunk.deleteMany).not.toHaveBeenCalled();
  });

  it('新 chunk 带新版本号，且入队任务携带 targetVersion', async () => {
    const { service, prisma, queue } = build();

    await service.uploadFile(file);

    const [createArgs] = prisma.documentChunk.createMany.mock.calls[0];
    expect(createArgs.data[0].documentVersion).toBe(3);

    expect(queue.add).toHaveBeenCalledWith('embed', {
      documentId: 'doc_1',
      targetVersion: 3,
    });
  });

  it('仍先把该文档在 Meili 的旧条目删掉（缺陷 B 的修复不能被回退）', async () => {
    const { service, meilisearchService } = build();

    await service.uploadFile(file);

    expect(meilisearchService.deleteChunksByDocument).toHaveBeenCalledWith(
      'doc_1',
    );
  });
});
