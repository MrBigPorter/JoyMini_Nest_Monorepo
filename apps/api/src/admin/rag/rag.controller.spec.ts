// 只测 controller 的委托行为：把带 ESM 依赖的 service 全部替换成空类。
jest.mock('./rag.service', () => ({ RagService: class {} }));
jest.mock('./rag-sync.service', () => ({ RagSyncService: class {} }));
jest.mock('./rag-faithfulness.service', () => ({
  RagFaithfulnessService: class {},
}));
jest.mock('@api/client/ai-customer/knowledge/kb-version.service', () => ({
  KbVersionService: class {},
}));
jest.mock('@api/client/ai-customer/knowledge/rag-retrieval.service', () => ({
  RagRetrievalService: class {},
}));

import { RagController } from './rag.controller';
import { CorpusFingerprintService } from '@api/common/knowledge/corpus-fingerprint.service';

/**
 * 只覆盖语料指纹只读端点：响应必须给整体指纹、逐文档明细、待激活列表，
 * 且不能把 chunk 正文带出控制器。
 */
describe('RagController GET meta/corpus-fingerprint', () => {
  const prisma = {
    knowledgeDocument: {
      findMany: jest.fn().mockResolvedValue([
        {
          id: 'doc-uuid-1',
          docId: 'account-guide',
          locale: 'en',
          title: 'Account Guide',
          version: 2,
          activeVersion: 2,
          processStatus: 'indexed',
          documentChunks: [
            { documentVersion: 2, chunkIndex: 0, content: 'secret chunk text' },
            { documentVersion: 2, chunkIndex: 1, content: 'second chunk' },
          ],
        },
      ]),
    },
  };
  const controller = new RagController(
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    new CorpusFingerprintService(prisma as never),
  );

  it('返回整体指纹、逐文档明细与待激活列表，且不含正文', async () => {
    const result = await controller.getCorpusFingerprint();

    expect(result.fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(result.pendingActivation).toEqual([]);
    expect(result.docs).toHaveLength(1);
    expect(Object.keys(result.docs[0]).sort()).toEqual(
      [
        'activeChunkCount',
        'activeChunkHash',
        'activeVersion',
        'docId',
        'id',
        'locale',
        'title',
      ].sort(),
    );
    expect(JSON.stringify(result)).not.toContain('secret chunk text');
    expect(JSON.stringify(result)).not.toContain('second chunk');
  });
});
