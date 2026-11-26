import { ServiceUnavailableException } from '@nestjs/common';
import {
  AiEvalJudgeService,
  JudgeFailureError,
} from './ai-eval-judge.service';
import { JUDGE_SPEC_VERSION } from './judge-spec';

/**
 * 判官失败必须与「回答错了」分账（req: 判官失败必须与回答错误分账）。
 *
 * - 输出不可解析 → 抛 `output_format`，不能悄悄返回 unsolved（那会让 0 分进分母）
 * - 调用全失败 → 保留 503，但 body 带结构化 kind（鉴权/限流/超时/格式/策略）
 */

const mockLlmState: {
  raw: string;
  error: Error | null;
  structuredRaw: string | null;
  structuredParsed: unknown;
  structuredError: Error | null;
  structuredUsage: Record<string, unknown> | null;
  textCalls: number;
} = {
  raw: 'not json',
  error: null,
  structuredRaw: null,
  structuredParsed: null,
  structuredError: null,
  structuredUsage: null,
  textCalls: 0,
};

jest.mock('@api/client/ai-customer/graph/llm-factory', () => {
  const { RunnableLambda } = jest.requireActual('@langchain/core/runnables');
  return {
    createLLM: () => {
      const text = RunnableLambda.from(async () => {
        mockLlmState.textCalls += 1;
        if (mockLlmState.error) throw mockLlmState.error;
        return mockLlmState.raw;
      });
      const structured = RunnableLambda.from(async (_input: any, config?: any) => {
        if (mockLlmState.structuredError) throw mockLlmState.structuredError;
        // 结构化链路与文本链路共用「调用失败」开关：失败分类用例两者都失败。
        if (mockLlmState.error) throw mockLlmState.error;
        if (mockLlmState.structuredUsage) {
          // 真实 RunnableSequence 会把 callbacks 数组换成 CallbackManager，
          // 两种形状都接受，避免测试依赖 LangChain 内部结构的具体版本。
          const callbacks = config?.callbacks;
          const collector =
            callbacks?.handlers?.[0] ?? callbacks?.[0] ?? callbacks;
          collector?.handleLLMEnd?.({
            generations: [
              [
                {
                  message: {
                    usage_metadata: mockLlmState.structuredUsage,
                  },
                },
              ],
            ],
          });
        }
        return {
          raw: { content: mockLlmState.structuredRaw ?? mockLlmState.raw },
          parsed: mockLlmState.structuredParsed,
        };
      });
      return Object.assign(text, {
        withStructuredOutput: () => structured,
      });
    },
  };
});

function makeConfigService(overrides: Record<string, unknown> = {}) {
  return {
    get: (key: string, fallback?: unknown) =>
      key in overrides
        ? overrides[key]
        : key === 'GROQ_API_KEY'
          ? 'gsk-test-key'
          : fallback,
  } as any;
}

const INPUT = { question: '怎么退款', answer: '走退款流程', expectTask: {} };

describe('AiEvalJudgeService 失败分账', () => {
  let service: AiEvalJudgeService;

  beforeEach(() => {
    mockLlmState.raw = 'not json';
    mockLlmState.error = null;
    mockLlmState.structuredRaw = null;
    mockLlmState.structuredParsed = null;
    mockLlmState.structuredError = null;
    mockLlmState.structuredUsage = null;
    mockLlmState.textCalls = 0;
    service = new AiEvalJudgeService(makeConfigService());
  });

  it('输出不可解析时抛 output_format，而不是返回 unsolved', async () => {
    await expect(service.judge(INPUT)).rejects.toMatchObject({
      name: 'JudgeFailureError',
      kind: 'output_format',
    });
  });

  it('判官调用全失败时保留 503，并带结构化 kind', async () => {
    mockLlmState.error = new Error('Request timed out after 5000ms');

    const error = await service.judge(INPUT).catch((err) => err);

    expect(error).toBeInstanceOf(ServiceUnavailableException);
    expect(error.getResponse()).toMatchObject({
      message: expect.stringContaining('judge'),
      kind: 'timeout',
    });
  });

  it('可解析时正常返回判定（对照组，避免把成功路径也测成异常）', async () => {
    mockLlmState.raw = '{"verdict":"solved","score":0.9,"reason":"齐全"}';

    await expect(service.judge(INPUT)).resolves.toMatchObject({
      verdict: 'solved',
      score: 0.9,
    });
  });

  it('解析失败时异常携带原始输出，消息里不含原文', async () => {
    mockLlmState.raw = 'not json with secret 13800000000';

    const error = await service.judge(INPUT).catch((err) => err);

    expect(error).toBeInstanceOf(JudgeFailureError);
    expect(error.message).not.toContain('13800000000');
    expect(error.rawOutput).toBe(mockLlmState.raw);
    expect(error.rawTruncated).toBe(false);
  });

  it('成功时返回截断后的原始输出与截断标记', async () => {
    mockLlmState.raw = '{"verdict":"solved","score":0.9,"reason":"齐全"}';

    const result = await service.judge(INPUT);

    expect(result.rawOutput).toBe(mockLlmState.raw);
    expect(result.rawTruncated).toBe(false);
  });

  it('原始输出超过上限时截断并标记', async () => {
    mockLlmState.raw = `{"verdict":"solved","score":0.9,"reason":"${'x'.repeat(5000)}"}`;

    const result = await service.judge(INPUT);

    expect(result.rawOutput).toHaveLength(4000);
    expect(result.rawTruncated).toBe(true);
  });
});

describe('AiEvalJudgeService 结构化输出', () => {
  const VERDICT = '{"verdict":"solved","score":0.9,"reason":"齐全"}';

  beforeEach(() => {
    mockLlmState.raw = VERDICT;
    mockLlmState.error = null;
    mockLlmState.structuredRaw = null;
    mockLlmState.structuredParsed = null;
    mockLlmState.structuredError = null;
    mockLlmState.structuredUsage = null;
    mockLlmState.textCalls = 0;
  });

  it('结构化成功时返回本次判官调用的真实用量', async () => {
    mockLlmState.structuredParsed = {
      verdict: 'solved',
      score: 0.9,
      reason: '齐全',
    };
    mockLlmState.structuredRaw = VERDICT;
    mockLlmState.structuredUsage = {
      input_tokens: 12,
      output_tokens: 4,
      total_tokens: 16,
    };
    const service = new AiEvalJudgeService(makeConfigService());

    const result = await service.judge(INPUT);

    expect(result.usage).toEqual({
      role: 'judge',
      calls: 1,
      measuredCalls: 1,
      unavailableCalls: 0,
      promptTokens: 12,
      completionTokens: 4,
      totalTokens: 16,
    });
    expect(mockLlmState.textCalls).toBe(0);
  });

  it('判官规格版本随解码约束上调', () => {
    expect(JUDGE_SPEC_VERSION).toBe('task-judge-v3');
  });

  it('结构化成功：直接用 parsed，不再走文本链', async () => {
    mockLlmState.structuredParsed = {
      verdict: 'partial',
      score: 0.5,
      reason: '缺少金额',
    };
    mockLlmState.structuredRaw = '{"verdict":"partial","score":0.5}';
    const service = new AiEvalJudgeService(makeConfigService());

    const result = await service.judge(INPUT);

    expect(result.verdict).toBe('partial');
    expect(result.score).toBe(0.5);
    expect(result.rawOutput).toBe(mockLlmState.structuredRaw);
    expect(mockLlmState.textCalls).toBe(0);
  });

  it('schema 不匹配时回退解析同一次原始输出，不重发请求', async () => {
    // zod 拒绝：verdict 不在三态里；文本解析也判不出来的才是真空。
    mockLlmState.structuredParsed = null;
    mockLlmState.structuredRaw =
      '{"verdict":"partial","score":"0.5","reason":"缺少金额"}';
    const service = new AiEvalJudgeService(makeConfigService());

    const result = await service.judge(INPUT);

    expect(result.verdict).toBe('partial');
    expect(result.score).toBe(0.5);
    expect(mockLlmState.textCalls).toBe(0);
  });

  it('提供方拒绝结构化请求时用同一密钥降级文本链', async () => {
    mockLlmState.structuredError = Object.assign(
      new Error('400 This response_format type is unavailable now'),
      { status: 400 },
    );
    const service = new AiEvalJudgeService(
      makeConfigService({ GROQ_API_KEY: 'k1,k2' }),
    );

    const result = await service.judge(INPUT);

    expect(result.verdict).toBe('solved');
    // 降级用同一密钥，只发生一次文本调用；若换密钥这里会是 2。
    expect(mockLlmState.textCalls).toBe(1);
  });

  it('结构化与文本都失败：记输出格式且不换密钥', async () => {
    mockLlmState.structuredError = Object.assign(
      new Error('400 bad request'),
      { status: 400 },
    );
    mockLlmState.raw = 'not json';
    const service = new AiEvalJudgeService(
      makeConfigService({ GROQ_API_KEY: 'k1,k2' }),
    );

    const error = await service.judge(INPUT).catch((err) => err);

    expect(error).toBeInstanceOf(JudgeFailureError);
    expect(error.kind).toBe('output_format');
    expect(mockLlmState.textCalls).toBe(1);
  });

  it('开关关闭时完全不请求结构化输出', async () => {
    mockLlmState.structuredParsed = { verdict: 'unsolved', score: 0 };
    const service = new AiEvalJudgeService(
      makeConfigService({ EVAL_JUDGE_STRUCTURED_OUTPUT: 'false' }),
    );

    const result = await service.judge(INPUT);

    expect(result.verdict).toBe('solved');
    expect(mockLlmState.textCalls).toBe(1);
  });
});
