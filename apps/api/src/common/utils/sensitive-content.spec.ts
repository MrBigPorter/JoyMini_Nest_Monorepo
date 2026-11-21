import {
  containsSensitiveRequest,
  isSensitiveRequest,
} from './sensitive-content';

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

  it('政策说明里提到敏感字段，但带否定词，不算索要', () => {
    expect(
      isSensitiveRequest(
        '退款会原路退回您的支付账户，无需提供银行卡号或身份证，也不会索要密码。',
      ),
    ).toBe(false);
    expect(
      isSensitiveRequest('您不需要提供银行卡号，系统会自动处理退款。'),
    ).toBe(false);
  });

  it('敏感词与请求动词距离过远，不算索要', () => {
    expect(
      isSensitiveRequest(
        '退款政策说明：订单确认后我们会安排退款，退款原路返回。银行卡号不是必填项。',
      ),
    ).toBe(false);
  });

  it('真正的索要仍然命中', () => {
    expect(isSensitiveRequest('请提供您的银行卡号和姓名')).toBe(true);
    expect(isSensitiveRequest('把身份证号发给我')).toBe(true);
    expect(isSensitiveRequest('请输入信用卡 CVV')).toBe(true);
  });
});
