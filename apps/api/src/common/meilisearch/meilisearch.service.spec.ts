// meilisearch 是 ESM 包，jest 默认不转译 node_modules。这里只测本服务的逻辑，
// 用 class 占位替掉真实客户端，避免 import 阶段就炸。
jest.mock('meilisearch', () => ({ Meilisearch: class {} }));

import { MeilisearchService } from './meilisearch.service';

/**
 * 缺陷 B：知识库更新时 PG 的 chunk 被删了，但 Meili 里旧版本的条目没人删。
 * 结果是 BM25 层永远能命中旧内容——文档改得越多，旧内容堆得越厚。
 *
 * deleteChunksByDocument 是唯一出口：按 documentId 一次性删掉该文档在
 * Meili 的全部条目，不依赖 PG 里还查不查得到旧 chunk id。
 */
describe('MeilisearchService.deleteChunksByDocument（缺陷 B）', () => {
  /** 用 mock 替代 ConfigService 与私有 client，不启 Nest 容器 */
  const makeService = (client: any) => {
    const service = new MeilisearchService({
      get: jest.fn().mockReturnValue(undefined),
    } as any);
    (service as any).client = client;
    return service;
  };

  it('按 documentId 过滤删除该文档在 Meili 的全部 chunk', async () => {
    const deleteDocuments = jest.fn().mockResolvedValue({ taskUid: 1 });
    const service = makeService({ index: () => ({ deleteDocuments }) });

    await service.deleteChunksByDocument('doc_1');

    expect(deleteDocuments).toHaveBeenCalledWith({
      filter: 'documentId = "doc_1"',
    });
  });

  it('Meili 删除失败时抛错，不静默留孤儿', async () => {
    const deleteDocuments = jest
      .fn()
      .mockRejectedValue(new Error('meili down'));
    const service = makeService({ index: () => ({ deleteDocuments }) });

    await expect(service.deleteChunksByDocument('doc_1')).rejects.toThrow(
      'meili down',
    );
  });

  it('client 不可用（本地未部署 Meili）时直接返回，不阻断调用方', async () => {
    const service = makeService(null);

    await expect(
      service.deleteChunksByDocument('doc_1'),
    ).resolves.toBeUndefined();
  });
});

/**
 * 缺陷 A：indexChunk 的 catch 只打 warn 不抛，失败也照样 successCount++，
 * 于是 processStatus 被标成 indexed——但 Meili 里根本没这条内容。
 *
 * 另外 addDocuments 返回的是 taskUid，Meilisearch 异步建索引，
 * 提交成功 ≠ 已经能被搜到。要真就绪必须 waitForTask。
 */
describe('MeilisearchService.indexChunk（缺陷 A）', () => {
  const makeService = (client: any) => {
    const service = new MeilisearchService({
      get: jest.fn().mockReturnValue(undefined),
    } as any);
    (service as any).client = client;
    return service;
  };

  const chunkData = () => ({
    chunkId: 'chunk_1',
    chunkIndex: 0,
    content: '退款 5 个工作日到账',
    documentId: 'doc_1',
    title: '退款政策',
    domain: 'wallet',
    docId: 'refund-policy',
    keywords: ['refund'],
    priority: 'P0',
    contentType: 'policy',
    locale: 'zh',
    isActive: true,
  });

  it('client 不可用时抛错，不能假装索引成功', async () => {
    const service = makeService(null);

    // 静默返回会让 embedSingleChunk 记 successCount++，文档被标 indexed，
    // 而 Meili 里什么都没有——门就撒谎了。
    await expect(service.indexChunk(chunkData())).rejects.toThrow();
  });

  it('索引失败时抛错，交给上层记失败（不能只 warn）', async () => {
    const addDocuments = jest.fn().mockRejectedValue(new Error('meili down'));
    const service = makeService({ index: () => ({ addDocuments }) });

    await expect(service.indexChunk(chunkData())).rejects.toThrow('meili down');
  });

  it('写入版本字段：documentVersion 与 isActiveVersion 必须进索引体', async () => {
    const addDocuments = jest.fn().mockResolvedValue({ taskUid: 7 });
    const service = makeService({
      index: () => ({ addDocuments }),
      tasks: { waitForTask: jest.fn().mockResolvedValue({}) },
    });

    await service.indexChunk({
      ...chunkData(),
      documentVersion: 3,
      isActiveVersion: false,
    });

    const [doc] = addDocuments.mock.calls[0][0];
    expect(doc.documentVersion).toBe(3);
    expect(doc.isActiveVersion).toBe(false);
  });

  it('缺省 isActiveVersion = true，保证老调用点写入的条目仍可被检索', async () => {
    const addDocuments = jest.fn().mockResolvedValue({ taskUid: 8 });
    const service = makeService({
      index: () => ({ addDocuments }),
      tasks: { waitForTask: jest.fn().mockResolvedValue({}) },
    });

    await service.indexChunk(chunkData());

    const [doc] = addDocuments.mock.calls[0][0];
    expect(doc.isActiveVersion).toBe(true);
  });

  it('searchChunks 只返回当前对外版本的条目（Task 5）', async () => {
    const search = jest.fn().mockResolvedValue({ hits: [] });
    const service = makeService({ index: () => ({ search }) });

    await service.searchChunks('退款多久到账');

    expect(search.mock.calls[0][1].filter).toEqual(['isActiveVersion = true']);
  });

  it('searchChunks 带 domain 时版本条件与域条件同时生效', async () => {
    const search = jest.fn().mockResolvedValue({ hits: [] });
    const service = makeService({ index: () => ({ search }) });

    await service.searchChunks('退款多久到账', 'wallet');

    expect(search.mock.calls[0][1].filter).toEqual([
      'isActiveVersion = true',
      'domain = "wallet"',
    ]);
  });

  it('searchChunks 在 keywords 里也搜索（中文 query 能命中英文正文）', async () => {
    const search = jest.fn().mockResolvedValue({ hits: [] });
    const service = makeService({ index: () => ({ search }) });

    await service.searchChunks('退货运费谁出');

    expect(search.mock.calls[0][1].attributesToSearchOn).toEqual([
      'content',
      'title',
      'keywords',
    ]);
  });

  it('提交后等索引任务真正完成才返回', async () => {
    const addDocuments = jest.fn().mockResolvedValue({ taskUid: 42 });
    // waitForTask 在 client.tasks 上，不在 index 上（meilisearch@0.59）
    const waitForTask = jest.fn().mockResolvedValue({});
    const service = makeService({
      index: () => ({ addDocuments }),
      tasks: { waitForTask },
    });

    await service.indexChunk(chunkData());

    expect(waitForTask).toHaveBeenCalledWith(42);
  });
});

describe('MeilisearchService.indexIntentExamples（删除必须按 id）', () => {
  const makeService = (index: any) => {
    const service = new MeilisearchService({
      get: jest.fn().mockReturnValue(undefined),
    } as any);
    (service as any).client = { index: () => index };
    return service;
  };

  it('按 domain_i 批量删除旧文档，再写入新文档', async () => {
    const deleteDocuments = jest.fn().mockResolvedValue({ taskUid: 1 });
    const addDocuments = jest.fn().mockResolvedValue({ taskUid: 2 });
    const service = makeService({ deleteDocuments, addDocuments });

    await service.indexIntentExamples('order', ['订单状态', '查物流']);

    // 关键：不能依赖 filterable attribute；必须按固定 id 删除，
    // 否则已删除的句子会留在索引里被 BM25 继续命中
    const ids = deleteDocuments.mock.calls[0][0] as string[];
    expect(ids).toHaveLength(200);
    expect(ids[0]).toBe('order_0');
    expect(ids[199]).toBe('order_199');

    expect(addDocuments).toHaveBeenCalledWith([
      { id: 'order_0', domain: 'order', text: '订单状态' },
      { id: 'order_1', domain: 'order', text: '查物流' },
    ]);
  });

  it('空列表只删除、不写入', async () => {
    const deleteDocuments = jest.fn().mockResolvedValue({ taskUid: 1 });
    const addDocuments = jest.fn().mockResolvedValue({ taskUid: 2 });
    const service = makeService({ deleteDocuments, addDocuments });

    await service.indexIntentExamples('order', []);

    expect(deleteDocuments).toHaveBeenCalled();
    expect(addDocuments).not.toHaveBeenCalled();
  });
});
