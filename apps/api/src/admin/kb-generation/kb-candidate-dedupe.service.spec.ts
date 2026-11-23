import { KbCandidateDedupeService } from './kb-candidate-dedupe.service';

type QueryHandler = (
  sql: string,
  ...params: unknown[]
) => Array<Record<string, unknown>>;

function buildService(
  handler: QueryHandler,
  embedding: number[] | null = [0.1, 0.2],
) {
  const prisma = {
    $queryRawUnsafe: jest.fn(async (sql: string, ...params: unknown[]) =>
      handler(sql, ...params),
    ),
  } as any;
  const aiService = {
    generateEmbedding: jest.fn(async () => embedding),
  } as any;

  return {
    service: new KbCandidateDedupeService(prisma, aiService),
    prisma,
    aiService,
  };
}

describe('KbCandidateDedupeService.dedupeIntentExamples', () => {
  it('drops duplicates inside the batch before touching the database', async () => {
    const { service, prisma } = buildService(() => []);
    const result = await service.dedupeIntentExamples('rag', [
      'how do I withdraw?',
      'How   do I withdraw?',
    ]);

    expect(result.kept).toHaveLength(1);
    expect(result.reasons.duplicate_in_batch).toBe(1);
    // 只有第一次需要查库
    expect(prisma.$queryRawUnsafe).toHaveBeenCalledTimes(3);
  });

  it('drops text that already exists in intent_examples', async () => {
    const { service } = buildService((sql) =>
      sql.includes('FROM intent_examples') ? [{ hit: 1 }] : [],
    );

    const result = await service.dedupeIntentExamples('rag', [
      'how do I withdraw?',
    ]);

    expect(result.kept).toHaveLength(0);
    expect(result.reasons.exists_in_intent_examples).toBe(1);
  });

  it('drops text already waiting in the candidate inbox', async () => {
    const { service } = buildService((sql) =>
      sql.includes('kb_generation_candidates') ? [{ hit: 1 }] : [],
    );

    const result = await service.dedupeIntentExamples('rag', [
      'how do I withdraw?',
    ]);

    expect(result.reasons.exists_in_pending_candidates).toBe(1);
  });

  it('drops semantic duplicates at or above 0.92 and keeps the score otherwise', async () => {
    let call = 0;
    const { service } = buildService((sql) => {
      if (!sql.includes('1 - (embedding <=>')) return [];
      call += 1;
      return [{ similarity: call === 1 ? 0.93 : 0.8 }];
    });

    const result = await service.dedupeIntentExamples('rag', [
      'how do I withdraw?',
      'what is the withdrawal fee?',
    ]);

    expect(result.kept).toHaveLength(1);
    expect(result.kept[0].nearestScore).toBeCloseTo(0.8);
    expect(result.reasons.semantic_duplicate).toBe(1);
  });

  it('keeps the candidate when embedding is unavailable', async () => {
    const { service, aiService } = buildService(() => [], null);
    const result = await service.dedupeIntentExamples('rag', [
      'how do I withdraw?',
    ]);

    expect(result.kept).toHaveLength(1);
    expect(aiService.generateEmbedding).toHaveBeenCalled();
  });
});

describe('KbCandidateDedupeService.dedupeGoldenQueries', () => {
  it('drops golden queries already stored for the document', async () => {
    const { service } = buildService((sql) =>
      sql.includes('kb_synthetic_golden') ? [{ hit: 1 }] : [],
    );

    const result = await service.dedupeGoldenQueries('doc-1', [
      { query: 'how long is withdrawal?', lang: 'en' },
    ]);

    expect(result.kept).toHaveLength(0);
    expect(result.reasons.exists_in_synthetic_golden).toBe(1);
  });

  it('keeps unique golden queries with their normalized hash', async () => {
    const { service } = buildService(() => []);
    const result = await service.dedupeGoldenQueries('doc-1', [
      { query: 'how long is withdrawal?', lang: 'en' },
      { query: 'How long is withdrawal?', lang: 'en' },
    ]);

    expect(result.kept).toHaveLength(1);
    expect(result.kept[0].normalizedHash).toHaveLength(64);
    expect(result.reasons.duplicate_in_batch).toBe(1);
  });
});
