import { buildJudgeInput, parseJudgeOutput } from './rag-faithfulness.service';

describe('RagFaithfulnessService helpers', () => {
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

  it('组装输入包含问题、回答与来源，并截断超长来源', () => {
    const longContent = 'x'.repeat(3000);
    const input = buildJudgeInput('退款多久到账？', '1-3 天', [
      { title: 'Refund Policy', docId: 'refund-policy', content: longContent },
    ]);

    expect(input).toContain('QUESTION:\n退款多久到账？');
    expect(input).toContain('ANSWER:\n1-3 天');
    expect(input).toContain('Refund Policy');
    expect(input).toContain('x'.repeat(2000));
    expect(input).not.toContain('x'.repeat(2001));
  });
});
