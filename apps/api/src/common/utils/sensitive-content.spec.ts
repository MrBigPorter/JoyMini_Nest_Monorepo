import { containsSensitiveRequest, isSensitiveRequest } from './sensitive-content';

describe('containsSensitiveRequest', () => {
  it('命中银行卡/身份证/CVV', () => {
    expect(containsSensitiveRequest('请提供银行卡号')).toBe(true);
    expect(containsSensitiveRequest('Please provide your card number')).toBe(
      true,
    );
    expect(containsSensitiveRequest('身份证号发我')).toBe(true);
    expect(containsSensitiveRequest('CVV 是多少')).toBe(true);
  });

  it('安全提醒不算索要', () => {
    expect(isSensitiveRequest('请不要在聊天中提供银行卡号')).toBe(false);
    expect(isSensitiveRequest('请提供银行卡号')).toBe(true);
    expect(isSensitiveRequest('Please provide your card number')).toBe(true);
  });

  it('业务标识和普通文本不误报', () => {
    expect(containsSensitiveRequest('订单 ORD20261118001')).toBe(false);
    expect(containsSensitiveRequest('提现请到 App 操作')).toBe(false);
    expect(containsSensitiveRequest(null)).toBe(false);
  });
});
