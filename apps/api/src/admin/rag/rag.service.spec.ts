import { RagService } from './rag.service';

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
