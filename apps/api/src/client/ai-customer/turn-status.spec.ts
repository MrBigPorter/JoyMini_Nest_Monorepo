import { resolveTurnStatus } from './turn-status';

describe('resolveTurnStatus', () => {
  it('转人工优先', () => {
    expect(resolveTurnStatus(true, true, true)).toBe('TRANSFERRED');
  });

  it('没有 pendingConfirm → SUCCESS', () => {
    expect(resolveTurnStatus(false, false, false)).toBe('SUCCESS');
  });

  it('卡片创建成功 → CONFIRM', () => {
    expect(resolveTurnStatus(false, true, true)).toBe('CONFIRM');
  });

  it('进入 confirm 路由但卡片被拒 → CONFIRM_REJECTED', () => {
    expect(resolveTurnStatus(false, true, false)).toBe('CONFIRM_REJECTED');
  });
});
