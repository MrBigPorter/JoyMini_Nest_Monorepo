import { toRagCitations } from './direct-handlers';

describe('toRagCitations', () => {
  it('保留引用元数据，并截断内容预览', () => {
    const longContent = 'x'.repeat(1800);
    const citations = toRagCitations([
      {
        chunkId: 'chunk-1',
        chunkIndex: 0,
        content: longContent,
        documentId: 'doc-1',
        title: 'Refund Policy',
        domain: 'order',
        docId: 'refund-policy',
        keywords: ['refund'],
        priority: 'P0',
        contentType: 'policy',
        score: 0.91,
      },
    ]);

    expect(citations).toEqual([
      {
        chunkId: 'chunk-1',
        documentId: 'doc-1',
        docId: 'refund-policy',
        title: 'Refund Policy',
        domain: 'order',
        score: 0.91,
        content: 'x'.repeat(1500),
      },
    ]);
  });
});
