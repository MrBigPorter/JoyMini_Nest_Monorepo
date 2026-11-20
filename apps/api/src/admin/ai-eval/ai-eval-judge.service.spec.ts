import {
  allowSameVendor,
  assertIndependentVendor,
  parseJudgeOutput,
  vendorOf,
} from './ai-eval-judge.service';

describe('parseJudgeOutput', () => {
  it('解析 solved / partial / unsolved 三类判定', () => {
    expect(
      parseJudgeOutput(
        '{"verdict":"solved","score":0.95,"reason":"关键信息齐全"}',
      ),
    ).toEqual({ verdict: 'solved', score: 0.95, reason: '关键信息齐全' });

    expect(
      parseJudgeOutput(
        '```json\n{"verdict":"partial","score":0.5,"reason":"缺少金额"}\n```',
      ),
    ).toEqual({ verdict: 'partial', score: 0.5, reason: '缺少金额' });

    expect(
      parseJudgeOutput('{"verdict":"unsolved","score":0,"reason":"答非所问"}'),
    ).toEqual({ verdict: 'unsolved', score: 0, reason: '答非所问' });
  });

  it('非法 verdict 或非 JSON 返回 null', () => {
    expect(parseJudgeOutput('{"verdict":"maybe","score":0.5}')).toBeNull();
    expect(parseJudgeOutput('not json')).toBeNull();
  });

  it('分数越界时收敛到 0..1', () => {
    expect(
      parseJudgeOutput('{"verdict":"solved","score":9,"reason":""}')?.score,
    ).toBe(1);
    expect(
      parseJudgeOutput('{"verdict":"unsolved","score":-3,"reason":""}')?.score,
    ).toBe(0);
  });
});

describe('vendorOf / assertIndependentVendor', () => {
  it('识别 DeepSeek 与 Groq 为不同厂商', () => {
    expect(vendorOf('deepseek-chat', 'https://api.deepseek.com')).toBe(
      'deepseek',
    );
    expect(
      vendorOf('llama-3.3-70b-versatile', 'https://api.groq.com/openai/v1'),
    ).toBe('groq');
  });

  it('judge 与被测模型同厂商时拒绝启动', () => {
    expect(() =>
      assertIndependentVendor({
        type: 'online',
        model: 'deepseek-chat',
        baseURL: 'https://api.deepseek.com',
        apiKey: 'x',
      }),
    ).toThrow(/different vendor/);
  });

  it('Groq judge 通过独立厂商校验', () => {
    expect(() =>
      assertIndependentVendor({
        type: 'online',
        model: 'llama-3.3-70b-versatile',
        baseURL: 'https://api.groq.com/openai/v1',
        apiKey: 'x',
      }),
    ).not.toThrow();
  });

  it('同厂商 judge 只在显式开关或 development 下允许', () => {
    expect(allowSameVendor({})).toBe(false);
    expect(allowSameVendor({ NODE_ENV: 'production' })).toBe(false);
    expect(allowSameVendor({ AI_EVAL_JUDGE_ALLOW_SAME_VENDOR: 'true' })).toBe(
      true,
    );
    expect(allowSameVendor({ NODE_ENV: 'development' })).toBe(true);
  });
});
