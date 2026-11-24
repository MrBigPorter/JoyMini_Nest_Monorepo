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
    repeatsEnv,
    chunks = {},
    invoke,
  }: {
    spec?: string;
    repeatsEnv?: string | number;
    chunks?: Record<string, Array<Record<string, unknown>>>;
    invoke?: jest.Mock;
  } = {}) {
    const config = {
      get: jest.fn((key: string, fallback?: unknown) => {
        if (key === 'EVAL_JUDGE_SPEC') return spec;
        if (key === 'EVAL_JUDGE_REPEATS') return repeatsEnv;
        return fallback;
      }),
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

  const source = [{ docId: 'd', content: 'c' }];

  /** 按顺序返回给定输出（字符串视为成功，Error 视为调用失败）。 */
  const invokeSequence = (...outputs: Array<string | Error>) => {
    let index = 0;
    return jest.fn(async () => {
      const next = outputs[Math.min(index, outputs.length - 1)];
      index += 1;
      if (next instanceof Error) throw next;
      return next;
    });
  };

  const faithfulJson = (faithful: boolean, reason = 'r') =>
    JSON.stringify({ faithful, score: faithful ? 1 : 0, reason });

  it('没有 golden 时按 citedDocIds 由服务端取 chunk', async () => {
    const { service, rag, chainInvoke } = makeService({
      chunks: { 'refund-policy': [chunk('refund-policy', '退款 1-3 天')] },
      repeatsEnv: 1,
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
      repeatsEnv: 1,
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
    expect(result.judgeRepeats).toBeUndefined();
  });

  it('三次判定一致：采用该结论，agreement 1', async () => {
    const { service, chainInvoke } = makeService({
      chunks: { d: [chunk('d', 'c')] },
      invoke: invokeSequence(
        faithfulJson(true),
        faithfulJson(true),
        faithfulJson(true),
      ),
    });

    const result = await service.judge({
      question: 'q',
      answer: 'a',
      sources: source,
    });

    expect(chainInvoke).toHaveBeenCalledTimes(3);
    expect(result.faithful).toBe(true);
    expect(result.judgeRepeats).toBe(3);
    expect(result.judgeAttempts).toHaveLength(3);
    expect(result.judgeSuccessfulAttempts).toBe(3);
    expect(result.judgeAgreement).toBe(1);
    expect(result.judgeDisagreement).toBe(false);
    expect(result.judgeLowAttempts).toBe(false);
  });

  it('三次判定 2:1：采用多数结论，agreement 0.67', async () => {
    const { service } = makeService({
      chunks: { d: [chunk('d', 'c')] },
      invoke: invokeSequence(
        faithfulJson(false),
        faithfulJson(false),
        faithfulJson(true),
      ),
    });

    const result = await service.judge({
      question: 'q',
      answer: 'a',
      sources: source,
    });

    expect(result.faithful).toBe(false);
    expect(result.judgeAgreement).toBe(0.67);
    expect(result.judgeDisagreement).toBe(false);
    expect(result.judgeLowAttempts).toBe(false);
  });

  it('两次成功但结论相反：平票记 judge_error，单列分歧', async () => {
    const { service } = makeService({
      chunks: { d: [chunk('d', 'c')] },
      invoke: invokeSequence(
        faithfulJson(true),
        faithfulJson(false),
        new Error('judge timed out'),
      ),
    });

    const result = await service.judge({
      question: 'q',
      answer: 'a',
      sources: source,
    });

    expect(result.faithful).toBeNull();
    expect(result.reason).toBe('judge_disagreement');
    expect(result.errorKind).toBe('timeout');
    expect(result.judgeAgreement).toBe(0.5);
    expect(result.judgeDisagreement).toBe(true);
    expect(result.judgeLowAttempts).toBe(false);
  });

  it('仅 1 次成功：记 judge_error，保留逐次错误类型', async () => {
    const { service } = makeService({
      chunks: { d: [chunk('d', 'c')] },
      invoke: invokeSequence(
        faithfulJson(true),
        new Error('judge rate limit 429'),
        new Error('judge timed out'),
      ),
    });

    const result = await service.judge({
      question: 'q',
      answer: 'a',
      sources: source,
    });

    expect(result.faithful).toBeNull();
    expect(result.reason).toBe('judge_disagreement');
    expect(result.errorKind).toBe('rate_limit');
    expect(result.judgeSuccessfulAttempts).toBe(1);
    expect(result.judgeAgreement).toBe(1);
    expect(result.judgeDisagreement).toBe(true);
    expect(result.judgeLowAttempts).toBe(true);
  });

  it('三次全部失败：沿用失败分类，agreement 0', async () => {
    const { service } = makeService({
      chunks: { d: [chunk('d', 'c')] },
      invoke: invokeSequence(
        new Error('invalid api key'),
        new Error('invalid api key'),
        new Error('invalid api key'),
      ),
    });

    const result = await service.judge({
      question: 'q',
      answer: 'a',
      sources: source,
    });

    expect(result.faithful).toBeNull();
    expect(result.reason).toBe('judge_error');
    expect(result.errorKind).toBe('auth');
    expect(result.judgeSuccessfulAttempts).toBe(0);
    expect(result.judgeAgreement).toBe(0);
    expect(result.judgeDisagreement).toBe(false);
    expect(result.judgeLowAttempts).toBe(true);
  });

  it('N=1 等价单次判定，并标记尝试次数不足', async () => {
    const { service, chainInvoke } = makeService({
      chunks: { d: [chunk('d', 'c')] },
      invoke: invokeSequence(faithfulJson(true)),
    });

    const result = await service.judge({
      question: 'q',
      answer: 'a',
      sources: source,
      repeats: 1,
    });

    expect(chainInvoke).toHaveBeenCalledTimes(1);
    expect(result.faithful).toBe(true);
    expect(result.judgeRepeats).toBe(1);
    expect(result.judgeAgreement).toBe(1);
    expect(result.judgeLowAttempts).toBe(true);
  });

  it('EVAL_JUDGE_REPEATS 非法值回落 3 次', async () => {
    const { service, chainInvoke, config } = makeService({
      repeatsEnv: '4',
      chunks: { d: [chunk('d', 'c')] },
    });

    const result = await service.judge({
      question: 'q',
      answer: 'a',
      sources: source,
    });

    expect(config.get).toHaveBeenCalledWith('EVAL_JUDGE_REPEATS');
    expect(chainInvoke).toHaveBeenCalledTimes(3);
    expect(result.judgeRepeats).toBe(3);
  });

  it('判官输出无法解析：faithful null + output_format，不算回答错误', async () => {
    const { service } = makeService({
      chunks: { d: [chunk('d', 'c')] },
      invoke: jest.fn(async () => 'not json'),
    });

    const result = await service.judge({
      question: 'q',
      answer: 'a',
      sources: source,
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
      sources: source,
    });

    expect(result.faithful).toBeNull();
    expect(result.errorKind).toBe('timeout');
    expect(result.judgeInputHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('EVAL_JUDGE_SPEC=v1 时走旧口径并标注版本', async () => {
    const { service } = makeService({
      spec: 'v1',
      chunks: { d: [chunk('d', 'c')] },
      repeatsEnv: 1,
    });

    const result = await service.judge({
      question: 'q',
      answer: 'a',
      sources: source,
    });

    expect(result.judgeSpecVersion).toBe('v1');
    expect(result.judgePromptVersion).toBe(JUDGE_PROMPT_VERSION);
    expect(result.faithful).toBe(true);
  });
});
