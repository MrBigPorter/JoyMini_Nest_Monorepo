import { RagEmbeddingProcessor } from './rag-embedding.processor';

// RagEmbeddingService 会连带加载 meilisearch（ESM，jest 不转译 node_modules）。
// 这里测的是 processor 的状态语义，不需要真实服务，直接 mock 掉整条依赖链。
jest.mock('./rag-embedding.service', () => ({ RagEmbeddingService: class {} }));
jest.mock('@api/client/ai-customer/knowledge/kb-version.service', () => ({
  KbVersionService: class {},
}));

/**
 * N-6：向量化部分失败时的状态语义。
 *
 * 锁住两个行为，防止以后改回「失败只 warn、状态照样 indexed」：
 *   1. 有 chunk 失败 → 抛异常（交给 BullMQ 退避重试），且不写 indexed
 *   2. 全部成功 → 才允许写 indexed
 */
describe('RagEmbeddingProcessor 状态语义（N-6）', () => {
  /** 构造一个最小可用的 BullMQ Job（只用到 id / data / opts / attemptsMade） */
  const makeJob = (attemptsMade = 0) =>
    ({
      id: 'job-1',
      data: { documentId: 'doc-1' },
      opts: { attempts: 3 },
      attemptsMade,
    }) as any;

  /** 用 mock 替代 RagEmbeddingService 和 PrismaService，不需要 Nest 容器 */
  const makeProcessor = (result: {
    successCount: number;
    failCount: number;
    errors: { chunkIndex: number; reason: string }[];
    durationMs: number;
  }) => {
    const embedding = {
      embedDocument: jest.fn().mockResolvedValue(result),
    };
    const prisma = {
      knowledgeDocument: {
        update: jest.fn().mockResolvedValue({}),
        findUnique: jest.fn().mockResolvedValue({ version: 3 }),
      },
    };
    const kbVersion = {
      activate: jest.fn().mockResolvedValue({ switched: true }),
    };
    const processor = new RagEmbeddingProcessor(
      embedding as any,
      prisma as any,
      kbVersion as any,
    );
    return { processor, prisma, kbVersion };
  };

  it('有失败 chunk：抛出异常，且不写 indexed', async () => {
    const { processor, prisma } = makeProcessor({
      successCount: 2,
      failCount: 1,
      errors: [{ chunkIndex: 3, reason: '429 rate limited' }],
      durationMs: 10,
    });

    await expect(processor.process(makeJob())).rejects.toThrow(
      '1 chunk(s) failed embedding for doc-1',
    );

    // 关键断言：状态更新一次都不能发生
    expect(prisma.knowledgeDocument.update).not.toHaveBeenCalled();
  });

  it('全部成功：标记 indexed', async () => {
    const { processor, prisma } = makeProcessor({
      successCount: 3,
      failCount: 0,
      errors: [],
      durationMs: 10,
    });

    await processor.process(makeJob());

    expect(prisma.knowledgeDocument.update).toHaveBeenCalledWith({
      where: { id: 'doc-1' },
      data: { processStatus: 'indexed' },
    });
  });

  it('带 targetVersion：成功后尝试切换对外版本', async () => {
    const { processor, kbVersion } = makeProcessor({
      successCount: 3,
      failCount: 0,
      errors: [],
      durationMs: 10,
    });

    await processor.process({
      ...makeJob(),
      data: { documentId: 'doc-1', targetVersion: 4 },
    } as any);

    expect(kbVersion.activate).toHaveBeenCalledWith('doc-1', 4, {
      trigger: 'upload',
    });
  });

  it('切换被门挡下：任务本身仍算成功（旧版本继续服务）', async () => {
    const { processor, kbVersion } = makeProcessor({
      successCount: 3,
      failCount: 0,
      errors: [],
      durationMs: 10,
    });
    kbVersion.activate.mockResolvedValue({
      switched: false,
      reason: 'chunks-not-ready',
    });

    await expect(
      processor.process({
        ...makeJob(),
        data: { documentId: 'doc-1', targetVersion: 4 },
      } as any),
    ).resolves.toBeUndefined();
  });

  it('不带 targetVersion（reindex/updateContent 等老路径）：用文档当前版本激活', async () => {
    const { processor, kbVersion } = makeProcessor({
      successCount: 3,
      failCount: 0,
      errors: [],
      durationMs: 10,
    });

    await processor.process(makeJob());

    // 这些路径照样会写出 isActiveVersion=false 的条目；不激活的话
    // BM25 层就永久空着。回退到 document.version 是唯一安全的兜底。
    expect(kbVersion.activate).toHaveBeenCalledWith('doc-1', 3, {
      trigger: 'upload',
    });
  });
});
