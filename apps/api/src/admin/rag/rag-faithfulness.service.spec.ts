import {
  JUDGE_PROMPT_VERSION,
  RagFaithfulnessService,
  parseJudgeOutput,
} from './rag-faithfulness.service';

jest.mock('meilisearch', () => ({ Meilisearch: class {} }));
jest.mock('p-limit', () => ({
  __esModule: true,
  default:
    () =>
    <T>(fn: () => Promise<T>) =>
      fn(),
}));

describe('parseJudgeOutput', () => {
  it('解析合法 JSON 输出', () => {
    const result = parseJudgeOutput(
      '{"faithful": true, "score": 0.9, "unsupportedClaims": [], "reason": "supported"}',
    );

    expect(result).toEqual({
      faithful: true,
      score: 0.9,
      unsupportedClaims: [],
      reason: 'supported',
    });
  });

  it('容忍 markdown code fence', () => {
    const result = parseJudgeOutput(
      '```json\n{"faithful": false, "score": 0.2, "unsupportedClaims": ["5 days"], "reason": "invented"}\n```',
    );

    expect(result?.faithful).toBe(false);
    expect(result?.score).toBe(0.2);
    expect(result?.unsupportedClaims).toEqual(['5 days']);
  });

  it('非法输出返回 null', () => {
    expect(parseJudgeOutput('not json')).toBeNull();
    expect(parseJudgeOutput('{"score": 0.5}')).toBeNull();
  });

  it('score 会被夹到 0..1', () => {
    expect(
      parseJudgeOutput('{"faithful": true, "score": 1.5, "reason": ""}')?.score,
    ).toBe(1);
    expect(
      parseJudgeOutput('{"faithful": false, "score": -1, "reason": ""}')?.score,
    ).toBe(0);
  });
});

describe('RagFaithfulnessService', () => {
  function makeService({
    spec,
    chunks = {},
    invoke,
  }: {
    spec?: string;
    chunks?: Record<string, Array<Record<string, unknown>>>;
    invoke?: jest.Mock;
  } = {}) {
    const config = {
      get: jest.fn((key: string, fallback?: unknown) =>
        key === 'EVAL_JUDGE_SPEC' ? spec : fallback,
      ),
    };
    const rag = {
      getChunksByDocId: jest.fn(async (docId: string) => chunks[docId] ?? []),
    };
    const service = new RagFaithfulnessService(config as any, rag as any);
    const chainInvoke =
      invoke ??
      jest.fn(async () => '{"faithful": true, "score": 1, "reason": "ok"}');
    (service as any).chain = { invoke: chainInvoke };
    return { service, rag, chainInvoke, config };
  }

  const chunk = (docId: string, content: string) => ({
    docId,
    title: docId,
    content,
  });

  it('没有 golden 时按 citedDocIds 由服务端取 chunk', async () => {
    const { service, rag, chainInvoke } = makeService({
      chunks: { 'refund-policy': [chunk('refund-policy', '退款 1-3 天')] },
    });

    const result = await service.judge({
      question: '退款多久到账？',
      answer: '1-3 天',
      citedDocIds: ['refund-policy'],
    });

    expect(rag.getChunksByDocId).toHaveBeenCalledWith('refund-policy');
    expect(chainInvoke).toHaveBeenCalledTimes(1);
    expect(result.faithful).toBe(true);
    expect(result.judgeSpecVersion).toBe('v2');
    expect(result.judgePromptVersion).toBe(JUDGE_PROMPT_VERSION);
    expect(result.judgeInputHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('expected 与 cited 合并去重，golden 文档优先', async () => {
    const { service, rag } = makeService({
      chunks: {
        golden: [chunk('golden', 'golden text')],
        cited: [chunk('cited', 'cited text')],
      },
    });

    await service.judge({
      question: 'q',
      answer: 'a',
      expectedDocIds: ['golden'],
      citedDocIds: ['golden', 'cited'],
    });

    expect(
      rag.getChunksByDocId.mock.calls.map((call: unknown[]) => call[0]),
    ).toEqual(['golden', 'cited']);
  });

  it('没有任何来源：返回 not_applicable，不调用判官', async () => {
    const { service, chainInvoke } = makeService();

    const result = await service.judge({
      question: 'q',
      answer: 'a',
    });

    expect(chainInvoke).not.toHaveBeenCalled();
    expect(result.faithful).toBeNull();
    expect(result.score).toBeNull();
    expect(result.errorKind).toBe('not_applicable');
    expect(result.judgeSpecVersion).toBe('v2');
  });

  it('判官输出无法解析：faithful null + output_format，不算回答错误', async () => {
    const { service } = makeService({
      chunks: { d: [chunk('d', 'c')] },
      invoke: jest.fn(async () => 'not json'),
    });

    const result = await service.judge({
      question: 'q',
      answer: 'a',
      sources: [{ docId: 'd', content: 'c' }],
    });

    expect(result.faithful).toBeNull();
    expect(result.score).toBeNull();
    expect(result.errorKind).toBe('output_format');
  });

  it('判官调用失败：按错误类型归档', async () => {
    const { service } = makeService({
      chunks: { d: [chunk('d', 'c')] },
      invoke: jest.fn(async () => {
        throw new Error('judge timed out after 30s');
      }),
    });

    const result = await service.judge({
      question: 'q',
      answer: 'a',
      sources: [{ docId: 'd', content: 'c' }],
    });

    expect(result.faithful).toBeNull();
    expect(result.errorKind).toBe('timeout');
    expect(result.judgeInputHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('EVAL_JUDGE_SPEC=v1 时走旧口径并标注版本', async () => {
    const { service } = makeService({
      spec: 'v1',
      chunks: { d: [chunk('d', 'c')] },
    });

    const result = await service.judge({
      question: 'q',
      answer: 'a',
      sources: [{ docId: 'd', content: 'c' }],
    });

    expect(result.judgeSpecVersion).toBe('v1');
    expect(result.judgePromptVersion).toBe(JUDGE_PROMPT_VERSION);
    expect(result.faithful).toBe(true);
  });
});
