import { maskEmail } from './data-masking';

/**
 * 追踪表只保留“可排障”的文本，不保留可直接识别个人的信息。
 * 目前覆盖：中国大陆手机号、邮箱、18 位身份证号。
 * 订单号等业务标识保留，避免把排障线索一起抹掉。
 */
export function redactPiiText(
  text: string | null | undefined,
): string | null {
  if (text === null || text === undefined || text === '') return null;
  return text
    // 菲律宾手机号：+639xxxxxxxxx / 09xxxxxxxxx
    .replace(/(?<!\d)((?:\+63|0)9\d{9})(?!\d)/g, (phone) => {
      const digits = phone.replace(/\D/g, '');
      const prefix = phone.startsWith('+63') ? '+63' : '0';
      return `${prefix}9****${digits.slice(-3)}`;
    })
    .replace(/(?<!\d)(1[3-9]\d{9})(?!\d)/g, (phone) => {
      return `${phone.slice(0, 3)}****${phone.slice(-4)}`;
    })
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, (email) => maskEmail(email))
    .replace(
      /(?<!\d)(\d{4})\d{10}(\d{3}[\dXx])(?!\d)/g,
      '$1**********$2',
    );
}
