/**
 * 领券错误对用户的表达。
 *
 * 服务层的错误信息是英文、面向接口调用方；AI 聊天里直接透出会让用户
 * 看到 `This coupon has expired` 这类原文。这里做两层：
 *   - localizeClaimError：把已知执行错误翻成中文
 *   - describeClaimRejection：守卫拒绝卡片时，按真实原因给出提示
 */

const CLAIM_ERROR_MESSAGES: Record<string, string> = {
  'This coupon has expired': '这张券已过期，无法领取。',
  'This coupon is not yet valid': '这张券还没有开始，暂时不能领取。',
  'Coupon has no valid period': '这张券没有有效期限，无法领取。',
  'You have reached the maximum claim limit':
    '你已达到这张券的领取上限。',
  'This coupon has been fully claimed': '这张券已经被领完了。',
  'Coupon is not available or inactive': '这张券已下架或不可领取。',
};

export function localizeClaimError(message: string): string {
  return CLAIM_ERROR_MESSAGES[message] ?? message;
}

export interface ClaimRejectionCoupon {
  status?: number;
  validType?: number | null;
  validStartAt?: Date | string | null;
  validEndAt?: Date | string | null;
  validDays?: number | null;
  totalQuantity?: number | null;
  issuedQuantity?: number | null;
  perUserLimit?: number | null;
}

export interface ClaimRejectionInput {
  coupon: ClaimRejectionCoupon | null;
  claimedCount: number;
  now?: Date;
}

/** 守卫拒绝发卡时，按可确认的真实原因返回用户可读提示。 */
export function describeClaimRejection(
  input: ClaimRejectionInput,
): string {
  const { coupon, claimedCount, now = new Date() } = input;
  if (!coupon || coupon.status !== 1) {
    return '这张券已下架或不可领取。';
  }

  if (coupon.validType === 1) {
    if (!coupon.validEndAt) return '这张券没有有效期限，无法领取。';
    if (new Date(coupon.validEndAt).getTime() < now.getTime()) {
      return '这张券已过期，无法领取。';
    }
    if (
      coupon.validStartAt &&
      new Date(coupon.validStartAt).getTime() > now.getTime()
    ) {
      return '这张券还没有开始，暂时不能领取。';
    }
  } else if (!coupon.validDays || coupon.validDays <= 0) {
    return '这张券没有有效期限，无法领取。';
  }

  const total = coupon.totalQuantity ?? -1;
  const issued = coupon.issuedQuantity ?? 0;
  if (total !== -1 && issued >= total) {
    return '这张券已经被领完了。';
  }

  if (claimedCount >= (coupon.perUserLimit ?? 1)) {
    return '你已达到这张券的领取上限。';
  }

  return '这张券当前不可领取，请重新选择。';
}
