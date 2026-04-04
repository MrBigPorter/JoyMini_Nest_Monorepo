import { timingSafeEqual } from 'node:crypto';
import { sha256 } from '@api/common/crypto.util';

/** 常量时间比较：把 hex 字符串转换成 Buffer 后比较，避免时序侧信道 */
export function constTimeEqualHex(aHex: string, bHex: string): boolean {
  const a = Buffer.from(aHex, 'hex');
  const b = Buffer.from(bHex, 'hex');

  // timingSafeEqual 要求长度一致；长度不一致时，也做一次等长比较以对齐时间
  if (a.length !== b.length) {
    const pad = Buffer.alloc(a.length || 32); // 给个固定长度兜底
    try {
      timingSafeEqual(a, pad);
    } catch {
      // Intentionally ignore: mismatch path still does a compare attempt for timing consistency.
    }
    return false;
  }
  return timingSafeEqual(a, b);
}

/** 生成 OTP 哈希（*/
export function otpHash(phone: string, code: string, pepper: string): string {
  return sha256(`${phone}:${code}:${pepper}`);
}

/** 校验 OTP：用相同规则算出期望哈希，再做常量时间比较 */
export function verifyOtpHash(
  phone: string,
  code: string,
  storedHex: string,
  pepper: string,
): boolean {
  const expected = otpHash(phone, code, pepper);
  return constTimeEqualHex(expected, storedHex);
}
