import {
  buildJudgeInput,
  chunkRelevance,
  classifyJudgeError,
  JUDGE_INPUT_SPEC_VERSION,
  JUDGE_MAX_SOURCE_CHARS,
  JUDGE_MAX_TOTAL_SOURCE_CHARS,
  redactForJudge,
  resolveJudgeDocIds,
  resolveJudgeSpecVersion,
  selectJudgeSources,
} from './judge-input-spec';

describe('judge-input-spec', () => {
  it('版本号：默认 v2，非法值回落 v2，显式 v1 保留', () => {
    expect(JUDGE_INPUT_SPEC_VERSION).toBe('v2');
    expect(resolveJudgeSpecVersion(undefined)).toBe('v2');
    expect(resolveJudgeSpecVersion('garbage')).toBe('v2');
    expect(resolveJudgeSpecVersion('v1')).toBe('v1');
  });

  it('answer 与 sources 用同一脱敏：同一邮箱两处形态一致', () => {
    const email = 'customer.porter@example.com';
    const judgeInput = buildJudgeInput({
      question: '怎么改邮箱？',
      answer: `已为 ${email} 提交修改`,
      sources: [
        {
          title: 'Profile',
          docId: 'profile',
          content: `修改邮箱需验证 ${email}`,
        },
      ],
    });

    const masked = redactForJudge(email);
    expect(masked).not.toBe(email);
    expect(judgeInput.input).toContain(masked);
    expect(judgeInput.input).not.toContain(email);
    // 两处出现的是同一个形态
    expect(judgeInput.input.split(masked).length - 1).toBe(2);
  });

  it('v1 保留旧行为：不脱敏', () => {
    const email = 'customer.porter@example.com';
    const judgeInput = buildJudgeInput({
      question: 'q',
      answer: email,
      sources: [{ docId: 'd', content: email }],
      specVersion: 'v1',
    });
    expect(judgeInput.input).toContain(email);
    expect(judgeInput.specVersion).toBe('v1');
  });

  it('截断：单来源 2000、合计 8000，超出的来源被丢弃', () => {
    const sources = Array.from({ length: 6 }, (_, i) => ({
      docId: `doc-${i}`,
      title: `Doc ${i}`,
      content: 'x'.repeat(3000),
    }));
    const { input } = buildJudgeInput({ question: 'q', answer: 'a', sources });

    expect(input.match(/x{2000}/g)).toHaveLength(4);
    expect(input).not.toContain('x'.repeat(2001));
    expect(input.match(/x/g)!.length).toBe(JUDGE_MAX_TOTAL_SOURCE_CHARS);
    expect(JUDGE_MAX_SOURCE_CHARS).toBe(2000);
  });

  it('按相关度挑选：问题命中的 chunk 排在前面，同分保持原始顺序', () => {
    const selected = selectJudgeSources(
      [
        { docId: 'a', content: 'unrelated text' },
        { docId: 'a', content: 'refund policy details' },
        { docId: 'b', content: 'refund timing' },
      ],
      { question: 'refund policy', answer: '' },
    );
    // 第一轮每组保一条覆盖；第二轮再补齐组内其余来源
    expect(selected.map((item) => item.docId)).toEqual(['a', 'b', 'a']);
    expect(selected[0].content).toBe('refund policy details');
    expect(chunkRelevance('refund policy', '', 'refund policy details')).toBe(
      4,
    );
  });

  it('hash 覆盖送审文本：同输入稳定，内容变则变', () => {
    const first = buildJudgeInput({
      question: 'q',
      answer: 'a',
      sources: [{ docId: 'd', content: 'c' }],
    });
    const second = buildJudgeInput({
      question: 'q',
      answer: 'a',
      sources: [{ docId: 'd', content: 'c' }],
    });
    const changed = buildJudgeInput({
      question: 'q',
      answer: 'a',
      sources: [{ docId: 'd', content: 'different' }],
    });

    expect(first.judgeInputHash).toMatch(/^[a-f0-9]{64}$/);
    expect(second.judgeInputHash).toBe(first.judgeInputHash);
    expect(changed.judgeInputHash).not.toBe(first.judgeInputHash);
  });

  it('docId 解析：expected 优先、去重、按上限截断', () => {
    expect(
      resolveJudgeDocIds(['golden', 'shared'], ['shared', 'cited'], 10),
    ).toEqual(['golden', 'shared', 'cited']);
    expect(resolveJudgeDocIds(['a', 'b', 'c'], [], 2)).toEqual(['a', 'b']);
    expect(resolveJudgeDocIds(undefined, undefined)).toEqual([]);
  });

  it('判官错误五类归档', () => {
    expect(classifyJudgeError('429 Too Many Requests')).toBe('rate_limit');
    expect(classifyJudgeError(new Error('judge timed out after 30s'))).toBe(
      'timeout',
    );
    expect(classifyJudgeError({ response: { status: 401 } })).toBe('auth');
    expect(classifyJudgeError('blocked by content policy')).toBe('policy');
    expect(classifyJudgeError('unparseable output')).toBe('output_format');
  });
});
