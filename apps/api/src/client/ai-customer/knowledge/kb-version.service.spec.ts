// 依赖链会加载 meilisearch（ESM 包），先占位替掉。
jest.mock('meilisearch', () => ({ Meilisearch: class {} }));

import { KbVersionService } from './kb-version.service';

/**
 * Task 6：切换（激活）与回滚。
 *
 * 门 = 这一版的所有 chunk 都已向量化 + Meili 标记翻转成功。
 * 任一步不满足 → 不切换，旧版本继续服务（失败等于没发生）。
 */
describe('KbVersionService（Task 6）', () => {
  const build = (opts: {
    total?: number;
    ready?: number;
    activeVersion?: number;
    casCount?: number;
    meiliRejects?: boolean;
  }) => {
    const prisma = {
      knowledgeDocument: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'doc_1',
          version: 4,
          activeVersion: opts.activeVersion ?? 3,
        }),
        updateMany: jest.fn().mockResolvedValue({ count: opts.casCount ?? 1 }),
        findMany: jest.fn().mockResolvedValue([
          { id: 'c_old', documentVersion: 3 },
          { id: 'c_new', documentVersion: 4 },
        ]),
      },
      documentChunk: {
        count: jest.fn().mockResolvedValue(opts.total ?? 2),
        findMany: jest.fn().mockResolvedValue([
          { id: 'c_old', documentVersion: 3 },
          { id: 'c_new', documentVersion: 4 },
        ]),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      $queryRawUnsafe: jest
        .fn()
        .mockResolvedValue([{ count: opts.ready ?? 2 }]),
    };

    const meilisearch = {
      setChunkActiveFlags: opts.meiliRejects
        ? jest.fn().mockRejectedValue(new Error('meili down'))
        : jest.fn().mockResolvedValue(undefined),
      deleteChunksByDocument: jest.fn().mockResolvedValue(undefined),
      deleteChunkVersionsBelow: jest.fn().mockResolvedValue(undefined),
    };

    const redis = { set: jest.fn().mockResolvedValue('OK') };

    const service = new KbVersionService(
      prisma as any,
      meilisearch as any,
      redis as any,
    );
    return { service, prisma, meilisearch, redis };
  };

  it('有 chunk 还没向量化 → 不切换，旧版本继续服务', async () => {
    const { service, prisma, meilisearch } = build({ total: 2, ready: 1 });

    const result = await service.activate('doc_1', 4);

    expect(result.switched).toBe(false);
    expect(result.reason).toBe('chunks-not-ready');
    expect(meilisearch.setChunkActiveFlags).not.toHaveBeenCalled();
    expect(prisma.knowledgeDocument.updateMany).not.toHaveBeenCalled();
  });

  it('全部就绪 → 先翻 Meili 标记，再 CAS 写 activeVersion', async () => {
    const { service, prisma, meilisearch } = build({ total: 2, ready: 2 });

    const result = await service.activate('doc_1', 4);

    expect(result.switched).toBe(true);
    // 只有目标版本翻成 true，旧版本翻成 false
    expect(meilisearch.setChunkActiveFlags).toHaveBeenCalledWith([
      { chunkId: 'c_old', isActiveVersion: false },
      { chunkId: 'c_new', isActiveVersion: true },
    ]);
    // CAS 以「当前 activeVersion」为条件，防并发切换
    expect(prisma.knowledgeDocument.updateMany).toHaveBeenCalledWith({
      where: { id: 'doc_1', activeVersion: 3 },
      data: { activeVersion: 4, activeVersionAt: expect.any(Date) },
    });
  });

  it('Meili 翻标记失败 → 不写 PG，抛给上层重试', async () => {
    const { service, prisma } = build({
      total: 2,
      ready: 2,
      meiliRejects: true,
    });

    await expect(service.activate('doc_1', 4)).rejects.toThrow('meili down');
    expect(prisma.knowledgeDocument.updateMany).not.toHaveBeenCalled();
  });

  it('CAS 抢输（别人刚切过）→ 回滚 Meili 标记，返回未切换', async () => {
    const { service, meilisearch } = build({ total: 2, ready: 2, casCount: 0 });

    const result = await service.activate('doc_1', 4);

    expect(result.switched).toBe(false);
    expect(result.reason).toBe('cas-failed');
    // 补偿：把标记翻回切换前的状态
    expect(meilisearch.setChunkActiveFlags).toHaveBeenLastCalledWith([
      { chunkId: 'c_old', isActiveVersion: true },
      { chunkId: 'c_new', isActiveVersion: false },
    ]);
  });

  it('回滚到旧版本：把标记翻回去，不需要重建索引', async () => {
    const { service, prisma, meilisearch } = build({
      total: 2,
      ready: 2,
      activeVersion: 4,
    });

    const result = await service.rollback('doc_1', 3);

    expect(result.switched).toBe(true);
    expect(meilisearch.setChunkActiveFlags).toHaveBeenCalledWith([
      { chunkId: 'c_old', isActiveVersion: true },
      { chunkId: 'c_new', isActiveVersion: false },
    ]);
    expect(prisma.knowledgeDocument.updateMany).toHaveBeenCalledWith({
      where: { id: 'doc_1', activeVersion: 4 },
      data: { activeVersion: 3, activeVersionAt: expect.any(Date) },
    });
  });

  it('切换成功 → 记录知识库纪元（供跨版本告知）', async () => {
    const { service, redis } = build({ total: 2, ready: 2 });

    await service.activate('doc_1', 4);

    expect(redis.set).toHaveBeenCalledWith(
      'kb:version:epoch',
      expect.any(String),
    );
  });

  it('目标版本就是当前版本 → 幂等返回，不翻标记', async () => {
    const { service, meilisearch } = build({ activeVersion: 4 });

    const result = await service.activate('doc_1', 4);

    expect(result.switched).toBe(true);
    expect(result.reason).toBe('already-active');
  });

  it('已经是当前版本也要重刷标记（reindex 等「同版本重建」靠它恢复）', async () => {
    const { service, prisma, meilisearch } = build({ activeVersion: 4 });

    await service.activate('doc_1', 4);

    // reindex 会删掉全部 chunk 再按同一版本号重建，此时 activeVersion 早就等于
    // 目标版本；如果这里短路不翻标记，重建出来的条目全是 isActiveVersion=false，
    // BM25 层会永久空掉。
    expect(meilisearch.setChunkActiveFlags).toHaveBeenCalledWith([
      { chunkId: 'c_old', isActiveVersion: false },
      { chunkId: 'c_new', isActiveVersion: true },
    ]);
    expect(prisma.knowledgeDocument.updateMany).not.toHaveBeenCalled();
  });
});

/**
 * Task 7：保留期 = 回滚窗口。
 *
 * 旧版本 chunk 不能切完就删——回滚要用它们。只有「切换后稳定 N 天」才清，
 * 而且 PG 与 Meili 两侧一起清（只清一侧，回滚后那一层就是空的）。
 */
describe('KbVersionService.purgeStaleVersions（Task 7）', () => {
  const DAY = 24 * 60 * 60 * 1000;

  const build = (opts: {
    staleDocs: Array<{ id: string; activeVersion: number }>;
    deleteRejects?: boolean;
  }) => {
    const prisma = {
      knowledgeDocument: {
        findMany: jest.fn().mockResolvedValue(opts.staleDocs),
        updateMany: jest.fn(),
      },
      documentChunk: {
        count: jest.fn(),
        findMany: jest.fn(),
        deleteMany: opts.deleteRejects
          ? jest.fn().mockRejectedValue(new Error('db down'))
          : jest.fn().mockResolvedValue({ count: 3 }),
      },
      $queryRawUnsafe: jest.fn(),
    };
    const meilisearch = {
      setChunkActiveFlags: jest.fn(),
      deleteChunkVersionsBelow:
        opts.deleteRejects === true
          ? jest.fn().mockResolvedValue(undefined)
          : jest.fn().mockResolvedValue(undefined),
      deleteChunksByDocument: jest.fn(),
    };
    const service = new KbVersionService(prisma as any, meilisearch as any);
    return { service, prisma, meilisearch };
  };

  it('切换已稳定超过 7 天：两侧都清理旧版本', async () => {
    const { service, prisma, meilisearch } = build({
      staleDocs: [{ id: 'doc_1', activeVersion: 4 }],
    });

    const result = await service.purgeStaleVersions(new Date());

    expect(prisma.knowledgeDocument.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { activeVersionAt: { lt: expect.any(Date) } },
      }),
    );
    expect(prisma.documentChunk.deleteMany).toHaveBeenCalledWith({
      where: { documentId: 'doc_1', documentVersion: { lt: 4 } },
    });
    expect(meilisearch.deleteChunkVersionsBelow).toHaveBeenCalledWith(
      'doc_1',
      4,
    );
    expect(result.documents).toBe(1);
  });

  it('没有到保留期的文档：什么都不做', async () => {
    const { service, prisma, meilisearch } = build({ staleDocs: [] });

    const result = await service.purgeStaleVersions(new Date());

    expect(result).toEqual({ documents: 0, chunks: 0 });
    expect(prisma.documentChunk.deleteMany).not.toHaveBeenCalled();
    expect(meilisearch.deleteChunkVersionsBelow).not.toHaveBeenCalled();
  });

  it('清理失败不抛异常（不能因为清理把主流程带崩）', async () => {
    const { service } = build({
      staleDocs: [{ id: 'doc_1', activeVersion: 4 }],
      deleteRejects: true,
    });

    await expect(service.purgeStaleVersions(new Date())).resolves.toBeDefined();
  });
});
