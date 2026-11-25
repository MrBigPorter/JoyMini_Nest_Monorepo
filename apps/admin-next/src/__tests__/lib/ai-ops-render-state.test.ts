import { describe, expect, it } from 'vitest';

import {
  formatKnownCount,
  resolveRenderState,
} from '@/lib/ai-ops-render-state';

describe('resolveRenderState', () => {
  it('禁用优先于其它状态：无权限时不显示加载中或旧数据', () => {
    expect(
      resolveRenderState({
        disabledReason: 'AI 评测未启用',
        loading: true,
        error: new Error('boom'),
      }),
    ).toEqual({ kind: 'disabled', reason: 'AI 评测未启用' });
  });

  it('加载中先于错误与空态', () => {
    expect(resolveRenderState({ loading: true, error: new Error('x') })).toEqual(
      { kind: 'loading' },
    );
  });

  it('请求失败给出可读原因', () => {
    expect(resolveRenderState({ error: new Error('请求超时') })).toEqual({
      kind: 'error',
      message: '请求超时',
    });
  });

  it('错误对象没有 message 时回退到通用文案', () => {
    expect(resolveRenderState({ error: { code: 500 } })).toEqual({
      kind: 'error',
      message: '请求失败',
    });
  });

  it('空态与错误可区分', () => {
    expect(resolveRenderState({ isEmpty: true })).toEqual({ kind: 'empty' });
    expect(resolveRenderState({ error: new Error('x') })).not.toEqual({
      kind: 'empty',
    });
  });

  it('全部满足时是 ready', () => {
    expect(resolveRenderState({})).toEqual({ kind: 'ready' });
  });
});

describe('formatKnownCount', () => {
  it('有数值时原样展示，包括真实的 0', () => {
    expect(formatKnownCount(0)).toBe('0');
    expect(formatKnownCount(12)).toBe('12');
  });

  it('未知字段不渲染成 0', () => {
    const text = formatKnownCount(undefined);
    expect(text).not.toBe('0');
    expect(text).toBe('未知');
  });

  it('请求失败时显示未知而不是旧值', () => {
    expect(formatKnownCount(null, { kind: 'error', message: 'x' })).toBe('未知');
  });

  it('加载中显示加载文案', () => {
    expect(formatKnownCount(undefined, { kind: 'loading' })).toBe('加载中…');
  });
});
