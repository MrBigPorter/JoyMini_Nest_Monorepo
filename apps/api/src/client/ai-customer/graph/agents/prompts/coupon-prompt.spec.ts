import { couponPromptConfig } from './coupon-prompt';

const text = JSON.stringify(couponPromptConfig);

describe('coupon prompt · 序号与列表规则', () => {
  it('序号只绑定最近展示的列表', () => {
    expect(text).toContain('most recently showed');
    expect(text).toContain('never switch to a different list');
  });

  it('同一轮最多一个编号列表；持有券不编号', () => {
    expect(text).toContain('one numbered coupon list');
    expect(text).toContain('not a claim list');
  });

  it('弹卡前复述券名与序号', () => {
    expect(text).toContain('restate the coupon name');
  });

  it('不可领时解释原因、不替换成另一张', () => {
    expect(text).toContain('do NOT substitute another coupon');
  });
});
