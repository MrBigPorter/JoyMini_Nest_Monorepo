import { RagService } from './rag.service';
import { sha256 } from '@api/common/crypto.util';

jest.mock('meilisearch', () => ({ Meilisearch: class {} }));
// p-limit 是 ESM-only 依赖，jest 默认不转换；这里只关心 delete 路径，给个直通实现即可。
jest.mock('p-limit', () => ({
  __esModule: true,
  default:
    () =>
    <T>(fn: () => Promise<T>) =>
      fn(),
}));

function buildService() {
  const prisma = {
    knowledgeDocument: {
      findUnique: jest.fn().mockResolvedValue({ id: 'doc-1', title: 't' }),
      delete: jest.fn().mockReturnValue('delete-doc'),
    },
    kbGenerationCandidate: { deleteMany: jest.fn().mockReturnValue('cands') },
    kbGenerationRun: { deleteMany: jest.fn().mockReturnValue('runs') },
    kbSyntheticGolden: { deleteMany: jest.fn().mockReturnValue('golden') },
    $transaction: jest.fn().mockResolvedValue([]),
  };
  const meilisearch = {
    deleteChunksByDocument: jest.fn().mockResolvedValue(undefined),
  };

  const service = new RagService(
    prisma as any,
    {} as any,
    {} as any,
    {} as any,
    meilisearch as any,
    {} as any,
    {} as any,
  );

  return { service, prisma, meilisearch };
}

describe('RagService.delete', () => {
  it('removes Meili chunks and purges kb-generation rows with the document', async () => {
    const { service, prisma, meilisearch } = buildService();

    await service.delete('doc-1');

    expect(meilisearch.deleteChunksByDocument).toHaveBeenCalledWith('doc-1');
    expect(prisma.kbGenerationCandidate.deleteMany).toHaveBeenCalledWith({
      where: { documentId: 'doc-1' },
    });
    expect(prisma.kbGenerationRun.deleteMany).toHaveBeenCalledWith({
      where: { documentId: 'doc-1' },
    });
    expect(prisma.kbSyntheticGolden.deleteMany).toHaveBeenCalledWith({
      where: { documentId: 'doc-1' },
    });
    expect(prisma.$transaction).toHaveBeenCalledWith([
      'cands',
      'runs',
      'golden',
      'delete-doc',
    ]);
  });

  it('does not delete anything when the document is missing', async () => {
    const { service, prisma, meilisearch } = buildService();
    prisma.knowledgeDocument.findUnique.mockResolvedValue(null);

    await expect(service.delete('nope')).rejects.toThrow('not found');
    expect(meilisearch.deleteChunksByDocument).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

describe('RagService 正文写入与版本保留', () => {
  const oldContent = 'old content';

  function buildContentService() {
    const doc = {
      id: 'doc-1',
      docId: 'refund-policy',
      locale: 'en',
      version: 2,
      content: oldContent,
      contentHash: sha256(oldContent),
      activeVersion: 2,
      title: 't',
      processStatus: 'indexed',
    };

    const prisma = {
      knowledgeDocument: {
        findUnique: jest.fn().mockResolvedValue(doc),
        create: jest
          .fn()
          .mockImplementation(async ({ data }: any) => ({ id: 'doc-1', ...data })),
        update: jest.fn().mockImplementation(async ({ data }: any) => ({
          ...doc,
          ...(data.version?.increment ? { version: doc.version + 1 } : {}),
        })),
      },
      documentChunk: {
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
        createMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const chunkService = {
      chunkText: jest
        .fn()
        .mockResolvedValue([{ index: 0, content: 'chunk', tokenCount: 5 }]),
    };
    const qualityService = {
      check: jest
        .fn()
        .mockReturnValue({ overallScore: 90, flags: [] }),
    };
    const meilisearch = {
      deleteChunksByDocument: jest.fn().mockResolvedValue(undefined),
      deleteChunkVersion: jest.fn().mockResolvedValue(undefined),
    };
    const queue = { add: jest.fn().mockResolvedValue({ id: 'job-1' }) };
    const domains = { resolve: jest.fn(async (domain: string) => domain) };

    const service = new RagService(
      prisma as any,
      chunkService as any,
      {} as any,
      qualityService as any,
      meilisearch as any,
      domains as any,
      queue as any,
    );

    return { service, prisma, chunkService, meilisearch, queue, doc };
  }

  it('create 写入正文 sha256，而不是只写正文', async () => {
    const { service, prisma } = buildContentService();
    const content = '# 退款\n5 个工作日到账';

    await service.create({
      title: '退款政策',
      domain: 'wallet',
      docId: 'refund-policy',
      content,
    } as any);

    const [args] = prisma.knowledgeDocument.create.mock.calls[0];
    expect(args.data.contentHash).toBe(sha256(content));
  });

  it('纯元数据编辑不写正文、也不改写 contentHash', async () => {
    const { service, prisma } = buildContentService();

    await service.update('doc-1', { title: '新标题' });

    const [args] = prisma.knowledgeDocument.update.mock.calls[0];
    expect(args.data).not.toHaveProperty('content');
    expect(args.data).not.toHaveProperty('contentHash');
    expect(args.data.title).toBe('新标题');
  });

  it('创建后修改 docId 或 locale 都会被拒绝', async () => {
    const { service, prisma } = buildContentService();

    await expect(service.update('doc-1', { docId: 'other-doc' })).rejects.toThrow(
      'docId 创建后不可修改',
    );
    await expect(service.update('doc-1', { locale: 'zh' })).rejects.toThrow(
      'locale 创建后不可修改',
    );
    expect(prisma.knowledgeDocument.update).not.toHaveBeenCalled();
  });

  it('updateContent 刷新哈希、追加新版本分块且不删旧版本', async () => {
    const { service, prisma, queue } = buildContentService();
    const newContent = '# 新退款政策\n7 个工作日到账';

    await service.updateContent('doc-1', newContent);

    const [updateArgs] = prisma.knowledgeDocument.update.mock.calls[0];
    expect(updateArgs.data.contentHash).toBe(sha256(newContent));
    expect(updateArgs.data.version).toEqual({ increment: 1 });
    expect(updateArgs.data.processStatus).toBe('chunked');

    // 旧版本必须保留，供切换前读取与保留期内回滚。
    expect(prisma.documentChunk.deleteMany).not.toHaveBeenCalled();

    const [createArgs] = prisma.documentChunk.createMany.mock.calls[0];
    expect(createArgs.data[0].documentVersion).toBe(3);

    expect(queue.add).toHaveBeenCalledWith('embed', {
      documentId: 'doc-1',
      force: true,
      targetVersion: 3,
      trigger: 'manual',
    });
  });

  it('reindex 只重建当前版本，旧版本分块与索引都保留', async () => {
    const { service, prisma, meilisearch } = buildContentService();

    await service.reindex('doc-1');

    expect(meilisearch.deleteChunkVersion).toHaveBeenCalledWith('doc-1', 2);
    expect(meilisearch.deleteChunksByDocument).not.toHaveBeenCalled();
    expect(prisma.documentChunk.deleteMany).toHaveBeenCalledWith({
      where: { documentId: 'doc-1', documentVersion: 2 },
    });

    const [createArgs] = prisma.documentChunk.createMany.mock.calls[0];
    expect(createArgs.data[0].documentVersion).toBe(2);
  });
});
