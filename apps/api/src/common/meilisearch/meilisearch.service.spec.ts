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
