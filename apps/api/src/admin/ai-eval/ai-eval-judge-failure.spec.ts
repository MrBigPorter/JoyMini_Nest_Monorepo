import { ServiceUnavailableException } from '@nestjs/common';
import { AiEvalJudgeService } from './ai-eval-judge.service';

/**
 * 判官失败必须与「回答错了」分账（req: 判官失败必须与回答错误分账）。
 *
 * - 输出不可解析 → 抛 `output_format`，不能悄悄返回 unsolved（那会让 0 分进分母）
 * - 调用全失败 → 保留 503，但 body 带结构化 kind（鉴权/限流/超时/格式/策略）
 */

const mockLlmState: { raw: string; error: Error | null } = {
  raw: 'not json',
  error: null,
};

jest.mock('@api/client/ai-customer/graph/llm-factory', () => {
  const { RunnableLambda } = jest.requireActual('@langchain/core/runnables');
  return {
    createLLM: () =>
      RunnableLambda.from(async () => {
        if (mockLlmState.error) throw mockLlmState.error;
        return mockLlmState.raw;
      }),
  };
});

function makeConfigService() {
  return {
    get: (key: string, fallback?: unknown) =>
      key === 'GROQ_API_KEY' ? 'gsk-test-key' : fallback,
  } as any;
}

const INPUT = { question: '怎么退款', answer: '走退款流程', expectTask: {} };

describe('AiEvalJudgeService 失败分账', () => {
  let service: AiEvalJudgeService;

  beforeEach(() => {
    mockLlmState.raw = 'not json';
    mockLlmState.error = null;
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
});
