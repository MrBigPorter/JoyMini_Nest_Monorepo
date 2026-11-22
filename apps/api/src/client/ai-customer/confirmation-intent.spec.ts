import { isOtpCode, isShortAffirmation } from './confirmation-intent';

describe('isShortAffirmation', () => {
  it.each([
    '确认',
    '确定',
    '可以',
    '好的',
    '好',
    '行',
    '是的',
    '没问题',
    '嗯嗯',
    'yes',
    'OK',
    'okay',
    'sure',
    'confirm',
    'proceed',
    '确认。',
    '可以！',
    ' OK ',
  ])('识别短确认语: %s', (text) => {
    expect(isShortAffirmation(text)).toBe(true);
  });

  it.each([
    '可以领券吗',
    '确认一下我的优惠券',
    '我想提现',
    '好的谢谢',
    '可以帮我看看订单吗',
    'Confirm my withdrawal',
  ])('不误判: %s', (text) => {
    expect(isShortAffirmation(text)).toBe(false);
  });

  it('空字符串与纯标点不算确认', () => {
    expect(isShortAffirmation('')).toBe(false);
    expect(isShortAffirmation('。。。')).toBe(false);
  });
});

describe('isOtpCode', () => {
  it.each(['123456', ' 123456 ', '000000'])('识别 6 位数字: %s', (text) => {
    expect(isOtpCode(text)).toBe(true);
  });

  it.each(['12345', '1234567', '12a456', '确认', '99999'])(
    '非 6 位数字不识别: %s',
    (text) => {
      expect(isOtpCode(text)).toBe(false);
    },
  );
});
