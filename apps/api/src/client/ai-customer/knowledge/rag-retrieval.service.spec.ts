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
    expect(results.map((r) => r.chunkId)).toEqual(['high', 'low']);
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

    // 所有占位符编号恰好覆盖 1..params.length，且升序出现
    expect(placeholderRefs(sql)).toEqual([1, 2, 3]);
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

    expect(placeholderRefs(sql)).toEqual([1, 2, 3]);
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
