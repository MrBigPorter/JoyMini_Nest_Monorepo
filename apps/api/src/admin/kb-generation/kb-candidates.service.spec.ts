jest.mock('meilisearch', () => ({ Meilisearch: class {} }));

import { KbCandidatesService } from './kb-candidates.service';

const PENDING_EXAMPLE = {
  id: 'cand-1',
  kind: 'INTENT_EXAMPLE',
  status: 'PENDING',
  text: 'how long do refunds take?',
  targetDomain: 'rag',
  locale: 'en',
  normalizedHash: 'hash-old',
  documentId: 'doc-1',
  documentVersion: 3,
  payload: null,
  needsReview: true,
};

function build(options: { candidate?: any; candidates?: any[] } = {}) {
  const prisma = {
    kbGenerationCandidate: {
      findUnique: jest.fn(async () => options.candidate ?? PENDING_EXAMPLE),
      findMany: jest.fn(async () => options.candidates ?? []),
      update: jest.fn(async () => ({})),
      updateMany: jest.fn(async () => ({ count: 1 })),
      groupBy: jest.fn(async () => []),
      count: jest.fn(async () => 0),
    },
    knowledgeDocument: {
      findUnique: jest.fn(async () => ({
        id: 'doc-1',
        docId: 'kb-refund',
        domain: 'wallet',
        deletedAt: null,
        version: 3,
      })),
    },
    kbSyntheticGolden: {
      create: jest.fn(async () => ({ id: 'golden-1' })),
    },
    intentExample: {
      count: jest.fn(async () => 10),
    },
  } as any;

  const intentExamplesService = {
    appendCandidateExample: jest.fn(async () => ({ domain: 'rag', count: 1 })),
  } as any;

  const intentDomainService = {
    assertEnabled: jest.fn(async (label: string) => ({ label })),
  } as any;

  const keywordAutoApply = {
    applyPendingCandidate: jest.fn(async () => 'applied'),
    rollbackKeyword: jest.fn(),
  } as any;

  const generationService = {
    regenerate: jest.fn(async () => ({ enqueued: true, runId: 'run-1' })),
  } as any;

  const service = new KbCandidatesService(
    prisma,
    intentExamplesService,
    intentDomainService,
    keywordAutoApply,
    generationService,
  );

  return {
    service,
    prisma,
    intentExamplesService,
    intentDomainService,
    keywordAutoApply,
    generationService,
  };
}

describe('KbCandidatesService.approve', () => {
  it('applies an intent example through the dual-write service', async () => {
    const { service, prisma, intentExamplesService, intentDomainService } =
      build();

    await service.approve('cand-1', {}, 'admin-1');

    expect(intentDomainService.assertEnabled).toHaveBeenCalledWith('rag');
    expect(intentExamplesService.appendCandidateExample).toHaveBeenCalledWith(
      'rag',
      PENDING_EXAMPLE.text,
      expect.objectContaining({ id: 'cand-1', locale: 'en' }),
      'admin-1',
    );
    expect(prisma.kbGenerationCandidate.update).toHaveBeenCalledWith({
      where: { id: 'cand-1' },
      data: expect.objectContaining({
        status: 'APPLIED',
        appliedBy: 'admin-1',
        reviewedBy: 'admin-1',
      }),
    });
  });

  it('retargets to an override domain before applying', async () => {
    const { service, intentExamplesService } = build();

    await service.approve('cand-1', { targetDomain: 'wallet' }, 'admin-1');

    expect(intentExamplesService.appendCandidateExample).toHaveBeenCalledWith(
      'wallet',
      expect.any(String),
      expect.any(Object),
      'admin-1',
    );
  });

  it('creates a synthetic golden row and never marks it as authentic', async () => {
    const { service, prisma } = build({
      candidate: {
        ...PENDING_EXAMPLE,
        kind: 'GOLDEN_QUERY',
        payload: { expectedDocIds: ['kb-refund-2'], lang: 'en' },
      },
    });

    await service.approve('cand-1', {}, 'admin-1');

    expect(prisma.kbSyntheticGolden.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        candidateId: 'cand-1',
        expectedDocIds: ['kb-refund-2'],
        sourceType: 'synthetic',
        enabled: true,
        approvedBy: 'admin-1',
      }),
    });
    expect(prisma.kbGenerationCandidate.update).toHaveBeenCalledWith({
      where: { id: 'cand-1' },
      data: expect.objectContaining({
        status: 'APPLIED',
        appliedRef: 'golden-1',
      }),
    });
  });

  it('delegates keywords to the reversible auto-apply path', async () => {
    const { service, keywordAutoApply } = build({
      candidate: { ...PENDING_EXAMPLE, kind: 'KEYWORD' },
    });

    await service.approve('cand-1', {}, 'admin-1');

    expect(keywordAutoApply.applyPendingCandidate).toHaveBeenCalledWith(
      'cand-1',
      'admin-1',
    );
  });

  it('rejects approval of non-pending candidates', async () => {
    const { service } = build({
      candidate: { ...PENDING_EXAMPLE, status: 'APPLIED' },
    });

    await expect(service.approve('cand-1', {}, 'admin-1')).rejects.toThrow(
      'Only PENDING candidates',
    );
  });
});

describe('KbCandidatesService.reject', () => {
  it('requires a pending candidate to reject', async () => {
    const { service, prisma } = build();
    prisma.kbGenerationCandidate.updateMany.mockResolvedValueOnce({
      count: 0,
    });

    await expect(
      service.reject('cand-1', 'duplicate', 'admin-1'),
    ).rejects.toThrow('Only PENDING candidates');
  });

  it('stores the reason and reviewer', async () => {
    const { service, prisma } = build();

    await service.reject('cand-1', 'duplicate', 'admin-1');

    expect(prisma.kbGenerationCandidate.updateMany).toHaveBeenCalledWith({
      where: { id: 'cand-1', status: 'PENDING' },
      data: expect.objectContaining({
        status: 'REJECTED',
        rejectReason: 'duplicate',
        reviewedBy: 'admin-1',
      }),
    });
  });
});

describe('KbCandidatesService.retarget', () => {
  it('only allows INTENT_EXAMPLE candidates', async () => {
    const { service } = build({
      candidate: { ...PENDING_EXAMPLE, kind: 'KEYWORD' },
    });

    await expect(
      service.retarget('cand-1', { targetDomain: 'wallet' }),
    ).rejects.toThrow('Only INTENT_EXAMPLE');
  });

  it('validates the target domain is enabled', async () => {
    const { service, intentDomainService } = build();
    intentDomainService.assertEnabled.mockRejectedValueOnce(
      new Error('unknown domain'),
    );

    await expect(
      service.retarget('cand-1', { targetDomain: 'nope' }),
    ).rejects.toThrow('unknown domain');
  });
});

describe('KbCandidatesService.batch', () => {
  it('requires confirm=true', async () => {
    const { service } = build();

    await expect(
      service.batch(
        {
          ids: ['cand-1'],
          action: 'approve',
          confirm: false,
        } as any,
        'admin-1',
      ),
    ).rejects.toThrow('confirm=true');
  });

  it('refuses to mix candidate kinds', async () => {
    const { service } = build({
      candidates: [
        { ...PENDING_EXAMPLE, id: 'a' },
        { ...PENDING_EXAMPLE, id: 'b', kind: 'KEYWORD' },
      ],
    });

    await expect(
      service.batch(
        { ids: ['a', 'b'], action: 'approve', confirm: true } as any,
        'admin-1',
      ),
    ).rejects.toThrow('cannot mix candidate kinds');
  });

  it('skips needsReview candidates unless explicitly included', async () => {
    const { service, keywordAutoApply } = build({
      candidates: [
        { ...PENDING_EXAMPLE, id: 'a', kind: 'KEYWORD', needsReview: true },
      ],
    });

    const result = await service.batch(
      { ids: ['a'], action: 'approve', confirm: true } as any,
      'admin-1',
    );

    expect(result).toEqual({
      applied: 0,
      rejected: 0,
      skipped: 1,
      failed: [],
    });
    expect(keywordAutoApply.applyPendingCandidate).not.toHaveBeenCalled();
  });

  it('blocks example batches that grow a domain by more than 10%', async () => {
    const { service } = build({
      candidates: [
        { ...PENDING_EXAMPLE, id: 'a', needsReview: false },
        { ...PENDING_EXAMPLE, id: 'b', needsReview: false },
      ],
    });

    // existing=10, incoming=2 → 20% > 10%
    await expect(
      service.batch(
        { ids: ['a', 'b'], action: 'approve', confirm: true } as any,
        'admin-1',
      ),
    ).rejects.toThrow('more than 10%');
  });

  it('allows the growth override and applies each candidate', async () => {
    const { service, intentExamplesService } = build({
      candidates: [
        { ...PENDING_EXAMPLE, id: 'a', needsReview: false },
        { ...PENDING_EXAMPLE, id: 'b', needsReview: false },
      ],
    });

    const result = await service.batch(
      {
        ids: ['a', 'b'],
        action: 'approve',
        confirm: true,
        allowDomainGrowth: true,
      } as any,
      'admin-1',
    );

    expect(result.applied).toBe(2);
    expect(intentExamplesService.appendCandidateExample).toHaveBeenCalledTimes(
      2,
    );
  });
});
