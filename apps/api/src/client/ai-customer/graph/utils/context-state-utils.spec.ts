import {
  detectCorrection,
  detectEntity,
  updateContextState,
} from './context-state-utils';
import { emptyContextState } from '@api/client/ai-customer/graph/state';

describe('context-state-utils · 实体与纠正', () => {
  it('识别“我的苹果手机去哪里了”的实体', () => {
    expect(detectEntity('我的苹果手机去哪里了')).toBe('苹果手机');
  });

  it('“不是苹果手机，是包包”识别为纠正（from → to）', () => {
    expect(detectCorrection('不是苹果手机，是包包')).toEqual({
      from: '苹果手机',
      to: '包包',
    });
  });

  it('改口后 activeEntity 被覆盖，旧实体只进 corrections', () => {
    const first = updateContextState(
      emptyContextState(),
      '我的苹果手机去哪里了',
    );
    expect(first.state.activeEntity).toBe('苹果手机');

    const second = updateContextState(first.state, '不是苹果手机，是包包');
    expect(second.state.activeEntity).toBe('包包');
    expect(second.state.corrections).toHaveLength(1);
    expect(second.state.corrections[0]).toMatchObject({
      from: '苹果手机',
      to: '包包',
    });
    expect(second.clarification).toBeUndefined();
  });

  it('纠正后再问“说说手机” → 先澄清，不默认回旧实体', () => {
    const first = updateContextState(
      emptyContextState(),
      '我的苹果手机去哪里了',
    );
    const second = updateContextState(first.state, '不是苹果手机，是包包');
    const third = updateContextState(second.state, '说说手机');

    expect(third.state.activeEntity).toBe('包包');
    expect(third.clarification).toContain('苹果手机');
    expect(third.clarification).toContain('包包');
  });

  it('纠正后问“那个到哪了” → 不澄清，继续用包包', () => {
    const first = updateContextState(
      emptyContextState(),
      '我的苹果手机去哪里了',
    );
    const second = updateContextState(first.state, '不是苹果手机，是包包');
    const third = updateContextState(second.state, '那个到哪了');

    expect(third.state.activeEntity).toBe('包包');
    expect(third.clarification).toBeUndefined();
  });
});
