import { detectCompletionClaim } from './claim-guard';

describe('detectCompletionClaim', () => {
  it.each([
    '提现申请已提交',
    '提现申请已提交，预计 1-3 个工作日到账',
    '优惠券已领取',
    '兑换码已兑换',
    '收货地址已删除',
    'Your withdrawal has been submitted',
    'The address has been updated.',
  ])('识别完成语: %s', (text) => {
    expect(detectCompletionClaim(text)).toBe(true);
  });

  it.each([
    '提现需要 1-3 个工作日',
    '请确认：提现确认',
    '请点击上方卡片确认（60 秒内有效）',
    '目前可领取的优惠券如下',
    '这次操作还没有真正完成。请按上方的确认卡片完成确认。',
  ])('不误判: %s', (text) => {
    expect(detectCompletionClaim(text)).toBe(false);
  });

  it('空文本不算完成', () => {
    expect(detectCompletionClaim('')).toBe(false);
  });
});
