jest.mock('meilisearch', () => ({ Meilisearch: class {} }));
jest.mock(
  '@api/client/ai-customer/graph/config/intent-domain-registry',
  () => ({
    getIntentDomains: jest.fn(),
  }),
);

import { NotFoundException } from '@nestjs/common';
import { IntentExamplesService } from './intent-examples.service';

const { getIntentDomains } = jest.requireMock(
  '@api/client/ai-customer/graph/config/intent-domain-registry',
) as { getIntentDomains: jest.Mock };

function build(
  options: {
    domains?: { label: string; type?: string }[];
    existingSentences?: string[];
    config?: Record<string, any> | null;
  } = {},
) {
  const prisma = {
    $queryRawUnsafe: jest.fn(async (sql: string) => {
      if (sql.includes('SELECT COUNT(*)')) {
        return [{ cnt: options.existingSentences?.length ?? 0 }];
      }
      return (options.existingSentences ?? []).map((sentence) => ({
        sentence,
      }));
    }),
    $executeRawUnsafe: jest.fn(async () => 1),
    intentExampleConfig: {
      findUnique: jest.fn(async () => options.config ?? null),
      create: jest.fn(async () => ({})),
      update: jest.fn(async () => ({})),
      upsert: jest.fn(async () => ({})),
    },
  } as any;

  const meilisearchService = {
    indexIntentExamples: jest.fn(async () => ({})),
  } as any;

  const embeddingQueue = {
    add: jest.fn(async () => ({ id: 'job-1' })),
  } as any;

  const service = new IntentExamplesService(
    prisma,
    {} as any,
    meilisearchService,
    { get: jest.fn(() => 'local') } as any,
    embeddingQueue,
  );

  return { service, prisma, meilisearchService, embeddingQueue };
}

beforeEach(() => {
  getIntentDomains.mockReset();
  getIntentDomains.mockResolvedValue([{ label: 'rag', type: 'general' }]);
});

describe('IntentExamplesService.appendCandidateExample', () => {
  it('creates a config row when the domain has no admin override', async () => {
    const { service, prisma, embeddingQueue } = build({
      existingSentences: ['existing question'],
      config: null,
    });

    await service.appendCandidateExample(
      'rag',
      'how long do refunds take?',
      { id: 'cand-1', locale: 'en', normalizedHash: 'h1' },
      'admin-1',
    );

    // 双写：运行表通过 embedding job 写入；配置层必须同时有行，
    // 否则 reindexDomain 会用 TS 种子覆盖掉候选。
    expect(prisma.intentExampleConfig.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        domain: 'rag',
        updatedBy: 'admin-1',
      }),
    });
    const created = prisma.intentExampleConfig.create.mock.calls[0][0].data;
    expect(JSON.parse(created.sentences).flat).toEqual([
      'existing question',
      'how long do refunds take?',
    ]);

    expect(embeddingQueue.add).toHaveBeenCalledWith(
      'embed-sentence',
      expect.objectContaining({
        domain: 'rag',
        sentence: 'how long do refunds take?',
        source: 'KB_CANDIDATE',
        candidateId: 'cand-1',
        locale: 'en',
        normalizedHash: 'h1',
      }),
      expect.any(Object),
    );
  });

  it('merges into the existing config sections', async () => {
    const { service, prisma } = build({
      existingSentences: ['existing question'],
      config: {
        domain: 'rag',
        sentences: JSON.stringify({
          flat: ['existing question'],
          sections: [{ section: 'General', sentences: ['existing question'] }],
        }),
      },
    });

    await service.appendCandidateExample('rag', 'where is my parcel?', {
      id: 'cand-2',
    });

    expect(prisma.intentExampleConfig.update).toHaveBeenCalled();
    const updateArgs = prisma.intentExampleConfig.update.mock.calls[0][0];
    expect(updateArgs.where).toEqual({ domain: 'rag' });
    const parsed = JSON.parse(updateArgs.data.sentences);
    expect(parsed.flat).toContain('where is my parcel?');
    expect(parsed.flat).toContain('existing question');
  });

  it('refreshes the BM25 index with the union of old and new sentences', async () => {
    const { service, meilisearchService } = build({
      existingSentences: ['existing question'],
    });

    await service.appendCandidateExample('rag', 'how long do refunds take?', {
      id: 'cand-3',
    });

    expect(meilisearchService.indexIntentExamples).toHaveBeenCalledWith('rag', [
      'existing question',
      'how long do refunds take?',
    ]);
  });

  it('skips duplicates without touching config or queue', async () => {
    const { service, prisma, embeddingQueue } = build({
      existingSentences: ['how long do refunds take?'],
    });

    const result = await service.appendCandidateExample(
      'rag',
      'how long do refunds take?',
      { id: 'cand-4' },
    );

    expect(result.count).toBe(0);
    expect(prisma.intentExampleConfig.create).not.toHaveBeenCalled();
    expect(prisma.intentExampleConfig.update).not.toHaveBeenCalled();
    expect(embeddingQueue.add).not.toHaveBeenCalled();
  });

  it('rejects an unregistered domain', async () => {
    getIntentDomains.mockResolvedValue([{ label: 'order', type: 'business' }]);
    const { service } = build();

    await expect(
      service.appendCandidateExample('rag', 'hello?', { id: 'cand-5' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('IntentExamplesService.reindexDomain', () => {
  it('re-embeds every sentence in the config, including approved candidates', async () => {
    const { service, embeddingQueue } = build({
      config: {
        domain: 'rag',
        sentences: JSON.stringify({
          flat: ['existing question', 'approved candidate question'],
          sections: [
            {
              section: 'General',
              sentences: ['existing question', 'approved candidate question'],
            },
          ],
        }),
      },
    });

    await service.reindexDomain('rag');

    const submitted = embeddingQueue.add.mock.calls.map(
      (call: any[]) => call[1].sentence,
    );
    expect(submitted).toEqual([
      'existing question',
      'approved candidate question',
    ]);
    // reindex 不携带候选溯源：它是全量重建，不是一次候选应用。
    expect(embeddingQueue.add.mock.calls[0][1].candidateId).toBeUndefined();
  });
});
