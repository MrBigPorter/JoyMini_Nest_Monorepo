// meilisearch 是 ESM 包，jest 不转译 node_modules；这里只测逻辑，用占位类替掉客户端。
jest.mock('meilisearch', () => ({ Meilisearch: class {} }));

import {
  effectiveKeywords,
  KbKeywordAutoApplyService,
} from './kb-keyword-auto-apply.service';

const CANDIDATE = {
  id: 'cand-1',
  documentId: 'doc-1',
  documentVersion: 3,
  text: 'refund window',
};

const DOC = {
  id: 'doc-1',
  version: 3,
  domain: 'wallet',
  title: 'Refund Policy',
  keywords: ['refund'],
  autoKeywords: [] as string[],
  processStatus: 'indexed',
  deletedAt: null as Date | null,
};

function build(
  options: {
    doc?: Partial<typeof DOC> | null;
    candidates?: any[];
    meiliError?: boolean;
  } = {},
) {
  const prisma = {
    kbGenerationCandidate: {
      findMany: jest.fn(async () => options.candidates ?? [CANDIDATE]),
      findUnique: jest.fn(),
      updateMany: jest.fn(async () => ({ count: 1 })),
      update: jest.fn(async () => ({})),
    },
    knowledgeDocument: {
      findUnique: jest.fn(async () =>
        options.doc === null ? null : { ...DOC, ...options.doc },
      ),
    },
    documentChunk: {
      findMany: jest.fn(async () => [{ id: 'chunk-1' }, { id: 'chunk-2' }]),
    },
    $queryRawUnsafe: jest.fn(async () => [
      { auto_keywords: ['refund window'], keywords: ['refund'] },
    ]),
  } as any;

  const meilisearchService = {
    updateChunkMetadata: options.meiliError
      ? jest.fn(async () => {
          throw new Error('meili down');
        })
      : jest.fn(async () => undefined),
  } as any;

  const service = new KbKeywordAutoApplyService(prisma, meilisearchService);
  return { service, prisma, meilisearchService };
}

describe('effectiveKeywords', () => {
  it('merges keywords and autoKeywords with case-insensitive dedupe', () => {
    expect(
      effectiveKeywords(['Refund', 'withdraw'], ['refund', 'payout']),
    ).toEqual(['Refund', 'withdraw', 'payout']);
  });
});

describe('KbKeywordAutoApplyService.applyForRun', () => {
  const original = process.env.KB_KEYWORD_AUTO_APPLY;

  beforeEach(() => {
    process.env.KB_KEYWORD_AUTO_APPLY = 'true';
  });

  afterEach(() => {
    if (original === undefined) delete process.env.KB_KEYWORD_AUTO_APPLY;
    else process.env.KB_KEYWORD_AUTO_APPLY = original;
  });

  it('does nothing when auto-apply is disabled', async () => {
    process.env.KB_KEYWORD_AUTO_APPLY = 'false';
    const { service, prisma } = build();

    const outcome = await service.applyForRun('run-1');

    expect(outcome).toEqual({ applied: 0, pending: 0, failed: 0 });
    expect(prisma.kbGenerationCandidate.findMany).not.toHaveBeenCalled();
  });

  it('appends the keyword, updates Meili and marks the candidate applied', async () => {
    const { service, prisma, meilisearchService } = build();

    const outcome = await service.applyForRun('run-1');

    expect(outcome).toEqual({ applied: 1, pending: 0, failed: 0 });
    expect(prisma.kbGenerationCandidate.updateMany).toHaveBeenCalledWith({
      where: { id: 'cand-1', status: 'PENDING' },
      data: expect.objectContaining({ status: 'AUTO_APPLIED' }),
    });
    expect(meilisearchService.updateChunkMetadata).toHaveBeenCalledWith(
      ['chunk-1', 'chunk-2'],
      { keywords: ['refund', 'refund window'] },
    );
    expect(prisma.kbGenerationCandidate.update).toHaveBeenCalledWith({
      where: { id: 'cand-1' },
      data: expect.objectContaining({
        rollbackableUntil: expect.any(Date),
        previousValue: { keywords: ['refund'], autoKeywords: [] },
      }),
    });
  });

  it('leaves the candidate pending when the document is not indexed', async () => {
    const { service, prisma, meilisearchService } = build({
      doc: { processStatus: 'chunked' },
    });

    const outcome = await service.applyForRun('run-1');

    expect(outcome).toEqual({ applied: 0, pending: 1, failed: 0 });
    expect(prisma.kbGenerationCandidate.updateMany).not.toHaveBeenCalled();
    expect(meilisearchService.updateChunkMetadata).not.toHaveBeenCalled();
  });

  it('respects the per-document keyword cap', async () => {
    const { service, prisma } = build({
      doc: {
        keywords: Array.from({ length: 20 }, (_, i) => `k${i}`),
      },
    });

    const outcome = await service.applyForRun('run-1');

    expect(outcome.pending).toBe(1);
    expect(prisma.kbGenerationCandidate.updateMany).not.toHaveBeenCalled();
  });

  it('marks the candidate FAILED when Meili rejects the update', async () => {
    const { service, prisma } = build({ meiliError: true });

    const outcome = await service.applyForRun('run-1');

    expect(outcome).toEqual({ applied: 0, pending: 0, failed: 1 });
    expect(prisma.kbGenerationCandidate.update).toHaveBeenCalledWith({
      where: { id: 'cand-1' },
      data: { status: 'FAILED', autoApplied: false, appliedBy: null },
    });
  });

  it('retries FAILED candidates by reclaiming them to PENDING first', async () => {
    const { service, prisma } = build({ candidates: [CANDIDATE] });

    const outcome = await service.retryFailed();

    expect(prisma.kbGenerationCandidate.updateMany).toHaveBeenCalledWith({
      where: { id: 'cand-1', status: 'FAILED' },
      data: { status: 'PENDING' },
    });
    expect(outcome.applied).toBe(1);
  });
});

describe('KbKeywordAutoApplyService.rollbackKeyword', () => {
  it('removes only that candidate keyword and refreshes Meili', async () => {
    const { service, prisma, meilisearchService } = build();
    prisma.kbGenerationCandidate.findUnique.mockResolvedValue({
      id: 'cand-1',
      documentId: 'doc-1',
      kind: 'KEYWORD',
      status: 'AUTO_APPLIED',
      text: 'refund window',
      autoApplied: true,
      rollbackableUntil: new Date(Date.now() + 60_000),
    });
    prisma.$queryRawUnsafe.mockResolvedValue([
      { auto_keywords: [], keywords: ['refund'] },
    ]);

    const result = await service.rollbackKeyword('cand-1', 'admin-1');

    expect(result.keywords).toEqual(['refund']);
    expect(meilisearchService.updateChunkMetadata).toHaveBeenCalledWith(
      ['chunk-1', 'chunk-2'],
      { keywords: ['refund'] },
    );
    expect(prisma.kbGenerationCandidate.update).toHaveBeenCalledWith({
      where: { id: 'cand-1' },
      data: expect.objectContaining({
        status: 'ROLLED_BACK',
        reviewedBy: 'admin-1',
      }),
    });
  });

  it('rejects rollback outside the window', async () => {
    const { service, prisma } = build();
    prisma.kbGenerationCandidate.findUnique.mockResolvedValue({
      id: 'cand-1',
      documentId: 'doc-1',
      kind: 'KEYWORD',
      status: 'AUTO_APPLIED',
      text: 'refund window',
      autoApplied: true,
      rollbackableUntil: new Date(Date.now() - 60_000),
    });

    await expect(service.rollbackKeyword('cand-1', 'admin-1')).rejects.toThrow(
      'Rollback window has expired',
    );
  });

  it('rejects candidates that were never auto-applied', async () => {
    const { service, prisma } = build();
    prisma.kbGenerationCandidate.findUnique.mockResolvedValue({
      id: 'cand-1',
      documentId: 'doc-1',
      kind: 'KEYWORD',
      status: 'PENDING',
      text: 'refund window',
      autoApplied: false,
      rollbackableUntil: null,
    });

    await expect(service.rollbackKeyword('cand-1', 'admin-1')).rejects.toThrow(
      'Only auto-applied keyword candidates',
    );
  });
});
