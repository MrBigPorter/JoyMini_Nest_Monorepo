jest.mock('meilisearch', () => ({ Meilisearch: class {} }));

import { KbGenerationService } from './kb-generation.service';

const DOC = {
  id: 'doc-1',
  version: 3,
  activeVersion: 3,
  deletedAt: null as Date | null,
  content: 'Refunds take 3 business days.',
  contentHash: 'hash-1',
  domain: 'wallet',
  candidateTargetDomain: null,
  keywords: ['refund'],
  autoKeywords: [] as string[],
  locale: 'en',
  contentType: 'faq',
  docId: 'kb-refund',
  title: 'Refund Policy',
};

function build(overrides: { run?: any; doc?: any } = {}) {
  const prisma = {
    knowledgeDocument: {
      findUnique: jest.fn(async () => overrides.doc ?? DOC),
      update: jest.fn(async () => ({})),
    },
    kbGenerationRun: {
      findUnique: jest.fn(async () => overrides.run ?? null),
      findFirst: jest.fn(async () => null),
      count: jest.fn(async () => 0),
      create: jest.fn(async () => ({ id: 'run-1' })),
      update: jest.fn(async () => ({})),
    },
    kbGenerationCandidate: {
      createMany: jest.fn(async () => ({ count: 0 })),
    },
  } as any;

  const generator = {
    generate: jest.fn(async () => ({
      keywords: ['refund window'],
      intent_examples: ['how long do refunds take?'],
      golden_queries: [{ query: 'how long does a refund take?', lang: 'en' }],
    })),
  } as any;

  const dedupe = {
    dedupeIntentExamples: jest.fn(async (_domain: string, texts: string[]) => ({
      kept: texts.map((text) => ({
        text,
        normalizedHash: `h-${text.length}`,
        nearestScore: 0.71,
      })),
      dropped: 0,
      reasons: {},
    })),
    dedupeGoldenQueries: jest.fn(
      async (
        _documentId: string,
        queries: Array<{ query: string; lang?: string }>,
      ) => ({
        kept: queries.map((query) => ({
          ...query,
          normalizedHash: `g-${query.query.length}`,
        })),
        dropped: 0,
        reasons: {},
      }),
    ),
  } as any;

  const knowledgeDomainService = {
    getCandidateTargetIntent: jest.fn(async () => 'rag'),
  } as any;

  const intentDomainService = {
    list: jest.fn(async () => [
      { label: 'rag' },
      { label: 'order' },
      { label: 'general' },
    ]),
  } as any;

  const queue = {
    add: jest.fn(async () => undefined),
  } as any;

  const keywordAutoApply = {
    applyForRun: jest.fn(async () => ({ applied: 0, pending: 0, failed: 0 })),
  } as any;

  const service = new KbGenerationService(
    prisma,
    generator,
    dedupe,
    knowledgeDomainService,
    intentDomainService,
    queue,
    keywordAutoApply,
  );

  return {
    service,
    prisma,
    generator,
    dedupe,
    knowledgeDomainService,
    intentDomainService,
    queue,
    keywordAutoApply,
  };
}

describe('KbGenerationService.enqueue', () => {
  const original = process.env.KB_GENERATION_ENABLED;

  afterEach(() => {
    if (original === undefined) delete process.env.KB_GENERATION_ENABLED;
    else process.env.KB_GENERATION_ENABLED = original;
  });

  it('does nothing when the feature flag is off', async () => {
    process.env.KB_GENERATION_ENABLED = 'false';
    const { service, queue } = build();

    const result = await service.enqueue('doc-1');

    expect(result).toEqual({ enqueued: false, reason: 'disabled' });
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('creates a QUEUED run and enqueues it for a published document', async () => {
    process.env.KB_GENERATION_ENABLED = 'true';
    const { service, prisma, queue, knowledgeDomainService } = build();

    const result = await service.enqueue('doc-1');

    expect(result).toEqual({ enqueued: true, runId: 'run-1' });
    expect(
      knowledgeDomainService.getCandidateTargetIntent,
    ).toHaveBeenCalledWith('wallet', null);
    expect(prisma.kbGenerationRun.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          documentId: 'doc-1',
          documentVersion: 3,
          targetDomain: 'rag',
          status: 'QUEUED',
        }),
      }),
    );
    const [, idempotencyKey] = queue.add.mock.calls[0];
    expect(idempotencyKey).toHaveLength(64);
  });

  it('skips a document that was never published', async () => {
    process.env.KB_GENERATION_ENABLED = 'true';
    const { service, queue } = build({ doc: { ...DOC, activeVersion: 0 } });

    const result = await service.enqueue('doc-1');

    expect(result.reason).toBe('not-published');
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('reuses an existing terminal run instead of generating again', async () => {
    process.env.KB_GENERATION_ENABLED = 'true';
    const { service, prisma, queue } = build({
      run: {
        id: 'run-old',
        status: 'DONE',
        error: null,
        createdAt: new Date(),
      },
    });

    const result = await service.enqueue('doc-1');

    expect(result).toEqual({
      enqueued: false,
      reason: 'run-done',
      runId: 'run-old',
    });
    expect(prisma.kbGenerationRun.create).not.toHaveBeenCalled();
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('skips regeneration when content is unchanged across a version bump', async () => {
    process.env.KB_GENERATION_ENABLED = 'true';
    const { service, prisma, queue } = build();
    prisma.kbGenerationRun.findFirst.mockResolvedValue({
      id: 'run-done',
      status: 'DONE',
      contentHash: 'hash-1',
    });

    const result = await service.enqueue('doc-1');

    expect(result.reason).toBe('content-unchanged');
    expect(prisma.knowledgeDocument.update).toHaveBeenCalledWith({
      where: { id: 'doc-1' },
      data: { lastCandidateVersion: 3 },
    });
    expect(queue.add).not.toHaveBeenCalled();
  });
});

describe('KbGenerationService.processRun', () => {
  const RUN = {
    id: 'run-1',
    documentId: 'doc-1',
    documentVersion: 3,
    targetDomain: 'rag',
    status: 'QUEUED',
    error: null,
  };

  it('writes candidates and marks the run DONE', async () => {
    const { service, prisma, queue } = build();
    prisma.kbGenerationRun.findUnique.mockResolvedValueOnce(RUN);
    prisma.kbGenerationRun.findUnique.mockResolvedValueOnce(RUN);
    prisma.kbGenerationCandidate.createMany.mockResolvedValueOnce({ count: 3 });

    await service.processRun('run-1');

    expect(prisma.kbGenerationCandidate.createMany).toHaveBeenCalledTimes(1);
    const payload = prisma.kbGenerationCandidate.createMany.mock.calls[0][0];
    expect(payload.data).toHaveLength(3);
    expect(payload.data.map((item: any) => item.kind)).toEqual(
      expect.arrayContaining(['KEYWORD', 'INTENT_EXAMPLE', 'GOLDEN_QUERY']),
    );
    expect(prisma.kbGenerationRun.update).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: { id: 'run-1' },
        data: expect.objectContaining({ status: 'DONE', candidateCount: 3 }),
      }),
    );
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('marks the run SKIPPED when the LLM is unavailable and does not throw', async () => {
    const { service, prisma, generator } = build();
    generator.generate.mockResolvedValueOnce(null);
    prisma.kbGenerationRun.findUnique.mockResolvedValueOnce(RUN);
    prisma.kbGenerationRun.findUnique.mockResolvedValueOnce(RUN);

    await expect(service.processRun('run-1')).resolves.toBeUndefined();

    expect(prisma.kbGenerationCandidate.createMany).not.toHaveBeenCalled();
    expect(prisma.kbGenerationRun.update).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'SKIPPED',
          error: 'llm_unavailable',
        }),
      }),
    );
  });

  it('skips without generating when the document version advanced', async () => {
    const { service, prisma, generator } = build({
      doc: { ...DOC, version: 4 },
    });
    prisma.kbGenerationRun.findUnique.mockResolvedValueOnce(RUN);
    prisma.kbGenerationRun.findUnique.mockResolvedValueOnce(RUN);

    await service.processRun('run-1');

    expect(generator.generate).not.toHaveBeenCalled();
    expect(prisma.kbGenerationRun.update).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'SKIPPED',
          error: 'stale_version',
        }),
      }),
    );
  });

  it('records FAILED when generation throws and does not rethrow', async () => {
    const { service, prisma, generator } = build();
    generator.generate.mockRejectedValueOnce(new Error('provider down'));
    prisma.kbGenerationRun.findUnique.mockResolvedValueOnce(RUN);
    prisma.kbGenerationRun.findUnique.mockResolvedValueOnce(RUN);

    await expect(service.processRun('run-1')).resolves.toBeUndefined();

    expect(prisma.kbGenerationRun.update).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'FAILED',
          error: 'provider down',
        }),
      }),
    );
  });
});
