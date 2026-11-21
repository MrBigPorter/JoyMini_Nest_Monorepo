import { redactPiiText } from './pii-redaction';

describe('redactPiiText', () => {
  it('手机号中间四位打码', () => {
    expect(redactPiiText('联系电话 13812341234')).toBe('联系电话 138****1234');
  });

  it('菲律宾手机号打码', () => {
    expect(redactPiiText('手机号 +639173936187')).toBe(
      '手机号 +639****187',
    );
    expect(redactPiiText('手机号 09173936187')).toBe('手机号 09****187');
  });

  it('邮箱打码', () => {
    expect(redactPiiText('发到 user@example.com')).toBe(
      '发到 u***@example.com',
    );
  });

  it('身份证号打码', () => {
    expect(redactPiiText('身份证 110101199001011234')).toBe(
      '身份证 1101**********1234',
    );
  });

  it('订单号等业务标识保留', () => {
    expect(redactPiiText('订单号 202611210001')).toBe('订单号 202611210001');
  });

  it('空值返回 null', () => {
    expect(redactPiiText(null)).toBeNull();
    expect(redactPiiText('')).toBeNull();
  });
});
