// 依赖链会加载 meilisearch（ESM 包），先占位替掉。
jest.mock('meilisearch', () => ({ Meilisearch: class {} }));

import { RagRetrievalService } from './rag-retrieval.service';

/**
 * Task 5：检索必须只看「当前对外版本」。
 *
 * 更新文档后新旧版本 chunk 并存（Task 4），如果检索不加版本过滤，
 * 用户会同时命中新旧两份内容——这正是"更新期间用户看到旧规则"的根因。
 */
describe('RagRetrievalService 版本过滤（Task 5）', () => {
  const build = () => {
    const prisma = {
      $queryRawUnsafe: jest.fn().mockResolvedValue([]),
      knowledgeDocument: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const aiService = {
      generateEmbedding: jest.fn().mockResolvedValue([0.1, 0.2]),
    };
    const meilisearchService = {
      searchChunks: jest.fn().mockResolvedValue([]),
      isAvailable: true,
    };
    const configService = { get: jest.fn().mockReturnValue(undefined) };

    const service = new RagRetrievalService(
      prisma as any,
      aiService as any,
      meilisearchService as any,
      configService as any,
    );

    return { service, prisma };
  };

  it('向量层只查 activeVersion 那一版（同文档新旧并存时不会命中旧版）', async () => {
    const { service, prisma } = build();

    await (service as any).vectorSearch('退款多久到账', undefined, 5);

    const [sql] = prisma.$queryRawUnsafe.mock.calls[0];
    expect(sql).toContain('dc.document_version = kd.active_version');
  });

  it('chunk 关键字层同样按 activeVersion 过滤', async () => {
    const { service, prisma } = build();

    await (service as any).keywordSearchChunks(['退款'], undefined, 5);

    const [sql] = prisma.$queryRawUnsafe.mock.calls[0];
    expect(sql).toContain('dc.document_version = kd.active_version');
  });

  it('整文档兜底层跳过「正在暂存新版本」的文档', async () => {
    const { service, prisma } = build();
    prisma.knowledgeDocument.findMany.mockResolvedValue([
      // 已切换：activeVersion === version → 可参与
      {
        id: 'd1',
        version: 3,
        activeVersion: 3,
        title: '退款政策',
        content: '退款 5 个工作日到账',
        keywords: ['退款'],
        priority: 'P0',
        domain: 'wallet',
        docId: 'refund',
        language: 'zh',
      },
      // 暂存中：新版本还没过门 → 不能返回（否则提前泄漏新版内容）
      // 内容同样命中「退款」，唯一的区分点是 activeVersion !== version
      {
        id: 'd2',
        version: 4,
        activeVersion: 3,
        title: '退款政策（新版，尚未上线）',
        content: '退款 3 个工作日到账',
        keywords: ['退款'],
        priority: 'P0',
        domain: 'wallet',
        docId: 'refund',
        language: 'zh',
      },
    ]);

    const results = await (service as any).keywordSearchDocs(
      '退款',
      ['退款'],
      undefined,
      5,
    );

    const ids = results.map((r: any) => r.documentId);
    expect(ids).toContain('d1');
    expect(ids).not.toContain('d2');
  });
});

describe('RagRetrievalService rerank 开关', () => {
  const chunk = (id: string, score: number) => ({
    chunkId: id,
    chunkIndex: 0,
    content: `content-${id}`,
    documentId: `doc-${id}`,
    title: `title-${id}`,
    domain: 'order',
    docId: `doc-${id}`,
    keywords: [],
    priority: 'P0',
    contentType: 'policy',
    score,
  });

  const build = () => {
    const prisma = {
      $queryRawUnsafe: jest.fn().mockResolvedValue([]),
      knowledgeDocument: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const aiService = {
      generateEmbedding: jest.fn().mockResolvedValue([0.1, 0.2]),
      rerank: jest.fn().mockResolvedValue([]),
    };
    const meilisearchService = {
      searchChunks: jest.fn().mockResolvedValue([]),
      isAvailable: true,
    };
    const service = new RagRetrievalService(
      prisma as any,
      aiService as any,
      meilisearchService as any,
      { get: jest.fn().mockReturnValue(undefined) } as any,
    );
    const chunks = [chunk('low', 0.2), chunk('high', 0.9)];
    jest.spyOn(service as any, 'vectorSearch').mockResolvedValue(chunks);
    return { service, aiService, chunks };
  };

  it('useRerank=false 时不调用 reranker，按原始分降序', async () => {
    const { service, aiService } = build();

    const results = await service.retrieve('退款', {
      topK: 2,
      useRerank: false,
    });

    expect(aiService.rerank).not.toHaveBeenCalled();
    expect(results.map((r) => r.chunkId)).toEqual(['high', 'low']);
  });

  it('默认启用 reranker，并用 relevance_score 覆盖原始分', async () => {
    const { service, aiService, chunks } = build();
    aiService.rerank.mockResolvedValue([
      { index: 0, relevance_score: 0.1 },
      { index: 1, relevance_score: 0.99 },
    ]);

    const results = await service.retrieve('退款', { topK: 2 });

    expect(aiService.rerank).toHaveBeenCalledTimes(1);
    // 没有关键词命中，0.1 低于默认门卫阈值 0.131 → 被拒；只保留 high
    expect(results.map((r) => r.chunkId)).toEqual(['high']);
    expect(results[0].score).toBe(0.99);
    expect(chunks).toHaveLength(2);
  });
});

/**
 * 回归：Layer 2（keywordSearchChunks）的 SQL 占位符必须从 $1 开始，
 * 且与 params 数组一一对应。曾经用 `$i + 2` 生成条件，首个占位符变成 $2，
 * 而 params 从 $1 开始，最终 PostgreSQL 报参数不匹配，被 catch 吞掉返回 []，
 * 导致 Layer 2 永久失效。
 */
describe('RagRetrievalService Layer 2 SQL 参数绑定回归', () => {
  const build = () => {
    const prisma = {
      $queryRawUnsafe: jest.fn().mockResolvedValue([]),
      knowledgeDocument: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const aiService = {
      generateEmbedding: jest.fn().mockResolvedValue([0.1, 0.2]),
    };
    const meilisearchService = {
      searchChunks: jest.fn().mockResolvedValue([]),
      isAvailable: true,
    };
    const configService = { get: jest.fn().mockReturnValue(undefined) };

    const service = new RagRetrievalService(
      prisma as any,
      aiService as any,
      meilisearchService as any,
      configService as any,
    );

    return { service, prisma };
  };

  /** 按出现顺序取出 SQL 中的 $n 占位符编号 */
  const placeholderRefs = (sql: string): number[] =>
    Array.from(sql.matchAll(/\$(\d+)/g), (m) => Number(m[1]));

  it('无 domain：占位符 $1..$N 与 params 顺序一致', async () => {
    const { service, prisma } = build();

    await (service as any).keywordSearchChunks(['退款', '到账'], undefined, 5);

    const [sql, ...params] = prisma.$queryRawUnsafe.mock.calls[0];

    // params 顺序：token 模式 → LIMIT topK
    expect(params).toEqual(['%退款%', '%到账%', 5]);

    // 条件从 $1 开始，domain 不存在，LIMIT 顺延到 $3
    expect(sql).toContain('dc.content ILIKE $1::varchar');
    expect(sql).toContain('dc.content ILIKE $2::varchar');
    expect(sql).toContain('LIMIT $3::smallint');

    // 同一个 token 会在条件与排序表达式里各引用一次；
    // 去重后必须恰好覆盖 1..params.length，且整体升序
    const refs = placeholderRefs(sql);
    expect([...new Set(refs)]).toEqual([1, 2, 3]);
    expect(refs.every((n) => n >= 1 && n <= params.length)).toBe(true);
  });

  it('有 domain：$N+1 归 domain，LIMIT 再顺延', async () => {
    const { service, prisma } = build();

    await (service as any).keywordSearchChunks(['退款'], 'wallet', 3);

    const [sql, ...params] = prisma.$queryRawUnsafe.mock.calls[0];

    // params 顺序：token 模式 → domain → LIMIT topK
    expect(params).toEqual(['%退款%', 'wallet', 3]);

    expect(sql).toContain('dc.content ILIKE $1::varchar');
    expect(sql).toContain('kd.domain = $2::varchar');
    expect(sql).toContain('LIMIT $3::smallint');

    const refs = placeholderRefs(sql);
    expect([...new Set(refs)]).toEqual([1, 2, 3]);
    expect(refs.every((n) => n >= 1 && n <= params.length)).toBe(true);
  });

  it('同时匹配正文与 keywords，并按命中数排序', async () => {
    const { service, prisma } = build();

    await (service as any).keywordSearchChunks(['退货'], undefined, 5);

    const [sql] = prisma.$queryRawUnsafe.mock.calls[0];
    expect(sql).toContain("array_to_string(kd.keywords, ' ') ILIKE $1::varchar");
    expect(sql).toMatch(/ORDER BY \(.*\) DESC, dc\.chunk_index ASC/);
  });

  it('空 tokens：直接返回空，不执行 SQL', async () => {
    const { service, prisma } = build();

    const results = await (service as any).keywordSearchChunks([], undefined, 5);

    expect(results).toEqual([]);
    expect(prisma.$queryRawUnsafe).not.toHaveBeenCalled();
  });

  it('查询成功时返回 chunk（不再被参数错位异常吞掉）', async () => {
    const { service, prisma } = build();
    prisma.$queryRawUnsafe.mockResolvedValue([
      {
        chunk_id: 'c1',
        chunk_index: 0,
        content: '退款 5 个工作日到账',
        document_id: 'd1',
        title: '退款政策',
        domain: 'wallet',
        doc_id: 'refund',
        keywords: '{退款,到账}',
        priority: 'P0',
        content_type: 'policy',
      },
    ]);

    const results = await (service as any).keywordSearchChunks(
      ['退款'],
      'wallet',
      5,
    );

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      chunkId: 'c1',
      chunkIndex: 0,
      content: '退款 5 个工作日到账',
      documentId: 'd1',
      docId: 'refund',
      domain: 'wallet',
      keywords: ['退款', '到账'],
      score: 0.5,
    });
  });
});

/**
 * T2-3：中文分词。
 *
 * 变更前 `tokenize()` 用 `/[^\w\s]/`，JS 的 `\w` 不含 CJK，
 * 「怎么退货」会得到空数组 → Layer 2 跳过、Layer 3 恒空。
 */
describe('RagRetrievalService 中文分词', () => {
  const build = () => {
    const prisma = {
      $queryRawUnsafe: jest.fn().mockResolvedValue([]),
      knowledgeDocument: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const aiService = {
      generateEmbedding: jest.fn().mockResolvedValue([0.1, 0.2]),
    };
    const meilisearchService = {
      searchChunks: jest.fn().mockResolvedValue([]),
      isAvailable: true,
    };
    const configService = { get: jest.fn().mockReturnValue(undefined) };
    return new RagRetrievalService(
      prisma as any,
      aiService as any,
      meilisearchService as any,
      configService as any,
    );
  };

  it('纯中文：产生二元组，疑问词被过滤', () => {
    const tokens = (build() as any).tokenize('怎么退货？');
    expect(tokens.length).toBeGreaterThan(0);
    expect(tokens).toContain('退货');
    expect(tokens).not.toContain('怎么');
  });

  it('中英混排：中文二元组与 Latin 词项同时保留', () => {
    const tokens = (build() as any).tokenize('退货 refund 怎么申请');
    expect(tokens).toContain('退货');
    expect(tokens).toContain('refund');
  });

  it('纯标点 / 空输入：返回空数组', () => {
    expect((build() as any).tokenize('？！。')).toEqual([]);
    expect((build() as any).tokenize('')).toEqual([]);
  });

  it('单字中文保留，作为兜底', () => {
    expect((build() as any).tokenize('退')).toEqual(['退']);
  });

  it('纯英文词项与变更前一致（停用词、长度过滤不变）', () => {
    expect((build() as any).tokenize('Where is my refund?')).toEqual([
      'refund',
    ]);
  });

  it('去重：重复片段不会重复出现', () => {
    const tokens = (build() as any).tokenize('退货退货');
    expect(new Set(tokens).size).toBe(tokens.length);
  });

  it('上限：长输入词项数不超过 40', () => {
    const long = Array.from({ length: 80 }, (_, i) => `word${i}`).join(' ');
    const tokens = (build() as any).tokenize(long);
    expect(tokens.length).toBeLessThanOrEqual(40);
    expect(tokens.length).toBeGreaterThan(0);
  });
});

/**
 * T2-3 / 3.1：debug=true 时返回分层召回明细，默认不改变 retrieve 的返回类型。
 */
describe('RagRetrievalService 分层 debug', () => {
  const chunk = (docId: string, score: number, chunkId = `${docId}-c1`) => ({
    chunkId,
    chunkIndex: 0,
    content: `${docId} content`,
    documentId: `${docId}-d`,
    title: docId,
    domain: 'common',
    docId,
    keywords: [],
    priority: 'P0',
    contentType: 'faq',
    score,
  });

  const build = () => {
    const prisma = { $queryRawUnsafe: jest.fn(), knowledgeDocument: { findMany: jest.fn() } };
    const aiService = { generateEmbedding: jest.fn().mockResolvedValue([0.1]) };
    const meilisearchService = { searchChunks: jest.fn(), isAvailable: true };
    const configService = { get: jest.fn().mockReturnValue(undefined) };
    return new RagRetrievalService(
      prisma as any,
      aiService as any,
      meilisearchService as any,
      configService as any,
    );
  };

  it('retrieveDetailed 返回四层 docId 与 rerank 前后分数', async () => {
    const service: any = build();
    jest.spyOn(service, 'vectorSearch').mockResolvedValue([chunk('v', 0.8)]);
    jest.spyOn(service, 'keywordSearchChunks').mockResolvedValue([chunk('k', 0.5)]);
    jest.spyOn(service, 'keywordSearchDocs').mockResolvedValue([]);
    service.meilisearchService.searchChunks.mockResolvedValue([chunk('m', 0.7)]);
    service.rerank = jest.fn(async (_q: string, c: any[]) => ({
      results: c.slice(0, 2).map((x) => ({ ...x, score: 0.9 })),
      used: true,
    }));

    const { results, debug } = await service.retrieveDetailed('退货运费谁出');

    expect(results).toHaveLength(2);
    expect(debug.layers.vector.docIds).toEqual(['v']);
    expect(debug.layers.meili.docIds).toEqual(['m']);
    expect(debug.layers.chunk.docIds).toEqual(['k']);
    expect(debug.layers.doc.docIds).toEqual([]);
    expect(debug.candidates).toBe(3);
    expect(debug.returned).toBe(2);
    expect(debug.rerank).toBe(true);
    expect(debug.topScoreBeforeRerank).toBe(0.8);
  });

  it('retrieve 仍只返回数组（默认行为不变）', async () => {
    const service: any = build();
    jest.spyOn(service, 'vectorSearch').mockResolvedValue([chunk('v', 0.8)]);
    jest.spyOn(service, 'keywordSearchChunks').mockResolvedValue([]);
    jest.spyOn(service, 'keywordSearchDocs').mockResolvedValue([]);
    service.meilisearchService.searchChunks.mockResolvedValue([]);
    service.rerank = jest.fn(async (_q: string, c: any[]) => ({ results: c, used: true }));

    const results = await service.retrieve('退货');
    expect(Array.isArray(results)).toBe(true);
    expect(results[0].docId).toBe('v');
  });
});

/**
 * RRF 降级排序：reranker 不可用时，按各层排名融合，
 * 而不是把余弦/BM25/固定 0.5 混在一起比大小。
 */
describe('RagRetrievalService RRF 降级', () => {
  const chunk = (docId: string, score: number, chunkId = `${docId}-c1`) => ({
    chunkId,
    chunkIndex: 0,
    content: `${docId} content`,
    documentId: `${docId}-d`,
    title: docId,
    domain: 'common',
    docId,
    keywords: [],
    priority: 'P0',
    contentType: 'faq',
    score,
  });

  const build = () => {
    const prisma = { $queryRawUnsafe: jest.fn(), knowledgeDocument: { findMany: jest.fn() } };
    const aiService = { generateEmbedding: jest.fn().mockResolvedValue([0.1]) };
    const meilisearchService = { searchChunks: jest.fn(), isAvailable: true };
    const configService = { get: jest.fn().mockReturnValue(undefined) };
    return new RagRetrievalService(
      prisma as any,
      aiService as any,
      meilisearchService as any,
      configService as any,
    );
  };

  it('低原始分但多层命中的 chunk 排到第一', async () => {
    const service: any = build();
    const a = chunk('vector-only', 0.9);
    const b = chunk('multi-layer', 0.3);
    jest.spyOn(service, 'vectorSearch').mockResolvedValue([a]);
    service.meilisearchService.searchChunks.mockResolvedValue([b]);
    jest.spyOn(service, 'keywordSearchChunks').mockResolvedValue([b]);
    jest.spyOn(service, 'keywordSearchDocs').mockResolvedValue([]);
    service.aiService.rerank = jest.fn().mockResolvedValue(null);

    const results = await service.retrieve('退款', { topK: 5 });

    expect(results[0].docId).toBe('multi-layer');
  });

  it('reranker 可用时保留 reranker 顺序，RRF 不生效', async () => {
    const service: any = build();
    const a = chunk('vector-only', 0.9);
    const b = chunk('multi-layer', 0.3);
    jest.spyOn(service, 'vectorSearch').mockResolvedValue([a]);
    service.meilisearchService.searchChunks.mockResolvedValue([b]);
    jest.spyOn(service, 'keywordSearchChunks').mockResolvedValue([b]);
    jest.spyOn(service, 'keywordSearchDocs').mockResolvedValue([]);
    service.aiService.rerank = jest
      .fn()
      .mockResolvedValue([{ index: 0, relevance_score: 0.9 }, { index: 1, relevance_score: 0.1 }]);

    const results = await service.retrieve('退款', { topK: 5 });

    expect(results[0].docId).toBe('vector-only');
  });
});

describe('RagRetrievalService 相关性门卫', () => {
  const chunk = (docId: string, score: number) => ({
    chunkId: `${docId}-c1`,
    chunkIndex: 0,
    content: `${docId} content`,
    documentId: `${docId}-d`,
    title: docId,
    domain: 'common',
    docId,
    keywords: [],
    priority: 'P0',
    contentType: 'faq',
    score,
  });
  const build = () => {
    const prisma = { $queryRawUnsafe: jest.fn(), knowledgeDocument: { findMany: jest.fn() } };
    const aiService = {
      generateEmbedding: jest.fn().mockResolvedValue([0.1]),
      rerank: jest.fn(),
    };
    const meilisearchService = { searchChunks: jest.fn(), isAvailable: true };
    const configService = { get: jest.fn().mockReturnValue(undefined) };
    return new RagRetrievalService(
      prisma as any,
      aiService as any,
      meilisearchService as any,
      configService as any,
    );
  };

  it('无关键词命中且 rerank 分数低于阈值 → 返回空（域外问题拒答）', async () => {
    const service: any = build();
    jest.spyOn(service, 'vectorSearch').mockResolvedValue([chunk('irrelevant', 0.9)]);
    service.meilisearchService.searchChunks.mockResolvedValue([]);
    jest.spyOn(service, 'keywordSearchChunks').mockResolvedValue([]);
    jest.spyOn(service, 'keywordSearchDocs').mockResolvedValue([]);
    service.aiService.rerank.mockResolvedValue([{ index: 0, relevance_score: 0.05 }]);

    const results = await service.retrieve('今天天气怎么样', { topK: 3 });
    expect(results).toEqual([]);
  });

  it('关键词层命中 → 即使 rerank 分低也保留', async () => {
    const service: any = build();
    jest.spyOn(service, 'vectorSearch').mockResolvedValue([]);
    service.meilisearchService.searchChunks.mockResolvedValue([]);
    jest.spyOn(service, 'keywordSearchChunks').mockResolvedValue([chunk('refund', 0.5)]);
    jest.spyOn(service, 'keywordSearchDocs').mockResolvedValue([]);
    service.aiService.rerank.mockResolvedValue([{ index: 0, relevance_score: 0.01 }]);

    const results = await service.retrieve('退款', { topK: 3 });
    expect(results.map((r: any) => r.docId)).toEqual(['refund']);
  });

  it('reranker 不可用 → 不套用阈值，保留 RRF 结果', async () => {
    const service: any = build();
    jest.spyOn(service, 'vectorSearch').mockResolvedValue([chunk('v', 0.2)]);
    service.meilisearchService.searchChunks.mockResolvedValue([]);
    jest.spyOn(service, 'keywordSearchChunks').mockResolvedValue([]);
    jest.spyOn(service, 'keywordSearchDocs').mockResolvedValue([]);
    service.aiService.rerank.mockResolvedValue(null);

    const results = await service.retrieve('无关问题', { topK: 3 });
    expect(results.map((r: any) => r.docId)).toEqual(['v']);
  });
});
