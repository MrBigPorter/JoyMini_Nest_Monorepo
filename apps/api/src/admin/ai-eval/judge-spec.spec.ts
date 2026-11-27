import { createHash } from 'crypto';
import {
  JUDGE_DEFAULT_MODEL,
  JUDGE_PROMPT_HASH,
  JUDGE_SAMPLE_COUNT,
  JUDGE_SPEC_VERSION,
  JUDGE_SYSTEM_PROMPT,
} from './judge-spec';

describe('judge-spec', () => {
  it('prompt hash 与 prompt 文本一致（改 prompt 必须同步升版本）', () => {
    const expected = createHash('sha256')
      .update(JUDGE_SYSTEM_PROMPT)
      .digest('hex');
    expect(JUDGE_PROMPT_HASH).toBe(expected);
    expect(JUDGE_PROMPT_HASH).toMatch(/^[0-9a-f]{64}$/);
  });

  it('版本、默认模型与采样数显式声明；内部单次采样固定为 1', () => {
    expect(JUDGE_SPEC_VERSION.trim().length).toBeGreaterThan(0);
    expect(JUDGE_DEFAULT_MODEL).toBe('llama-3.3-70b-versatile');
    expect(JUDGE_SAMPLE_COUNT).toBe(1);
  });
});
