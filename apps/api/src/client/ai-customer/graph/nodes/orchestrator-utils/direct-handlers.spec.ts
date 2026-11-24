import { HumanMessage } from '@langchain/core/messages';
import { handleRagQuery, retrieveKnowledge, toRagCitations } from './direct-handlers';

// 合成/生成阶段的模型调用：必须包成 Runnable，pipe 才会真正走 invoke。
const invokeMock = jest.fn(async () => ({ content: '答案：5-8 个工作日。' }));
jest.mock('@api/client/ai-customer/graph/llm-factory', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { RunnableLambda } = require('@langchain/core/runnables');
  return { createLLM: jest.fn(() => RunnableLambda.from(invokeMock)) };
});

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

const chunk = {
  chunkId: 'chunk-1',
  chunkIndex: 0,
  content: 'Delivery takes 5-8 business days.',
  documentId: 'doc-1',
  title: 'Shipping Policy',
  domain: 'order',
  docId: 'shipping-policy',
  keywords: ['shipping'],
  priority: 'P0',
  contentType: 'policy',
  score: 0.9,
};

describe('retrieveKnowledge · 双语检索', () => {
  beforeEach(() => jest.clearAllMocks());

  it('改写成功 → 原问句 + 英文变体一起检索', async () => {
    const ragService = { retrieve: jest.fn(async () => [chunk]) };
    const rewriteService = { rewrite: jest.fn(async () => 'shipping time') };

    const results = await retrieveKnowledge(
      '多久发货',
      ragService as any,
      rewriteService as any,
    );

    expect(ragService.retrieve).toHaveBeenCalledWith('多久发货', {
      topK: 3,
      queryVariants: ['shipping time'],
    });
    expect(results).toEqual([chunk]);
  });

  it('改写失败 → 只用原问句，不阻塞检索', async () => {
    const ragService = { retrieve: jest.fn(async () => [chunk]) };
    const rewriteService = {
      rewrite: jest.fn(async () => {
        throw new Error('model timeout');
      }),
    };

    await retrieveKnowledge('多久发货', ragService as any, rewriteService as any);

    expect(ragService.retrieve).toHaveBeenCalledWith('多久发货', {
      topK: 3,
      queryVariants: undefined,
    });
  });

  it('没有改写服务 → 只用原问句', async () => {
    const ragService = { retrieve: jest.fn(async () => [chunk]) };

    await retrieveKnowledge('多久发货', ragService as any);

    expect(ragService.retrieve).toHaveBeenCalledWith('多久发货', {
      topK: 3,
      queryVariants: undefined,
    });
  });
});

describe('handleRagQuery · 预取结果复用', () => {
  beforeEach(() => jest.clearAllMocks());

  const state = (text: string) =>
    ({ messages: [new HumanMessage(text)], userMemory: '' }) as any;

  it('传入预取结果时不再检索一次', async () => {
    const ragService = { retrieve: jest.fn() };

    const result = await handleRagQuery(state('退款多久到账'), {} as any, ragService as any, null, {
      prefetchedResults: [chunk],
    });

    expect(ragService.retrieve).not.toHaveBeenCalled();
    expect(result.ragSources?.map((s: any) => s.docId)).toEqual(['shipping-policy']);
  });

  it('改写失败不影响用户可见回答', async () => {
    const ragService = { retrieve: jest.fn(async () => [chunk]) };
    const rewriteOk = { rewrite: jest.fn(async () => 'shipping time') };
    const rewriteFails = { rewrite: jest.fn(async () => null) };

    const withRewrite = await handleRagQuery(
      state('退款多久到账'),
      {} as any,
      ragService as any,
      null,
      { queryRewriteService: rewriteOk as any },
    );
    const withoutRewrite = await handleRagQuery(
      state('退款多久到账'),
      {} as any,
      ragService as any,
      null,
      { queryRewriteService: rewriteFails as any },
    );

    const lastContent = (r: any) => r.messages[r.messages.length - 1].content;
    expect(lastContent(withRewrite)).toBe(lastContent(withoutRewrite));
  });
});
